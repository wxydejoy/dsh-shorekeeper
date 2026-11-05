/** dsh-keeper-agenda —— 日程 ICS 接入（hub calendar.py 对标）。
 *
 * 问「今天/明天有什么安排」，答日历。工具面：desk_agenda。
 * 订阅源在插件配置里填（iCloud/Google 日历的「秘密地址」都行，webcal:// 也可）。
 * 拿不到数据就空着回答「今天没安排」，不编。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { CalendarFeed, fetchIcs, type Fetcher } from './feed.ts'

export const inject = ['tools']

export interface FeedConfig {
  /** 订阅名（回复里提一句用） */
  name: string
  /** ICS 链接（webcal:// 或 https://）或本地文件路径 */
  url: string
}

export interface AgendaConfig {
  feeds: FeedConfig[]
}

export const Config = Schema.object({
  feeds: Schema.array(
    Schema.object({
      name: Schema.string().description('订阅名').required(),
      url: Schema.string().description('ICS 链接或本地路径').required(),
    }),
  )
    .description('日历订阅列表')
    .default([]),
}) as Schema<AgendaConfig>

export function createAgendaTools(opts: { feeds: FeedConfig[]; fetch?: Fetcher }): ReturnType<typeof defineTool>[] {
  // 同一份订阅共享一个 Feed——多个问法各问各的，账只拉一份（同 hub feed_for）
  const feeds = opts.feeds.map((f) => ({
    cfg: f,
    feed: opts.fetch ? new CalendarFeed(f.url, { fetch: opts.fetch }) : new CalendarFeed(f.url),
  }))
  const WEEK = ['日', '一', '二', '三', '四', '五', '六']

  function resolveDay(raw: unknown): { day: Date; label: string } {
    const v = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    const today = new Date()
    if (!v || v === 'today' || v === '今天') return { day: today, label: '今天' }
    if (v === 'tomorrow' || v === '明天') {
      const d = new Date(today)
      d.setDate(d.getDate() + 1)
      return { day: d, label: '明天' }
    }
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2])! - 1, Number(m[3]))
      return { day: d, label: `${m[1]}-${m[2]}-${m[3]} 星期${WEEK[d.getDay()]}` }
    }
    return { day: today, label: '今天' }
  }

  const deskAgenda = defineTool({
    name: 'desk_agenda',
    description:
      '查日程安排（订阅的 ICS 日历）。凡问「今天/明天有什么安排、日程、日历」都用这里。参数 day 可填「today/tomorrow」或「YYYY-MM-DD」，缺省今天。没配置日历订阅时会如实说。',
    parameters: {
      day: { type: 'string', description: 'today | tomorrow | YYYY-MM-DD；缺省今天' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute(args) {
      const { day, label } = resolveDay(args.day)
      if (feeds.length === 0) {
        const message = '还没有日历订阅：在 dsh-keeper-agenda 插件设置里填一个 ICS 链接（iCloud/Google 日历的「秘密地址」）就能查日程了'
        return { ok: false, degraded: message, summary: '日历还没接上，先不瞎编。' } satisfies Json
      }
      const all = await Promise.all(feeds.map(async (f) => ({ name: f.cfg.name, items: await f.feed.eventsFor(day) })))
      const items = all.flatMap((a) => a.items)
      const summarize = (items: { title: string; start: string; allDay: boolean }[]): string => {
        if (items.length === 0) return `${label}没有安排。`
        const parts = items.slice(0, 8).map((i) => (i.start ? `${i.start} ${i.title}` : i.title))
        return `${label}有 ${items.length} 件事：${parts.join('、')}${items.length > 8 ? `……还有 ${items.length - 8} 件` : ''}。`
      }
      return {
        ok: true,
        day: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
        label,
        count: items.length,
        events: items,
        summary: summarize(items),
      } satisfies Json
    },
  })

  return [deskAgenda]
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

function summaryOf(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'summary' in value) {
    const summary = (value as { summary?: unknown }).summary
    if (typeof summary === 'string') return summary
  }
  return 'desk_agenda 已完成'
}

export function apply(ctx: Context, config: AgendaConfig): void {
  for (const tool of createAgendaTools({ feeds: config.feeds, fetch: fetchIcs })) {
    ctx.tools.register(tool)
  }
  ctx.logger('agenda').info('agenda 就绪：feeds=%d', config.feeds.length)
}
