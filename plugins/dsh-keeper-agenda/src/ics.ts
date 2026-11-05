/** ICS（RFC 5545）解析 + 重复展开 —— 移植自 dock-hub calendar.py。
 *
 * 规矩同 hub：展开从 DTSTART 一格一格走、步数封顶（病态日历不能把进程拖死）；
 * 重复规则只认 FREQ=DAILY/WEEKLY/MONTHLY/YEARLY + INTERVAL/COUNT/UNTIL/BYDAY
 * ——真实日历里九成的重复都在这四种里。看不懂的条目跳过，不整体失败。
 *
 * 时间表示：全天事件 = 本地零点 Date + allDay 标记；带钟点 = 本地 Date。
 * TZID 参数不较真（认不出就当本地时间——与 hub 的 fallback 口径一致）。
 */

export const MAX_STEPS = 20000
export const MAX_EVENTS = 50

export interface IcsEvent {
  start: Date
  end: Date | null
  allDay: boolean
  title: string
  rrule: Record<string, string> | null
  exdates: Set<string>
}

// 用 type 而非 interface：工具返回值要过 JsonValue 的 index-signature 检查
export type DayItem = {
  title: string
  start: string
  allDay: boolean
}

/** RFC 5545 折叠行：以空格/Tab 开头的行接回上一行。 */
export function unfold(text: string): string[] {
  const out: string[] = []
  for (const line of (text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if (!line) continue
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

function splitProp(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const idx = line.indexOf(':')
  if (idx < 0) return null
  const head = line.slice(0, idx)
  const value = line.slice(idx + 1).trim()
  const parts = head.split(';')
  const params: Record<string, string> = {}
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=')
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).trim().replace(/^"|"$/g, '')
  }
  return { name: parts[0]!.toUpperCase(), params, value }
}

function localMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function parseWhen(params: Record<string, string>, value: string): { date: Date; allDay: boolean } | null {
  const v = (value ?? '').trim()
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})$/)
    if (!m) return null
    return { date: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), allDay: true }
  }
  const m = v.match(/^(\d{8})T(\d{6})(Z?)$/)
  if (!m) return null
  const g = m.map(Number)
  const y = Math.floor(g[1]! / 10000)
  const mo = Math.floor((g[1]! % 10000) / 100) - 1
  const d = g[1]! % 100
  const hh = Math.floor(g[2]! / 10000)
  const mi = Math.floor((g[2]! % 10000) / 100)
  const ss = g[2]! % 100
  if (m[3] === 'Z') return { date: new Date(Date.UTC(y, mo, d, hh, mi, ss)), allDay: false }
  return { date: new Date(y, mo, d, hh, mi, ss), allDay: false }
}

export function parseRrule(value: string): Record<string, string> | null {
  const rule: Record<string, string> = {}
  for (const part of (value ?? '').trim().split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) rule[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim().toUpperCase()
  }
  return rule.FREQ ? rule : null
}

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = []
  const stack: string[] = []
  let props: Record<string, { params: Record<string, string>; value: string }> = {}
  let exdates = new Set<string>()

  const flush = (): void => {
    const startRaw = props.DTSTART
    if (startRaw) {
      const start = parseWhen(startRaw.params, startRaw.value)
      if (start) {
        const endRaw = props.DTEND
        const end = endRaw ? parseWhen(endRaw.params, endRaw.value) : null
        const title = (props.SUMMARY?.value ?? '').trim()
        const rrule = props.RRULE ? parseRrule(props.RRULE.value) : null
        events.push({ start: start.date, end: end?.date ?? null, allDay: start.allDay, title, rrule, exdates: new Set(exdates) })
      }
    }
    props = {}
    exdates = new Set()
  }

  for (const line of unfold(text)) {
    const parsed = splitProp(line)
    if (!parsed) continue
    const { name, params, value } = parsed
    if (name === 'BEGIN') {
      stack.push(value.toUpperCase())
      if (stack[stack.length - 1] === 'VEVENT') {
        props = {}
        exdates = new Set()
      }
      continue
    }
    if (name === 'END') {
      if (stack.length > 0 && stack[stack.length - 1] === value.toUpperCase()) stack.pop()
      if (value.toUpperCase() === 'VEVENT') flush()
      continue
    }
    if (stack.length === 0 || stack[stack.length - 1] !== 'VEVENT') continue // 日历本体和 VALARM 一律不看
    if (name === 'EXDATE') {
      for (const piece of value.split(/[,;]/)) {
        const when = parseWhen(params, piece)
        if (when) exdates.add(localMidnight(when.date).toISOString().slice(0, 10))
      }
    } else if (name === 'DTSTART' || name === 'DTEND' || name === 'SUMMARY' || name === 'RRULE') {
      props[name] = { params, value }
    }
  }
  return events
}

function spans(event: IcsEvent, day: Date): boolean {
  const startDay = localMidnight(event.start)
  const dayMid = localMidnight(day)
  if (dayMid.getTime() < startDay.getTime()) return false
  if (!event.end) return dayMid.getTime() === startDay.getTime()
  const endDay = localMidnight(event.end)
  if (!event.allDay) return dayMid.getTime() <= endDay.getTime()
  // 全天事件 DTEND 是排他端点：明天结束的事今天算、明天不算
  return dayMid.getTime() < endDay.getTime()
}

const WEEKDAY_NUM: Record<string, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 }

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

function weeksApart(anchor: Date, day: Date): number {
  // 周一为一周之首（同 hub 的 weekday() 口径）
  const aMon = addDays(anchor, -((anchor.getDay() + 6) % 7))
  const dMon = addDays(day, -((day.getDay() + 6) % 7))
  return Math.round((dMon.getTime() - aMon.getTime()) / 86400_000 / 7)
}

function monthDays(year: number, month: number): number {
  // month: 1-12
  return new Date(year, month, 0).getDate()
}

function shiftMonth(day: Date, months: number): Date {
  const total = day.getMonth() + months
  const year = day.getFullYear() + Math.floor(total / 12)
  const month = (total % 12 + 12) % 12
  return new Date(year, month, Math.min(day.getDate(), monthDays(year, month + 1)))
}

export function occurrences(event: IcsEvent, first: Date, last: Date): Date[] {
  const startDay = localMidnight(event.start)
  const firstDay = localMidnight(first)
  const lastDay = localMidnight(last)
  if (!event.rrule) return startDay >= firstDay && startDay <= lastDay ? [startDay] : []

  const rule = event.rrule
  const freq = rule.FREQ
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return []
  const interval = Math.max(1, Number(rule.INTERVAL ?? '1') || 1)
  const count = rule.COUNT ? Math.max(1, Number(rule.COUNT) || 1) : null
  let untilDay: Date | null = null
  if (rule.UNTIL) {
    const until = parseWhen({}, rule.UNTIL)
    if (until) untilDay = localMidnight(until.date)
  }
  const byday = (rule.BYDAY ?? '')
    .split(',')
    .map((s) => WEEKDAY_NUM[s.trim()])
    .filter((n): n is number => n !== undefined)

  const out: Date[] = []
  let made = 0
  let cursor = startDay
  let steps = 0
  while (cursor.getTime() <= lastDay.getTime() && steps < MAX_STEPS) {
    steps += 1
    if (untilDay && cursor > untilDay) break
    let hit = false
    if (freq === 'DAILY') {
      hit = true
    } else if (freq === 'WEEKLY') {
      const wd = (cursor.getDay() + 6) % 7
      hit = byday.length > 0 ? byday.includes(wd) && weeksApart(startDay, cursor) % interval === 0 : weeksApart(startDay, cursor) % interval === 0
    } else if (freq === 'MONTHLY') {
      const safeDay = Math.min(startDay.getDate(), monthDays(cursor.getFullYear(), cursor.getMonth() + 1))
      hit = cursor.getDate() === safeDay && ((cursor.getFullYear() - startDay.getFullYear()) * 12 + (cursor.getMonth() - startDay.getMonth())) % interval === 0
    } else {
      const safeDay = Math.min(startDay.getDate(), monthDays(cursor.getFullYear(), cursor.getMonth() + 1))
      hit = cursor.getMonth() === startDay.getMonth() && cursor.getDate() === safeDay && (cursor.getFullYear() - startDay.getFullYear()) % interval === 0
    }
    if (hit) {
      made += 1
      if (count !== null && made > count) break
      const key = cursor.toISOString().slice(0, 10)
      if (cursor >= firstDay && cursor <= lastDay && !event.exdates.has(key)) out.push(new Date(cursor))
    }
    // 下一格：周规则按天走才能捞到 BYDAY 的每一天，月/年规则跳整格
    if (freq === 'DAILY') {
      cursor = addDays(cursor, interval)
    } else if (freq === 'WEEKLY') {
      cursor = addDays(cursor, 1)
    } else if (freq === 'MONTHLY') {
      cursor = shiftMonth(cursor, interval)
    } else {
      const year = cursor.getFullYear() + interval
      cursor = new Date(year, cursor.getMonth(), Math.min(cursor.getDate(), monthDays(year, cursor.getMonth() + 1)))
    }
  }
  return out
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 某一天的日程：全天的事排最前，剩下的按钟点。上限 MAX_EVENTS。 */
export function dayEvents(events: IcsEvent[], day: Date): DayItem[] {
  const out: DayItem[] = []
  const dayMid = localMidnight(day)
  for (const event of events) {
    const title = event.title.trim()
    if (!title) continue // 没标题的事没法说出口，不占名额
    const startDay = localMidnight(event.start)
    if (!event.rrule && startDay > dayMid) continue // 还没来的单次事项，跟今天无关
    const starts = occurrences(event, day, day)
    if (starts.length === 0 && !spans(event, day)) continue
    const clock = starts.length > 0 && !event.allDay ? hhmm(event.start) : ''
    out.push({ title, start: clock, allDay: event.allDay })
    if (out.length >= MAX_EVENTS) break
  }
  out.sort((a, b) => {
    const ka = a.start === '' ? 0 : 1
    const kb = b.start === '' ? 0 : 1
    if (ka !== kb) return ka - kb
    if (a.start !== b.start) return a.start < b.start ? -1 : 1
    return a.title < b.title ? -1 : 1
  })
  return out
}
