/** 本机键鼠空闲秒数（macOS `ioreg` 的 HIDIdleTime）。
 *
 * 定时播报用它判断「人在不在电脑前」：超过配置阈值就只推微信、不在空房间里
 * 自己念给空气听。取不到回 null（= 不知道），此时按「在」处理——宁可按计划念，
 * 也不要因为 ioreg 抽风把播报一直吞掉。
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
