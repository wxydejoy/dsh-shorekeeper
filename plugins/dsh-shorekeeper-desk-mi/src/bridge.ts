/** Python 桥封装：spawn mi_bridge.py，stdout 单 JSON 契约 + stderr 退出码语义。 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export type BridgeResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string; message: string }

export interface BridgeOptions {
  pythonBin: string
  /** mi_bridge.py 的绝对路径；默认取本模块同级的 py/ 目录 */
  scriptPath?: string
  timeoutMs?: number
}

export function defaultScriptPath(importMetaUrl: string): string {
  return fileURLToPath(new URL('../py/mi_bridge.py', importMetaUrl))
}

/** 退出码 → 人话（沿用 dsh-mijia-sidebar 的 3/4/5 语义） */
function codeToHuman(exitCode: number, stderr: string): { code: string; message: string } {
  if (exitCode === 3) return { code: 'auth-missing', message: '米家还没有登录凭证：跑一次 `python3 -m mijiaAPI login` 扫码' }
  if (exitCode === 4) return { code: 'auth-expired', message: '米家登录已过期：重新扫码登录' }
  if (exitCode === 5) return { code: 'dependency-missing', message: 'Python 缺 mijiaAPI：`pip3 install --user mijiaAPI`' }
  const detail = stderr.trim().split('\n')[0] ?? ''
  let parsed: { code?: string; message?: string } = {}
  try {
    parsed = JSON.parse(detail) as { code?: string; message?: string }
  } catch {
    /* stderr 不是 JSON 就当纯文本 */
  }
  return { code: parsed.code ?? 'error', message: parsed.message ?? (detail || `mi_bridge 退出码 ${exitCode}`) }
}

export function createBridge(options: BridgeOptions) {
  const { pythonBin, timeoutMs = 15_000 } = options
  const script = options.scriptPath ?? ''

  function run(args: string[]): Promise<BridgeResult> {
    return new Promise((resolve) => {
      const child = spawn(pythonBin, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          child.kill('SIGTERM')
          resolve({ ok: false, code: 'timeout', message: `米家桥超时（${timeoutMs}ms）` })
        }
      }, timeoutMs)
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', (error) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve({ ok: false, code: 'spawn-error', message: `起不了 Python（${pythonBin}）：${error.message}` })
        }
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (code === 0) {
          try {
            const data = JSON.parse(stdout) as Record<string, unknown>
            resolve({ ok: true, data })
          } catch {
            resolve({ ok: false, code: 'bad-output', message: `桥输出不是 JSON：${stdout.slice(0, 120)}` })
          }
          return
        }
        resolve({ ok: false, ...codeToHuman(code ?? -1, stderr) })
      })
    })
  }

  return {
    list: () => run(['list']),
    state: (did: string) => run(['state', '--did', did]),
    set: (did: string, prop: string, value: unknown) =>
      run(['set', '--did', did, '--prop', prop, '--value', JSON.stringify(value)]),
  }
}

export type MiBridge = ReturnType<typeof createBridge>
