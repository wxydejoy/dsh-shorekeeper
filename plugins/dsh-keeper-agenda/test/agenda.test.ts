import { describe, expect, it } from 'vitest'
import { dayEvents, parseIcs, parseRrule, occurrences } from '../src/ics.ts'
import { CalendarFeed } from '../src/feed.ts'
import { createAgendaTools } from '../src/index.ts'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

const exec = null as unknown as ToolRunContext

function must<T>(arr: T[], i: number): T {
  const v = arr[i]
  if (v === undefined) throw new Error(`missing ${i}`)
  return v
}

function day(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d)
}

describe('parseIcs（对齐 hub calendar.parse_ics）', () => {
  const ICS = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261105',
    'DTEND;VALUE=DATE:20261107',
    'SUMMARY:出差',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART:20261105T093000Z',
    'DTEND:20261105T103000Z',
    'SUMMARY:周会',
    'RRULE:FREQ=WEEKLY;BYDAY=TH',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART:20261106T140000',
    'SUMMARY:牙医',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261225',
    'SUMMARY:圣诞节',
    'RRULE:FREQ=YEARLY',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  it('解析出四条；VALARM 里的东西不看', () => {
    const withAlarm = ICS.replace(
      'END:VEVENT\r\nEND:VCALENDAR',
      'BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT10M\r\nSUMMARY:闹钟\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR',
    )
    const titles = parseIcs(withAlarm).map((e) => e.title)
    expect(titles).toHaveLength(4)
    expect(titles).not.toContain('闹钟')
    expect(parseIcs('折叠行\r\n SUMMARY:续')).toHaveLength(0)
  })

  it('全天跨天：两天都算、第三天不算（排他端点）', () => {
    const events = parseIcs(ICS)
    const trip = must(events, 0)
    expect(dayEvents([trip], day(2026, 11, 5))).toHaveLength(1)
    expect(dayEvents([trip], day(2026, 11, 6))).toHaveLength(1)
    expect(dayEvents([trip], day(2026, 11, 7))).toHaveLength(0)
  })

  it('周会每周四有、周五没有；UTC 折到本地', () => {
    const events = parseIcs(ICS)
    const weekly = must(events, 1)
    const th = day(2026, 11, 12) // 周四
    const fri = day(2026, 11, 13)
    expect(dayEvents([weekly], th)).toHaveLength(1)
    expect(dayEvents([weekly], fri)).toHaveLength(0)
  })

  it('YEARLY 规则跨年命中', () => {
    const events = parseIcs(ICS)
    const xmas = must(events, 3)
    expect(dayEvents([xmas], day(2027, 12, 25))).toHaveLength(1)
    expect(dayEvents([xmas], day(2027, 12, 26))).toHaveLength(0)
  })

  it('EXDATE 跳过一次', () => {
    const withEx = [
      'BEGIN:VEVENT',
      'DTSTART:20261105T093000Z',
      'SUMMARY:周会',
      'RRULE:FREQ=WEEKLY',
      'EXDATE:20261112T093000Z',
      'END:VEVENT',
    ].join('\n')
    const events = parseIcs(withEx)
    expect(dayEvents(events, day(2026, 11, 12))).toHaveLength(0)
    expect(dayEvents(events, day(2026, 11, 19))).toHaveLength(1)
  })

  it('COUNT 数到就停', () => {
    const ev = parseIcs('BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261101\nSUMMARY:晨跑\nRRULE:FREQ=DAILY;COUNT=3\nEND:VEVENT')
    expect(occurrences(must(ev, 0), day(2026, 11, 1), day(2026, 11, 30))).toHaveLength(3)
    expect(dayEvents(ev, day(2026, 11, 5))).toHaveLength(0)
  })

  it('月规则 31 号：2 月收窄到 28 命中，之后随漂移漏拍（忠实 hub 语义）', () => {
    const ev = parseIcs('BEGIN:VEVENT\nDTSTART;VALUE=DATE:20260131\nSUMMARY:月结\nRRULE:FREQ=MONTHLY\nEND:VEVENT')
    expect(dayEvents(ev, day(2026, 2, 28))).toHaveLength(1)
    expect(dayEvents(ev, day(2026, 4, 30))).toHaveLength(0)
  })
})

describe('parseRrule', () => {
  it('没有 FREQ 不算规则', () => {
    expect(parseRrule('BYDAY=MO')).toBeNull()
    expect(parseRrule('FREQ=WEEKLY;BYDAY=MO,WE')).toEqual({ FREQ: 'WEEKLY', BYDAY: 'MO,WE' })
  })
})

describe('desk_agenda 工具', () => {
  function icsOf(body: string): string {
    return `BEGIN:VCALENDAR\n${body}\nEND:VCALENDAR`
  }

  it('没配置订阅：如实说，不编', async () => {
    const tools = createAgendaTools({ feeds: [] })
    const tool = tools[0]!
    const result = (await tool.execute({}, exec)) as { ok: boolean; degraded?: string }
    expect(result.ok).toBe(false)
    expect(result.degraded).toContain('ICS')
  })

  it('正常答今天/明天；没有安排就说没有', async () => {
    const fetcher = ((): string => {
      const today = new Date()
      const y = today.getFullYear()
      const mo = String(today.getMonth() + 1).padStart(2, '0')
      const d = String(today.getDate()).padStart(2, '0')
      const hh = String(today.getHours()).padStart(2, '0')
      const mi = String(today.getMinutes()).padStart(2, '0')
      return icsOf(`BEGIN:VEVENT\nDTSTART:${y}${mo}${d}T${hh}${mi}00\nSUMMARY:测试事项\nEND:VEVENT`)
    })()
    const tools = createAgendaTools({
      feeds: [{ name: '私人', url: 'https://example.com/cal.ics' }],
      fetch: async () => fetcher,
    })
    const tool = tools[0]!
    const todayResult = (await tool.execute({}, exec)) as { ok: boolean; count: number; summary: string }
    expect(todayResult.ok).toBe(true)
    expect(todayResult.count).toBe(1)
    expect(todayResult.summary).toContain('测试事项')

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const y2 = tomorrow.getFullYear()
    const m2 = String(tomorrow.getMonth() + 1).padStart(2, '0')
    const d2 = String(tomorrow.getDate()).padStart(2, '0')
    const emptyResult = (await tool.execute({ day: `${y2}-${m2}-${d2}` }, exec)) as { count: number; summary: string }
    expect(emptyResult.count).toBe(0)
    expect(emptyResult.summary).toContain('没有安排')
  })

  it('源挂了：用旧账不炸（记仇期内不重敲）', async () => {
    let calls = 0
    const good = icsOf('BEGIN:VEVENT\nDTSTART;VALUE=DATE:20260101\nSUMMARY:元旦\nRRULE:FREQ=YEARLY\nEND:VEVENT')
    const feed = new CalendarFeed('https://example.com/x.ics', {
      fetch: async () => {
        calls += 1
        if (calls > 1) throw new Error('boom')
        return good
      },
    })
    const jan1 = await feed.eventsFor(new Date(2027, 0, 1))
    expect(jan1).toHaveLength(1)
    const again = await feed.eventsFor(new Date(2027, 0, 2))
    expect(again).toHaveLength(0) // 旧账（空）——不炸
  })
})
