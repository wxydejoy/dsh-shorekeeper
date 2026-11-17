import { describe, expect, it } from 'vitest'
import { buildSpokenBrief, buildTextBrief, estimateSpeakSec, parseHm, resolvePeriod } from '../src/brief.ts'
import type { NewsItem } from '../src/feed.ts'

const items: NewsItem[] = Array.from({ length: 7 }, (_, i) => ({
  title: `第${i + 1}件值得听的事发生了`,
  url: `https://m.baidu.com/s?word=${i + 1}`,
  rank: i + 1,
  source: '百度热搜',
  desc: '',
}))

describe('buildSpokenBrief', () => {
  it('5 条：开场 + 中文序数 + 收尾，能直接念', () => {
    const brief = buildSpokenBrief(items, { count: 5, period: 'evening' })
    expect(brief.picked).toHaveLength(5)
    expect(brief.text).toContain('晚上好')
    expect(brief.text).toContain('第一条，第1件值得听的事发生了。')
    expect(brief.text).toContain('第五条，第5件值得听的事发生了。')
    expect(brief.text).not.toContain('第六件')
    expect(brief.text).toMatch(/就这些|念完了/)
  })

  it('早报开场白与点播不同', () => {
    expect(buildSpokenBrief(items, { count: 3, period: 'morning' }).text.startsWith('早上好')).toBe(true)
    expect(buildSpokenBrief(items, { count: 3, period: 'now' }).text.startsWith('好，说说现在热搜上的事')).toBe(true)
  })

  it('条目不足时如实说，不硬凑', () => {
    const brief = buildSpokenBrief(items.slice(0, 2), { count: 5 })
    expect(brief.picked).toHaveLength(2)
    expect(brief.text).toContain('就这几条')
  })

  it('一条都没有：一句话交代，不抛', () => {
    const brief = buildSpokenBrief([], { count: 5 })
    expect(brief.picked).toHaveLength(0)
    expect(brief.text).toContain('没取到新闻')
  })

  it('RSS 条目带摘要时补一句背景（百度热搜不补）', () => {
    const mixed: NewsItem[] = [
      { title: '百度的一条热搜标题', url: '', rank: 1, source: '百度热搜', desc: '这段不该被念出来' },
      { title: '长沙入选世界美食之都', url: '', rank: null, source: '36kr.com', desc: '联合国教科文组织公布新一批名单' },
    ]
    const text = buildSpokenBrief(mixed, { count: 2 }).text
    expect(text).not.toContain('这段不该被念出来')
    expect(text).toContain('联合国教科文组织公布新一批名单。')
  })

  it('估时随字数线性变化（5 条约 40 秒量级）', () => {
    const brief = buildSpokenBrief(items, { count: 5 })
    expect(brief.estimatedSec).toBeGreaterThan(20)
    expect(brief.estimatedSec).toBeLessThan(70)
    expect(estimateSpeakSec('一二三四')).toBe(1)
  })
})

describe('buildTextBrief', () => {
  it('编号 + 标题 + 链接', () => {
    const text = buildTextBrief(items, { count: 2 })
    expect(text).toContain('1. 第1件值得听的事发生了\nhttps://m.baidu.com/s?word=1')
    expect(text).toContain('2. 第2件值得听的事发生了')
    expect(text).not.toContain('3. ')
  })

  it('空列表给一句话', () => {
    expect(buildTextBrief([], { count: 3 })).toContain('没取到新闻')
  })
})

describe('resolvePeriod / parseHm', () => {
  it('离早报/晚报两小时内按那个开场', () => {
    const at = (h: number, m: number): Date => new Date(2026, 10, 18, h, m)
    expect(resolvePeriod(at(8, 31), '08:30', '21:00')).toBe('morning')
    expect(resolvePeriod(at(21, 5), '08:30', '21:00')).toBe('evening')
    expect(resolvePeriod(at(14, 0), '08:30', '21:00')).toBe('now')
  })

  it('parseHm 拒绝脏值', () => {
    expect(parseHm('08:30')).toBe(510)
    expect(parseHm('8:3')).toBeNull()
    expect(parseHm('24:00')).toBeNull()
    expect(parseHm('')).toBeNull()
  })
})
