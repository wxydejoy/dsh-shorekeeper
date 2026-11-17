/** 要闻取数：百度热搜（主源）+ 可选 RSS。
 *
 * 源的选择是实测定下来的（2026-11-18）：
 * - **百度热搜 API 可用**：`top.baidu.com/api/board?platform=wise&tab=realtime`，
 *   免 key、53 条、字段只有 word/url/index/isTop（**没有摘要、没有数值热度**），
 *   所以稿子只能是「标题串讲」，不编造热度。
 * - 腾讯新闻直连被 WAF 挡（503 / 501 跳 waf.tencent.com），微博热搜 403，
 *   第三方镜像（vvhan 一类）连接被拒，百度搜索页要人机验证 → 都不做依赖。
 * - RSS 作为可选补充（extraFeeds）：有 description 就能给某条加一句背景。
 *
 * 解析全部是纯函数，抓取层只负责 fetch + 超时；任何一源挂了都返回空数组，
 * 由调用方决定降级（播报端宁可少一条，也不念一堆错误页）。
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
const FETCH_TIMEOUT_MS = 8_000
const BAIDU_HOT_URL = 'https://top.baidu.com/api/board?platform=wise&tab=realtime'

export interface NewsItem {
  title: string
  url: string
  /** 榜单序号（1 起）；置顶或 RSS 条目为 null */
  rank: number | null
  source: string
  /** 摘要/背景，没有就空串（RSS 才有） */
  desc: string
}

/** 标题清洗：去掉「（视频）（图）[热]」这类版式标记与尾部标点，保留书名号/引号。 */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/[（(]\s*(?:视频|图|组图|直播|热|新|荐|独家|现场|高清)\s*[)）]/g, '')
    .replace(/[\[【]\s*(?:视频|图|组图|直播|独家)\s*[\]】]/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[。！？，、；：,.!?;:]+$/u, '')
    .trim()
}

/** 明显不是条目的行（榜单页脚、导流位）。 */
function isJunk(title: string): boolean {
  return title.length < 4 || /查看更多|查看详情|热搜榜|全部榜单|关于百度/u.test(title)
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null
}

/** 百度热搜 JSON → 条目。
 *
 * 结构：`data.cards[]` 里 `component === 'tabTextList'` 的卡片，`content[]` 每个分组
 * 再套一层 `content[]` 才是条目（word/url/index/isTop）。层级会变，所以逐层找数组，
 * 不硬编码下标：认得 word 就当条目。
 */
export function parseBaiduHot(json: unknown, limit: number): NewsItem[] {
  const root = asRecord(json)
  const data = root ? asRecord(root.data) : null
  const cards = data && Array.isArray(data.cards) ? data.cards : []
  const out: NewsItem[] = []
  const seen = new Set<string>()

  const push = (raw: UnknownRecord): void => {
    const word = typeof raw.word === 'string' ? cleanTitle(raw.word) : ''
    if (!word || isJunk(word) || seen.has(word)) return
    seen.add(word)
    const index = typeof raw.index === 'number' && Number.isFinite(raw.index) ? raw.index : null
    const url = typeof raw.url === 'string' ? raw.url : ''
    out.push({
      title: word,
      url,
      // 置顶条目不参与排名（isTop），其余 index 本身就是 1 起的榜位
      rank: raw.isTop === true || index === null ? null : index,
      source: '百度热搜',
      desc: '',
    })
  }

  const walk = (node: unknown, depth: number): void => {
    if (depth > 5 || out.length >= limit) return
    const record = asRecord(node)
    if (record) {
      if (typeof record.word === 'string') {
        push(record)
        return
      }
      for (const value of Object.values(record)) walk(value, depth + 1)
      return
    }
    if (Array.isArray(node)) {
      for (const value of node) walk(value, depth + 1)
    }
  }

  walk(cards, 0)
  return out.slice(0, limit)
}

/** 极简 RSS/Atom 解析：<item> 与 <entry> 都认，只要 title/link/description。
 *
 * 不做完整 XML 解析（不引依赖）：RSS 这层只用于补充要闻，解析失败就没条目，
 * 不能因为一条脏 feed 把主源带崩。
 */
export function parseRssItems(xml: string, source: string, limit: number): NewsItem[] {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/g) ?? []
  const out: NewsItem[] = []
  for (const block of blocks) {
    if (out.length >= limit) break
    const title = stripTags(matchTag(block, 'title'))
    if (!title || isJunk(title)) continue
    let url = stripTags(matchTag(block, 'link'))
    if (!url) {
      // Atom：<link href="..."/>
      const href = /<link\b[^>]*href="([^"]+)"/.exec(block)
      url = href?.[1] ?? ''
    }
    const desc = stripTags(matchTag(block, 'description') || matchTag(block, 'summary') || matchTag(block, 'content'))
    out.push({
      title: cleanTitle(title),
      url,
      rank: null,
      source,
      desc: desc.slice(0, 120),
    })
  }
  return out
}

function matchTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  return re.exec(xml)?.[1] ?? ''
}

function stripTags(html: string): string {
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export interface FetchOptions {
  limit: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** 抓百度热搜。失败抛错（由调用方转成「这次没取到」）。 */
export async function fetchBaiduHot(options: FetchOptions): Promise<NewsItem[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const resp = await fetchImpl(BAIDU_HOT_URL, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS),
  })
  if (!resp.ok) throw new Error(`百度热搜 HTTP ${resp.status}`)
  const json: unknown = await resp.json()
  return parseBaiduHot(json, options.limit)
}

/** 抓一个 RSS 源。失败回空数组（补充源，坏了不该影响主源）。 */
export async function fetchFeed(url: string, options: FetchOptions): Promise<NewsItem[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const resp = await fetchImpl(url, {
      headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8' },
      signal: AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS),
    })
    if (!resp.ok) return []
    const xml = await resp.text()
    return parseRssItems(xml, hostOf(url), options.limit)
  } catch {
    return []
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'RSS'
  }
}

/** 汇总：主源 + 补充源，去重后截断。主源失败且补充源也空 → 抛错。 */
export async function collectNews(options: {
  limit: number
  extraFeeds?: string[]
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<{ items: NewsItem[]; warnings: string[] }> {
  const warnings: string[] = []
  const fetchOpts: FetchOptions = { limit: options.limit }
  if (options.fetchImpl) fetchOpts.fetchImpl = options.fetchImpl
  if (options.timeoutMs !== undefined) fetchOpts.timeoutMs = options.timeoutMs

  let primary: NewsItem[] = []
  try {
    primary = await fetchBaiduHot(fetchOpts)
  } catch (error) {
    warnings.push(`百度热搜没取到：${error instanceof Error ? error.message : String(error)}`)
  }

  const extras: NewsItem[] = []
  for (const feed of options.extraFeeds ?? []) {
    const got = await fetchFeed(feed, { ...fetchOpts, limit: 3 })
    if (got.length === 0) warnings.push(`RSS 空或失败：${feed}`)
    extras.push(...got)
    if (extras.length >= 3) break
  }

  const merged = [...primary]
  const seen = new Set(merged.map((item) => item.title))
  for (const item of extras) {
    if (seen.has(item.title)) continue
    seen.add(item.title)
    merged.push(item)
  }
  if (merged.length === 0) {
    throw new Error(warnings.join('；') || '一条都没取到')
  }
  return { items: merged.slice(0, options.limit), warnings }
}
