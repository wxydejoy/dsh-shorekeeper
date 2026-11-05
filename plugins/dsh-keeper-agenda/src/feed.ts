/** 日历订阅 —— 移植自 dock-hub calendar.CalendarFeed。
 *
 * 拉取 30 分钟一次，失败记仇 15 分钟（口径同天气），不把日历源敲穿。
 * webcal:// 当 https:// 用；本地路径（/ 开头）读文件。
 */

import { readFile } from 'node:fs/promises'
import { parseIcs, dayEvents, type IcsEvent, type DayItem } from './ics.ts'

export const CACHE_TTL_MS = 30 * 60_000
export const FAIL_BACKOFF_MS = 15 * 60_000
const FETCH_TIMEOUT_MS = 10_000

export type Fetcher = (url: string) => Promise<string>

export async function fetchIcs(url: string): Promise<string> {
  let target = url
  if (target.toLowerCase().startsWith('webcal://')) target = `https://${target.slice('webcal://'.length)}`
  if (target.startsWith('/') || target.startsWith('file://')) {
    const path = target.startsWith('file://') ? target.slice('file://'.length) : target
    return readFile(path, 'utf8')
  }
  const resp = await fetch(target, {
    headers: { accept: 'text/calendar, text/*;q=0.9, */*;q=0.8' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.text()
}

export class CalendarFeed {
  private events: IcsEvent[] = []
  private okAt = -1e18
  private failAt = -1e18

  constructor(
    readonly url: string,
    private readonly opts: { fetch?: Fetcher; ttlMs?: number; backoffMs?: number } = {},
  ) {}

  private async refresh(now: number): Promise<void> {
    const ttl = this.opts.ttlMs ?? CACHE_TTL_MS
    const backoff = this.opts.backoffMs ?? FAIL_BACKOFF_MS
    if (now - this.okAt < ttl) return
    if (now - this.failAt < backoff) return
    try {
      const text = await (this.opts.fetch ?? fetchIcs)(this.url)
      this.events = parseIcs(text)
      this.okAt = now
      this.failAt = -1e18
    } catch {
      this.failAt = now // 源挂了不吭声，用旧账，记仇一会儿再来
    }
  }

  async eventsFor(day: Date): Promise<DayItem[]> {
    if (!this.url) return []
    await this.refresh(Date.now())
    return dayEvents(this.events, day)
  }
}
