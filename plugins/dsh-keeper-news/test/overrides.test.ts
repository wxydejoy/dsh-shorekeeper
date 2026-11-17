import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyNewsOverrides, readNewsOverridesSync, type NewsOverrides } from '../src/overrides.ts'
import { Config, type NewsConfig } from '../src/config.ts'
import { NewsState } from '../src/state.ts'

function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'keeper-news-'))
  const path = join(dir, 'keeper-settings.json')
  writeFileSync(path, content, 'utf8')
  return path
}

// Schemastery 的调用签名要求全量对象，测试里传空对象拿默认值（运行时就是这么用的）
const base: NewsConfig = Config({} as never)

describe('readNewsOverridesSync', () => {
  it('读 news 段并消毒', () => {
    const path = tmpFile(JSON.stringify({ news: { enabled: false, morningAt: '07:45', count: 42, speakOnlyWhenPresent: false } }))
    const o = readNewsOverridesSync(path)
    expect(o.enabled).toBe(false)
    expect(o.morningAt).toBe('07:45')
    expect(o.count).toBe(10) // 上限 10
    expect(o.speakOnlyWhenPresent).toBe(false)
  })

  it('文件缺失/坏 JSON/没有 news 段 → 空覆盖（全部回落基线）', () => {
    expect(readNewsOverridesSync('/nonexistent/keeper-settings.json')).toEqual({})
    expect(readNewsOverridesSync(tmpFile('{oops'))).toEqual({})
    expect(readNewsOverridesSync(tmpFile(JSON.stringify({ watch: { enabled: true } })))).toEqual({})
  })

  it('其它段（watch）在这里不会被误读', () => {
    const path = tmpFile(JSON.stringify({ watch: { enabled: false, dailyLimit: 3 } }))
    expect(readNewsOverridesSync(path)).toEqual({})
  })
})

describe('applyNewsOverrides', () => {
  it('显式字段覆盖，其余保持基线', () => {
    const o: NewsOverrides = { enabled: false, count: 3 }
    const merged = applyNewsOverrides(base, o)
    expect(merged.enabled).toBe(false)
    expect(merged.count).toBe(3)
    expect(merged.morningAt).toBe(base.morningAt)
    expect(merged.volume).toBe(base.volume)
  })

  it('空覆盖 = 原样返回', () => {
    expect(applyNewsOverrides(base, {})).toEqual(base)
  })
})

describe('NewsState', () => {
  it('today 已经播过就记得住（跨重启），最近一次稿子也留得住', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'keeper-news-state-')), 'state.json')
    const a = new NewsState(path)
    expect(a.lastRunDate('morning')).toBeNull()
    a.markRan('morning', '2026-11-18')
    a.remember('今天的热搜：第一条……', ['标题一', '标题二'], 1763000000000)

    const b = new NewsState(path) // 模拟重启：新实例读同一文件
    expect(b.lastRunDate('morning')).toBe('2026-11-18')
    expect(b.lastRunDate('evening')).toBeNull()
    expect(b.lastText).toContain('第一条')
    expect(b.lastTitles).toEqual(['标题一', '标题二'])
    expect(b.lastAt).toBe(1763000000000)
  })

  it('状态文件坏了当空状态，不抛', () => {
    const path = tmpFile('not json')
    const state = new NewsState(path)
    expect(state.lastRunDate('morning')).toBeNull()
    expect(state.lastText).toBe('')
  })
})
