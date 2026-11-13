/** 主屏布局落盘。dsh 自己保管，不经过 hub。
 *
 * 文件：`$DSH_HOME/k20-layout.json`（缺省 ~/.dsh）。
 * 第一次没有这个文件时，从 hub.yaml 的 phone.layout 抄一份过来，
 * 这样关掉 hub 之后屏上还是原来那版。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PhoneLayout, PhoneModuleRect } from './types.ts'

const HUB_YAML = join(homedir(), '.config', 'dock-hub', 'hub.yaml')

export function layoutFilePath(home = process.env.DSH_HOME || join(homedir(), '.dsh')): string {
  return join(home, 'k20-layout.json')
}

export function readLayoutFile(file: string): PhoneLayout | null {
  try {
    return normalizeLayout(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

export function writeLayoutFile(file: string, layout: PhoneLayout): void {
  mkdirSync(join(file, '..'), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(layout, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

/** 没有本地文件时，从 hub.yaml 的 phone.layout 种一版。hub 进程不用开着。 */
export function loadLayout(file = layoutFilePath(), hubYaml = HUB_YAML): PhoneLayout | null {
  const existing = readLayoutFile(file)
  if (existing) return existing
  let seeded: PhoneLayout | null = null
  try {
    seeded = parseHubPhoneLayout(readFileSync(hubYaml, 'utf8'))
  } catch {
    seeded = null
  }
  if (!seeded) return null
  writeLayoutFile(file, seeded)
  return seeded
}

export function parseHubPhoneLayout(yaml: string): PhoneLayout | null {
  const lines = yaml.split(/\r?\n/)
  let inPhone = false
  let inLayout = false
  let inModules = false
  let rev = 0
  let sawRev = false
  const modules: Record<string, PhoneModuleRect> = {}
  let current: { id: string; rect: PhoneModuleRect } | null = null

  const flush = (): void => {
    if (!current) return
    modules[current.id] = current.rect
    current = null
  }

  for (const line of lines) {
    if (/^\S/.test(line)) {
      if (inPhone) break
      inPhone = /^phone:\s*$/.test(line)
      continue
    }
    if (!inPhone) continue
    if (/^  \S/.test(line)) {
      flush()
      inLayout = /^  layout:\s*$/.test(line)
      inModules = false
      continue
    }
    if (!inLayout) continue
    const revMatch = /^    rev:\s*(-?\d+)\s*$/.exec(line)
    if (revMatch) {
      rev = Number(revMatch[1])
      sawRev = true
      continue
    }
    if (/^    modules:\s*$/.test(line)) {
      inModules = true
      continue
    }
    if (!inModules) continue
    const slot = /^      ([A-Za-z][A-Za-z0-9]*):\s*$/.exec(line)
    if (slot) {
      flush()
      current = {
        id: slot[1] ?? '',
        rect: { x: 0, y: 0, w: 0, h: 0, visible: true, chrome: true },
      }
      continue
    }
    if (!current) continue
    const field = /^        (x|y|w|h|visible|chrome):\s*(.+?)\s*$/.exec(line)
    if (!field) continue
    const key = field[1]
    const raw = field[2] ?? ''
    if (key === 'visible' || key === 'chrome') {
      current.rect[key] = raw === 'true'
    } else if (key === 'x' || key === 'y' || key === 'w' || key === 'h') {
      const value = Number(raw)
      if (Number.isFinite(value)) current.rect[key] = value
    }
  }
  flush()
  if (!sawRev || rev < 0) return null
  return { rev, modules }
}

function normalizeLayout(value: unknown): PhoneLayout | null {
  if (typeof value !== 'object' || value === null) return null
  const rev = (value as { rev?: unknown }).rev
  const modules = (value as { modules?: unknown }).modules
  if (typeof rev !== 'number' || !Number.isFinite(rev) || rev < 0) return null
  if (typeof modules !== 'object' || modules === null || Array.isArray(modules)) return null
  return { rev, modules: modules as PhoneLayout['modules'] }
}
