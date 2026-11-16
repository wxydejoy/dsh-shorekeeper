/** 本机键鼠空闲秒数（macOS `ioreg` 的 HIDIdleTime）。
 *
 * 为什么要有这个：久坐检查读快照里的 `idle_sec`，但 hub 的 /v1/snapshot 一直没
 * 这个字段（2026-11-16 实测顶层只有 protocol/seq/hub/temperature/pc/devices/
 * media/phone/companion），于是 `idle === null` → 这条检查永远不出声。
 * 本机取一次 300KB/85ms，每分钟一拍完全付得起。
 *
 * 失败一律回 null（= 这一拍不知道），绝不当成「已经休息」也不当成「一直在用」。
 */

import { execFile } from 'node:child_process'

const TIMEOUT_MS = 1_500
const IDLE_RE = /"HIDIdleTime"\s*=\s*(\d+)/

export function readLocalIdleSec(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      'ioreg',
      ['-c', 'IOHIDSystem'],
      { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve(null)
        const m = IDLE_RE.exec(stdout)
        if (!m) return resolve(null)
        const ns = Number(m[1])
        return resolve(Number.isFinite(ns) ? Math.floor(ns / 1e9) : null)
      },
    )
  })
}
