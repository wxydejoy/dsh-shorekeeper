/** 新闻播报工具面：取要闻 / 播报 / 打断 / 状态。
 *
 * 分工刻意分清：
 * - news_brief **不出声**，只把要闻和现成稿子递给模型——用户想「看看今天有什么」
 *   或者模型想自己写一段串讲时用它；
 * - news_speak 才出声，而且**立刻返回**（出声在后台）——稿子念完要 40 秒，
 *   工具阻塞那么久会让对话卡住，用户也听不到「好，我播」这句回应。
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { buildSpokenBrief, buildTextBrief, estimateSpeakSec, type BriefPeriod } from './brief.ts'
import { collectNews, type NewsItem } from './feed.ts'
import type { NewsSpeaker } from './tts.ts'
import type { NewsState } from './state.ts'
import type { NewsConfig } from './config.ts'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export interface NewsToolDeps {
  config: NewsConfig
  speaker: NewsSpeaker
  state: NewsState
  /** 取数入口（默认真实网络；测试可替换） */
  collect?: (limit: number) => Promise<{ items: NewsItem[]; warnings: string[] }>
}

function summaryOf(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'summary' in value) {
    const summary = (value as { summary?: unknown }).summary
    if (typeof summary === 'string') return summary
  }
  return '新闻工具完成'
}

/** news_brief 的渲染：模型看到的就是这段文本，所以条目和口播稿都得给全。
 *  （只回一句摘要的话，模型想自己写稿时手里什么都没有——2026-11-18 冒烟实测踩过。） */
function renderBrief(value: unknown): { type: 'text'; text: string }[] {
  const record = (value ?? {}) as {
    ok?: boolean
    summary?: string
    items?: { title?: string; url?: string; rank?: number | null; source?: string }[]
    spoken?: string
    estimatedSec?: number
    warnings?: string[]
  }
  if (record.ok !== true) return [{ type: 'text', text: record.summary ?? '没取到要闻' }]
  const items = record.items ?? []
  const lines = items.map((item, index) => {
    const rank = item.rank === null || item.rank === undefined ? '' : ` [榜位 ${item.rank}]`
    const link = item.url ? `\n   ${item.url}` : ''
    return `${index + 1}. ${item.title ?? ''}${rank}${link}`
  })
  const parts = [record.summary ?? `要闻 ${items.length} 条`, '', ...lines]
  if (record.spoken) {
    parts.push('', `口播稿（约 ${record.estimatedSec ?? 0} 秒，可直接交 news_speak）：`, record.spoken)
  }
  if (record.warnings && record.warnings.length > 0) parts.push('', `降级：${record.warnings.join('；')}`)
  return [{ type: 'text', text: parts.join('\n') }]
}

/** news_speak 的渲染：确认播起来了 + 稿子本身（用户可能想核对念了什么）。 */
function renderSpeak(value: unknown): { type: 'text'; text: string }[] {
  const record = (value ?? {}) as { ok?: boolean; summary?: string; seconds?: number; chunks?: number; text?: string }
  if (record.ok !== true) return [{ type: 'text', text: record.summary ?? '没播成' }]
  const head = `${record.summary ?? '播起来了'}（${record.chunks ?? 0} 段）`
  return [{ type: 'text', text: record.text ? `${head}\n\n${record.text}` : head }]
}

function toJsonItem(item: NewsItem): Json {
  return { title: item.title, url: item.url, rank: item.rank, source: item.source, desc: item.desc }
}

function clampCount(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(10, Math.max(1, Math.floor(value)))
}

export function createNewsTools(deps: NewsToolDeps): ToolDefinition[] {
  const { config, speaker, state } = deps
  const collect =
    deps.collect ??
    ((limit: number) => collectNews({ limit, extraFeeds: config.extraFeeds }))

  const brief = defineTool({
    name: 'news_brief',
    description:
      '取当下要闻清单（百度热搜），不出声。返回标题/链接/排名，以及一份现成的口播稿。用户问「今天有什么新闻」「有什么大事」时用它把事实拿出来；想自己组织语言念，改好稿子再交 news_speak。',
    parameters: {
      count: { type: 'number', description: '取几条，1–10；缺省按设置' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => renderBrief(value),
    },
    async execute(args) {
      const count = clampCount(args.count, config.count)
      try {
        const { items, warnings } = await collect(count)
        const spoken = buildSpokenBrief(items, { count, period: 'now' })
        const first = items[0]
        return {
          ok: true,
          count: items.length,
          items: items.map(toJsonItem),
          spoken: spoken.text,
          estimatedSec: spoken.estimatedSec,
          textBrief: buildTextBrief(items, { count }),
          warnings: warnings as Json,
          // 摘要只报条数 + 头条，其余标题交给 render 的列表（否则同一批标题在工具结果里出现两遍）
          summary: `要闻 ${items.length} 条（${first?.source ?? '百度热搜'}）：${first?.title ?? ''}`,
        } satisfies Json
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, degraded: `没取到要闻：${message}`, summary: `没取到要闻：${message}` } satisfies Json
      }
    },
  })

  const speak = defineTool({
    name: 'news_speak',
    description:
      '在房间喇叭里播新闻（keeper-tts 出声，立刻返回、后台念完）。用户说「播一下新闻」「念新闻给我听」时调这个；不传 text 就自动取要闻串成一段，传 text 则念你写好的稿（更适合带点评）。正在听书时会接在后面，想插队先 news_stop。',
    parameters: {
      text: { type: 'string', description: '自定义口播稿；缺省自动取要闻生成' },
      count: { type: 'number', description: '自动取稿时念几条，1–10；缺省按设置' },
      speed: { type: 'number', description: '语速 0.5–2.0；缺省按设置' },
      volume: { type: 'number', description: '音量 0–100（采样增益）；缺省按设置' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => renderSpeak(value),
    },
    async execute(args) {
      if (!config.enabled) {
        return { ok: false, degraded: '新闻播报开关是关着的（设置面板可开）', summary: '播报开关关着。' } satisfies Json
      }
      const custom = typeof args.text === 'string' ? args.text.trim() : ''
      const count = clampCount(args.count, config.count)
      const options: { speed?: number; volume?: number } = {}
      if (typeof args.speed === 'number' && Number.isFinite(args.speed)) options.speed = args.speed
      if (typeof args.volume === 'number' && Number.isFinite(args.volume)) options.volume = args.volume

      let text = custom
      let items: NewsItem[] = []
      let warnings: string[] = []
      if (!text) {
        try {
          const got = await collect(count)
          items = got.items
          warnings = got.warnings
          text = buildSpokenBrief(items, { count, period: 'now' }).text
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { ok: false, degraded: `没取到要闻，没法播：${message}`, summary: `没取到要闻：${message}` } satisfies Json
        }
      }

      const started = speaker.start(text, options)
      if (!started) {
        return { ok: false, degraded: '稿子是空的，没东西可念', summary: '稿子是空的。' } satisfies Json
      }
      state.remember(text, items.map((item) => item.title), Date.now())
      const seconds = Math.round(estimateSpeakSec(text))
      return {
        ok: true,
        seconds,
        chunks: speaker.status.totalChunks,
        text,
        items: items.map(toJsonItem),
        warnings: warnings as Json,
        summary: `播起来了，约 ${seconds} 秒（${items.length > 0 ? `${items.length} 条要闻` : '自定义稿'}）。`,
      } satisfies Json
    },
  })

  const stop = defineTool({
    name: 'news_stop',
    description: '停掉正在播的新闻（清服务端喇叭队列）。用户说「别念了」「停」时调它。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute() {
      const wasPlaying = speaker.playing
      await speaker.stop()
      return {
        ok: true,
        wasPlaying,
        summary: wasPlaying ? '停了。' : '本来就没在播。',
      } satisfies Json
    },
  })

  const status = defineTool({
    name: 'news_status',
    description: '看新闻播报的状态：是否正在播、上次播了什么、今天早晚报播过没有、开关与时间点。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute() {
      const s = speaker.status
      const lastAt = state.lastAt
      const lastWhen = lastAt === null ? '还没播过' : new Date(lastAt).toLocaleString('zh-CN')
      const bits: string[] = []
      bits.push(s.playing ? `正在播（第 ${s.spokenChunks + 1}/${s.totalChunks} 段）` : '没在播')
      bits.push(`上次播报：${lastWhen}`)
      bits.push(`早报 ${config.morningAt || '关'} / 晚报 ${config.eveningAt || '关'}`)
      return {
        ok: true,
        playing: s.playing,
        spokenChunks: s.spokenChunks,
        totalChunks: s.totalChunks,
        enabled: config.enabled,
        morningAt: config.morningAt,
        eveningAt: config.eveningAt,
        lastAt,
        lastText: state.lastText,
        lastTitles: state.lastTitles as Json,
        summary: bits.join('；'),
      } satisfies Json
    },
  })

  return [brief, speak, stop, status]
}

/** 定时播报的口播稿（index.ts 的定时器用，走同一套模板）。 */
export function briefForPeriod(items: NewsItem[], count: number, period: BriefPeriod): { text: string; estimatedSec: number } {
  const spoken = buildSpokenBrief(items, { count, period })
  return { text: spoken.text, estimatedSec: spoken.estimatedSec }
}
