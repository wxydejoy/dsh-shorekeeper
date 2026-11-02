import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShelfStore } from '../src/shelf.ts'
import { createReadingTools } from '../src/tools.ts'

let dir: string

const SHELF = {
  schema_version: 1,
  books: [
    {
      id: '我合成了全世界',
      title: '我合成了全世界',
      author: '王自律',
      source_file: '我合成了全世界(王自律).txt',
      bytes: 100,
      sha256: null,
      status: 'reading',
      chars: 1000,
      chapters: [{ index: 0, title: '第一章', start: 0, end: 1000 }],
      fidelity: 'approx',
      percent: 21.7,
      current_chapter: { index: 0, title: '第一章' },
      encoding: 'utf-8',
      migrated: { book_id: '我合成了全世界(王自律).txt', offset: 217, updated_at: 1793629687 },
    },
    {
      id: '合成岸边',
      title: '合成岸边',
      author: null,
      source_file: '合成岸边.txt',
      bytes: 10,
      sha256: null,
      status: 'wishlist',
      chars: null,
      chapters: [],
      fidelity: null,
      percent: null,
      current_chapter: null,
      encoding: null,
    },
  ],
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reading-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'shelf.json'), JSON.stringify(SHELF), 'utf-8')
  writeFileSync(join(dir, 'notes.json'), JSON.stringify({ schema_version: 1, notes: [] }), 'utf-8')
})

afterEach(() => {
  void dir
})

function store() {
  return new ShelfStore(dir)
}

function tools() {
  return createReadingTools({ store: store() })
}

function byName(name: string) {
  const tool = tools().find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`工具不存在：${name}`)
  return tool
}

describe('reading.shelf', () => {
  it('列出书架与进度', async () => {
    const result = (await byName('reading.shelf').execute({}, {} as never)) as { summary: string; total: number }
    expect(result.total).toBe(2)
    expect(result.summary).toContain('我合成了全世界 · 王自律 · 读到 21.7%')
    expect(result.summary).toContain('想读')
  })

  it('按状态过滤', async () => {
    const result = (await byName('reading.shelf').execute({ status: 'wishlist' }, {} as never)) as { total: number }
    expect(result.total).toBe(1)
  })
})

describe('reading.progress', () => {
  it('「看到 217 页了」→ 记进度并联动状态', async () => {
    const result = (await byName('reading.progress').execute(
      { book: '我合成了全世界', page: 217 },
      {} as never,
    )) as { ok: boolean; summary: string }
    expect(result.ok).toBe(true)
    expect(result.summary).toContain('第 217 页')
    const data = store()
    expect(data.books[0]?.status).toBe('reading')
    expect(data.getProgress('我合成了全世界')?.page).toBe(217)
  })

  it('percent 到 100 自动读完', async () => {
    await byName('reading.progress').execute({ book: '我合成了全世界', percent: 100 }, {} as never)
    expect(store().books[0]?.status).toBe('finished')
  })

  it('书名歧义 → 请说具体些', async () => {
    const result = (await byName('reading.progress').execute({ book: '合成', page: 1 }, {} as never)) as {
      ok: false
      degraded: string
    }
    expect(result.ok).toBe(false)
    expect(result.degraded).toContain('具体')
  })

  it('不存在的书 → 如实说', async () => {
    const result = (await byName('reading.progress').execute({ book: '不存在的书', page: 1 }, {} as never)) as {
      ok: false
      degraded: string
    }
    expect(result.degraded).toContain('没有找到')
  })
})

describe('reading.note', () => {
  it('摘抄落库并关联书', async () => {
    const result = (await byName('reading.note').execute(
      { book: '我合成了全世界', text: '时间还在，别急。', thought: '第四章的金句', chapterTitle: '第一章' },
      {} as never,
    )) as { ok: boolean; summary: string }
    expect(result.ok).toBe(true)
    expect(result.summary).toContain('《我合成了全世界》')
    expect(store().notes).toHaveLength(1)
    expect(store().notes[0]?.thought).toBe('第四章的金句')
  })

  it('不关联书的自由随想', async () => {
    const result = (await byName('reading.note').execute({ text: '夜里灯带会自己暗下去。' }, {} as never)) as {
      summary: string
    }
    expect(result.summary).toContain('自由随想')
  })
})

describe('reading.ask', () => {
  it('从摘抄与书目里检索', async () => {
    await byName('reading.note').execute(
      { book: '我合成了全世界', text: '书签还在上次那页。' },
      {} as never,
    )
    const result = (await byName('reading.ask').execute({ question: '书签' }, {} as never)) as {
      summary: string
    }
    expect(result.summary).toContain('书签还在上次那页')
  })

  it('没命中就如实说', async () => {
    const result = (await byName('reading.ask').execute({ question: '量子力学' }, {} as never)) as {
      summary: string
    }
    expect(result.summary).toContain('没有命中')
  })
})
