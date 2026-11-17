import { describe, expect, it } from 'vitest'
import { cleanTitle, collectNews, parseBaiduHot, parseRssItems } from '../src/feed.ts'

/** 百度热搜真实形状（2026-11-18 实测裁剪）：cards → content → content[] → 条目。 */
const baiduFixture = {
  success: true,
  data: {
    cards: [
      {
        component: 'tabTextList',
        content: [
          {
            content: [
              { isTop: true, url: 'https://m.baidu.com/s?word=top', word: '置顶的重大新闻在这里发生' },
              { isTop: false, index: 1, url: 'https://m.baidu.com/s?word=a', word: '小米回应雷军APEC发言紧张', hotTag: '3' },
              { isTop: false, index: 2, url: 'https://m.baidu.com/s?word=b', word: 'U19国足2比1韩国夺冠' },
              { isTop: false, index: 3, url: 'https://m.baidu.com/s?word=c', word: '暴雨蓝色预警（视频）' },
              { isTop: false, index: 4, url: 'https://m.baidu.com/s?word=d', word: '查看更多' },
              { isTop: false, index: 5, url: 'https://m.baidu.com/s?word=e', word: '小米回应雷军APEC发言紧张' },
            ],
          },
        ],
      },
    ],
  },
}

describe('parseBaiduHot', () => {
  it('逐层找 word 字段，跳过导流位、去重、保留榜位', () => {
    const items = parseBaiduHot(baiduFixture, 10)
    expect(items.map((item) => item.title)).toEqual([
      '置顶的重大新闻在这里发生',
      '小米回应雷军APEC发言紧张',
      'U19国足2比1韩国夺冠',
      '暴雨蓝色预警',
    ])
    expect(items.map((item) => item.rank)).toEqual([null, 1, 2, 3])
    expect(items[1]!.source).toBe('百度热搜')
    // 没摘要就是空串，不是 undefined —— 播报端不用再判空类型
    expect(items[1]!.desc).toBe('')
  })

  it('limit 生效', () => {
    expect(parseBaiduHot(baiduFixture, 2)).toHaveLength(2)
  })

  it('结构不对/空响应回空数组，不抛', () => {
    expect(parseBaiduHot(null, 5)).toEqual([])
    expect(parseBaiduHot({}, 5)).toEqual([])
    expect(parseBaiduHot({ data: { cards: [] } }, 5)).toEqual([])
  })
})

describe('cleanTitle', () => {
  it('去掉版式标记和尾部标点', () => {
    expect(cleanTitle('某地发布暴雨预警（视频）')).toBe('某地发布暴雨预警')
    expect(cleanTitle('【组图】春天来了！')).toBe('春天来了')
    expect(cleanTitle('  多   空格  ')).toBe('多 空格')
  })
})

describe('parseRssItems', () => {
  it('RSS item：title/link/description（CDATA 与实体）', () => {
    const xml = `<rss><channel>
      <item><title><![CDATA[长沙入选世界美食之都]]></title>
        <link>https://example.com/1</link>
        <description><![CDATA[<p>联合国教科文组织公布新一批名单。</p>]]></description></item>
      <item><title>AI &amp; 芯片：新进展</title><link>https://example.com/2</link></item>
    </channel></rss>`
    const items = parseRssItems(xml, 'example.com', 5)
    expect(items).toHaveLength(2)
    expect(items[0]!.title).toBe('长沙入选世界美食之都')
    expect(items[0]!.url).toBe('https://example.com/1')
    expect(items[0]!.desc).toBe('联合国教科文组织公布新一批名单。')
    expect(items[1]!.title).toBe('AI & 芯片：新进展')
    expect(items[1]!.desc).toBe('')
  })

  it('Atom entry：link 用 href', () => {
    const xml = `<feed><entry><title>一条 Atom 消息</title>
      <link rel="alternate" href="https://example.com/atom"/></entry></feed>`
    const items = parseRssItems(xml, 'example.com', 5)
    expect(items[0]!.url).toBe('https://example.com/atom')
  })

  it('空/脏 XML 回空数组', () => {
    expect(parseRssItems('not xml at all', 'x', 5)).toEqual([])
  })
})

describe('collectNews', () => {
  it('主源可用时直接用主源', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify(baiduFixture), { status: 200 })) as unknown as typeof fetch
    const got = await collectNews({ limit: 3, fetchImpl })
    expect(got.items).toHaveLength(3)
    expect(got.warnings).toEqual([])
  })

  it('主源挂了但有 RSS：用 RSS 顶上并记警示', async () => {
    const rss = `<rss><channel><item><title>备用源的一条要闻</title><link>https://e.com/1</link></item></channel></rss>`
    const fetchImpl = (async (url: string | URL | Request) => {
      const href = String(url)
      if (href.includes('top.baidu.com')) return new Response('blocked', { status: 503 })
      return new Response(rss, { status: 200 })
    }) as unknown as typeof fetch
    const got = await collectNews({ limit: 5, extraFeeds: ['https://e.com/feed'], fetchImpl })
    expect(got.items.map((item) => item.title)).toEqual(['备用源的一条要闻'])
    expect(got.warnings[0]).toContain('百度热搜没取到')
  })

  it('全挂：抛错（调用方转成「这次没取到」）', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    await expect(collectNews({ limit: 5, fetchImpl })).rejects.toThrow(/没取到|HTTP/)
  })
})
