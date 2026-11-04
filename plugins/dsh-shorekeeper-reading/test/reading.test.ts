import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShelfStore } from '../src/shelf.ts'
import { createReadingTools } from '../src/tools.ts'
import type { ListenEngine } from '../src/listen.ts'

let dir: string

// 夹具 = migration/export_books.py render_shelf 的真实输出（2026-11-03 真数据导出后照抄）
const SHELF = {
  version: 1,
  imported_from: 'dock-hub books (migration/export_books.py)',
  books: [
    {
      id: '我合成了全世界',
      title: '我合成了全世界',
      author: '王自律',
      status: 'reading',
      source: 'migration',
      added_at: 1793641666,
      last_read_at: 1793641666,
      finished_at: null,
      progress: {
        kind: 'char',
        char_offset: 596983,
        percent: 17.64,
        chapter_index: 217,
        chapter_title: '第221章 终极掌控2',
        fidelity: 'approx',
      },
      migrated: {
        book_id: '我合成了全世界(王自律).txt',
        source_file: '我合成了全世界(王自律).txt',
        sha256: 'cebb4449f41b77f0803061905d57ce064fc0514effd018a004fa6c5176b8c47a',
        bytes: 9793913,
        oversize: false,
      },
    },
    {
      id: '合成岸边',
      title: '合成岸边',
      author: null,
      status: 'wishlist',
      source: 'migration',
      added_at: null,
      last_read_at: null,
      finished_at: null,
      progress: null,
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
  // 听书引擎不在本文件测（listen.test.ts），给个空壳满足依赖面
  const stub = {
    get status() { return null },
    get playing() { return false },
    start: () => false,
    stop: async () => null,
    resumeCandidate: () => null,
  } as unknown as ListenEngine
  return createReadingTools({ store: store(), listen: stub })
}

function byName(name: string) {
  const tool = tools().find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`工具不存在：${name}`)
  return tool
}

describe('reading.shelf', () => {
  it('列出书架与进度（真实 schema）', async () => {
    const result = (await byName('reading.shelf').execute({}, {} as never)) as { summary: string; total: number }
    expect(result.total).toBe(2)
    expect(result.summary).toContain('我合成了全世界 · 王自律 · 读到 17.64%')
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
    expect(data.getProgress('我合成了全世界')?.char_offset).toBe(596983) // 迁移书签保留
  })

  it('percent 到 100 自动读完并盖 finished_at', async () => {
    await byName('reading.progress').execute({ book: '我合成了全世界', percent: 100 }, {} as never)
    const book = store().books[0]
    expect(book?.status).toBe('finished')
    expect(book?.finished_at).not.toBeNull()
  })

  it('想读的书一记进度就转在读', async () => {
    await byName('reading.progress').execute({ book: '合成岸边', percent: 1 }, {} as never)
    expect(store().books[1]?.status).toBe('reading')
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
