/** snapshot 订阅：长轮询循环（§2.3）。
 *
 * - 带 since/wait：Hub 挂住请求，seq 一变立刻返回；超时返回是正常情况
 * - 断线/错误退避重连（1s 起指数退避到 30s 封顶，成功后清零）
 * - 也可退化为普通轮询（wait=0）：pc/media 非空时 3s，否则 20s
 */

import type { HubClient } from './hub-client.ts'
import type { Snapshot } from './types.ts'

export interface SnapshotWatcherOptions {
  client: HubClient
  /** 长轮询挂秒数；0 表示普通轮询。默认 25（上限 30 由 client 兜底） */
  waitSec?: number
  /** 普通轮询模式的间隔基线 */
  pollIntervalMs?: number
  /** 错误退避起点（指数翻倍到 30s 封顶，成功后清零） */
  errorBackoffStartMs?: number
  onSnapshot: (snapshot: Snapshot) => void
  onError?: (error: unknown, retryInMs: number) => void
}

const ERROR_BACKOFF_START_MS = 1_000
const ERROR_BACKOFF_MAX_MS = 30_000
const ACTIVE_POLL_MS = 3_000
const IDLE_POLL_MS = 20_000

export class SnapshotWatcher {
  private readonly options: SnapshotWatcherOptions
  private readonly waitSec: number
  private readonly pollIntervalMs: number
  private since: number | undefined
  private backoffMs = ERROR_BACKOFF_START_MS
  private running = false

  constructor(options: SnapshotWatcherOptions) {
    this.options = options
    this.waitSec = options.waitSec ?? 25
    this.pollIntervalMs = options.pollIntervalMs ?? IDLE_POLL_MS
    if (options.errorBackoffStartMs !== undefined) {
      this.backoffMs = options.errorBackoffStartMs
      this.backoffFloor = options.errorBackoffStartMs
    }
  }

  private backoffFloor: number = ERROR_BACKOFF_START_MS

  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  stop(): void {
    this.running = false
  }

  get active(): boolean {
    return this.running
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const pollOptions: { since?: number; wait?: number } = {}
        if (this.since !== undefined) pollOptions.since = this.since
        if (this.waitSec > 0) pollOptions.wait = this.waitSec
        const snapshot = await this.options.client.snapshot(pollOptions)
        this.backoffMs = this.backoffFloor
        if (snapshot.seq !== undefined) this.since = snapshot.seq
        this.options.onSnapshot(snapshot)
        if (this.waitSec > 0) continue
        // 普通轮询：pc/media 活跃时缩短间隔（§2.3 建议 2–5 秒）
        const busy = (snapshot.pc ?? null) !== null || (snapshot.media ?? null) !== null
        await sleep(busy ? ACTIVE_POLL_MS : this.pollIntervalMs)
      } catch (error) {
        if (!this.running) return
        this.options.onError?.(error, this.backoffMs)
        await sleep(this.backoffMs)
        this.backoffMs = Math.min(ERROR_BACKOFF_MAX_MS, this.backoffMs * 2)
        if (this.backoffMs < this.backoffFloor) this.backoffMs = this.backoffFloor
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
