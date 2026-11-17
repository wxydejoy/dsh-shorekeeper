/** 口播稿：把条目串成一段能听的话。
 *
 * 为什么不用模型写稿：定时播报每天两次，走一次 LLM 就要考虑 key、延迟、失败降级；
 * keeper-watch 的口径是「主动开口不过模型」，这里照做——模板稿零成本、可预测，
 * 而且热搜只有标题（没有摘要），模型也变不出更实的内容，只会把标题同义改写一遍。
 * 想让稿子更活，点播时模型可以自己写一段再交给 news_speak { text }。
 *
 * 节拍：一条标题约 15–20 字，5 条 + 开头结尾 ≈ 150–180 字 ≈ 40 秒（4 字/秒）。
 * 要凑满一分钟把 count 调到 7–8。
 */

import type { NewsItem } from './feed.ts'

export type BriefPeriod = 'morning' | 'evening' | 'now'

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
/** 口播速率（字/秒），与 reading 的估时口径一致 */
export const SPEAK_CHARS_PER_SECOND = 4.0

const OPENINGS: Record<BriefPeriod, string> = {
  morning: '早上好。今天的新闻挑了{a}条，说给你听。',
  evening: '晚上好。今天的热搜挑了{a}条，念给你听。',
  now: '好，说说现在热搜上的事。挑了{a}条。',
}

const CLOSINGS = [
  '就这些。哪条想细听，我再展开。',
  '就这些，别的都不太要紧。',
  '念完了。想细看哪条，跟我说一声。',
]

/** 口播估时（只用于给模型/面板一个大概，不是真实音频时长）。 */
export function estimateSpeakSec(text: string): number {
  return text.replace(/\s/g, '').length / SPEAK_CHARS_PER_SECOND
}

/** 条数念成中文（一二三…）；超过十就按数字念，TTS 也读得对。 */
export function cnCount(n: number): string {
  return CN_NUM[n - 1] ?? String(n)
}

/** 定时播报用哪个开场白：离早报/晚报时刻两小时内就按那个说，否则用中性开场。 */
export function resolvePeriod(now: Date, morningAt: string, eveningAt: string): BriefPeriod {
  const mark = now.getHours() * 60 + now.getMinutes()
  const near = (slot: string): boolean => {
    const minutes = parseHm(slot)
    return minutes !== null && Math.abs(mark - minutes) <= 120
  }
  if (near(morningAt)) return 'morning'
  if (near(eveningAt)) return 'evening'
  return 'now'
}

export function parseHm(value: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null
  return h * 60 + min
}

export interface SpokenBrief {
  text: string
  picked: NewsItem[]
  estimatedSec: number
}

/** 拼口播稿。条目不足时如实说「今天像样的就这几条」，不硬凑。 */
export function buildSpokenBrief(
  items: NewsItem[],
  options: { count: number; period?: BriefPeriod },
): SpokenBrief {
  const count = Math.min(10, Math.max(1, Math.floor(options.count)))
  const picked = items.slice(0, count)
  const period = options.period ?? 'now'
  const parts: string[] = []

  if (picked.length === 0) {
    return { text: '这会儿没取到新闻，网络那边可能不太顺。', picked, estimatedSec: 3 }
  }

  parts.push(OPENINGS[period].replace('{a}', cnCount(picked.length)))
  if (picked.length < count) {
    parts.push('今天像样的就这几条。')
  }

  picked.forEach((item, index) => {
    const ordinal = CN_NUM[index] ?? String(index + 1)
    // 标题尾部标点已在 cleanTitle 去掉，这里补句号；标题本身带问号的（少见）保持原样
    const title = item.title.replace(/[。！？]$/u, '')
    parts.push(`第${ordinal}条，${title}。`)
    // RSS 条目有摘要就补一句背景（最长 40 字，太长反而听不清）
    if (item.desc && item.source !== '百度热搜') {
      const desc = item.desc.replace(/[。！？]$/u, '').slice(0, 40)
      if (desc.length >= 8) parts.push(`${desc}。`)
    }
  })

  parts.push(CLOSINGS[picked.length % CLOSINGS.length] ?? CLOSINGS[0]!)

  const text = parts.join('')
  return { text, picked, estimatedSec: Math.round(estimateSpeakSec(text)) }
}

/** 文字版（微信推送 / 面板）：编号 + 标题 + 链接，微信里链接可点。 */
export function buildTextBrief(items: NewsItem[], options: { count: number }): string {
  const picked = items.slice(0, Math.min(10, Math.max(1, Math.floor(options.count))))
  if (picked.length === 0) return '这会儿没取到新闻。'
  const lines = picked.map((item, index) => {
    const link = item.url ? `\n${item.url}` : ''
    return `${index + 1}. ${item.title}${link}`
  })
  return `今天的热搜：\n${lines.join('\n')}`
}
