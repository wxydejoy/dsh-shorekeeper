/** macOS 系统音量（面板「系统声音」滑杆）。
 *
 * 走 osascript（音量/静音是用户会话设置，launchd 环境直接可调，无需特权）。
 * runner 可注入（测试用）。
 */

import { execFile } from 'node:child_process'

export interface VolumeState {
  volume: number
  muted: boolean
}

export type OsascriptRunner = (script: string) => Promise<string>

function defaultRunner(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 3_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { message: `osascript 失败：${stderr || error.message}` }))
        return
      }
      resolve(String(stdout))
    })
  })
}

async function run(runner: OsascriptRunner, script: string): Promise<string> {
  return runner(script)
}

/** 读系统音量（0–100）与静音。osascript 不可用时抛错，由信封层兜住。 */
export async function getVolume(runner: OsascriptRunner = defaultRunner): Promise<VolumeState> {
  const out = await run(runner, 'output volume of (get volume settings)')
  const mutedOut = await run(runner, 'output muted of (get volume settings)')
  const volume = Number.parseFloat(out.trim())
  return {
    volume: Number.isFinite(volume) ? Math.round(volume) : 50,
    muted: mutedOut.trim() === 'true',
  }
}

/** 设系统音量（0–100，钳位）。 */
export async function setVolume(volume: number, runner: OsascriptRunner = defaultRunner): Promise<number> {
  const clamped = Math.min(100, Math.max(0, Math.round(volume)))
  if (!Number.isFinite(clamped)) throw new Error('音量必须是数字')
  await run(runner, `set volume output volume ${clamped}`)
  return clamped
}

/** 设静音。 */
export async function setMuted(muted: boolean, runner: OsascriptRunner = defaultRunner): Promise<boolean> {
  await run(runner, `set volume output muted ${muted ? 'true' : 'false'}`)
  return muted
}
