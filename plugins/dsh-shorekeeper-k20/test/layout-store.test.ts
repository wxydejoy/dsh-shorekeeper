import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadLayout, parseHubPhoneLayout } from '../src/layout-store.ts'

const SAMPLE = `
phone:
  rev: 0
  layout:
    rev: 20
    modules:
      Clock:
        x: 0
        y: 0.3
        w: 0.44
        h: 0.38
        visible: true
        chrome: false
      Weather:
        x: 0
        y: 0
        w: 0
        h: 0
        visible: false
        chrome: true
probe:
  url: http://example
`

describe('layout-store', () => {
  it('从 hub.yaml 的 phone.layout 解析出 rev 和槽位', () => {
    const layout = parseHubPhoneLayout(SAMPLE)
    expect(layout?.rev).toBe(20)
    expect(layout?.modules.Clock).toMatchObject({ y: 0.3, chrome: false, visible: true })
    expect(layout?.modules.Weather?.visible).toBe(false)
  })

  it('没有本地文件时从 hub.yaml 种一版并写盘', () => {
    const dir = mkdtempSync(join(tmpdir(), 'k20-layout-'))
    const file = join(dir, 'k20-layout.json')
    const yaml = join(dir, 'hub.yaml')
    writeFileSync(yaml, SAMPLE)
    const loaded = loadLayout(file, yaml)
    expect(loaded?.rev).toBe(20)
    expect(loadLayout(file, yaml)?.modules.Clock?.w).toBe(0.44)
  })
})
