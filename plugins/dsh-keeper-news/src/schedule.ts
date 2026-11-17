/** 定时播报的两个「守时」件：时段判定 + 跨重启去重。
 *
 * 去重为什么必须落盘：dsh 重启（改配置/装插件/kickstart）是日常动作。状态只存内存的话，
 * 21:00 播完重启一次就会在 21:01 再播一遍——keeper-watch 2026-11-16 已经在这上面
 * 吃过一次教训（同一条 PM2.5 一天发六遍）。
 */

/** 本地时区的日期键 YYYY-MM-DD（不能用 toISOString：那是 UTC，晚八点后会串天）。 */
export function localDateKey(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** HH:MM → 当日分钟数；格式不对回 null。 */
export function parseClock(value: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null
  return h * 60 + min
}

/** 到点了吗。
 *
 * 三个条件缺一不可：已经过了今天的点、还没播过今天这一档、且没超出补播窗口。
 * 补播窗口是给「机器睡着/实例没起」留的余量：08:30 的早报 10:05 醒来还能补，
 * 下午三点就不再翻旧账。
 */
export function slotDue(
  slot: string,
  now: Date,
  lastRunDate: string | null,
  catchUpMinutes: number,
): boolean {
  const at = parseClock(slot)
  if (at === null) return false
  if (lastRunDate === localDateKey(now)) return false
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  if (nowMinutes < at) return false
  const window = Number.isFinite(catchUpMinutes) ? Math.max(0, catchUpMinutes) : 0
  return nowMinutes - at <= window
}

/** 免打扰时段，允许跨零点（23:00–07:00 就是跨的）。start==end = 不设防。 */
export function inQuietHours(clock: readonly [string, string] | [], now: Date): boolean {
  if (!clock || clock.length < 2) return false
  const start = parseClock(clock[0]!)
  const end = parseClock(clock[1]!)
  if (start === null || end === null || start === end) return false
  const current = now.getHours() * 60 + now.getMinutes()
  if (start < end) return current >= start && current < end
  return current >= start || current < end
}

export interface NewsStateFile {
  version: 1
  /** 每个档位最后一次播报的日期键：{ morning: '2026-11-18' } */
  lastRun: Record<string, string>
  /** 最近一次念出去的稿子（面板/工具查「刚才播了什么」） */
  lastText: string
  lastAt: number | null
  lastTitles: string[]
}

export const DEFAULT_STATE: NewsStateFile = {
  version: 1,
  lastRun: {},
  lastText: '',
  lastAt: null,
  lastTitles: [],
}
