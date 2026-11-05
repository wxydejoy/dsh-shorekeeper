/** /reading-panel 面板 RPC 测试：信封契约（error.code/message/details）、
 * books/status/play/stop 四动作与引擎联动。
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apply } from '../src/index.ts'
import type { Book, ShelfData } from '../src/shelf.ts'

function makeBook(overrides: Partial<Book>): Book {
  return {
    id: 'b-1',
    title: '测试之书',
    author: '佚名',
    status: 'reading',
    source: 'test',
    added_at: null,
    last_read_at: null,
    finished_at: null,
    progress: null,
    ...overrides,
  }
}

describe('/reading-panel RPC', () => {
  let dataDir: string
  let handlers: Record<string, (action: string, payload: unknown) => Promise<unknown>>

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'reading-panel-'))
    const shelf: ShelfData = {
      version: 1,
      books: [
        makeBook({}),
        makeBook({ id: 'b-2', title: '没有文件的书', status: 'wishlist', progress: null }),
        makeBook({
          id: 'b-3',
          title: '在盘上的想读',
          status: 'wishlist',
          migrated: { book_id: 'b-3', source_file: 'b-3.txt', sha256: null, bytes: null, oversize: false },
        }),
        makeBook({
          id: 'b-4',
          title: '有章节的书',
          status: 'reading',
          progress: { kind: 'char', char_offset: 0 },
          migrated: { book_id: 'b-4', source_file: 'b-4.txt', sha256: null, bytes: null, oversize: false },
        }),
      ],
    }
    writeFileSync(join(dataDir, 'shelf.json'), JSON.stringify(shelf))
    writeFileSync(join(dataDir, 'notes.json'), JSON.stringify({ schema_version: 1, notes: [] }))
    mkdirSync(join(dataDir, 'books-txt'))
    writeFileSync(join(dataDir, 'books-txt', 'b-3.txt'), '第一句。第二句。第三句。')
    writeFileSync(
      join(dataDir, 'books-txt', 'b-4.txt'),
      '第一章 开始\n上山打水。\n第二章 继续\n下山回家。故事很长。\n第三章 收尾\n完了。',
    )

    // 全局 fetch 桩：探活路由抛错（=不在线）；合成请求挂起直到 abort（模拟慢合成，
    // 让 stop 收到 stoppedBy:'user' 而不是抢先的 network error）
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const target = String(url)
        if (target.includes('/v1/models')) throw new TypeError('fetch failed')
        if (target.includes('/v1/stop')) return new Response('{}', { status: 200 })
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })),
            { once: true },
          )
        })
      }),
    )

    handlers = {}
    const ctx = {
      tools: { register: vi.fn() },
      connection: {
        rpc: {
          handle: (channel: string, handler: (action: string, payload: unknown) => Promise<unknown>) => {
            handlers[channel] = handler
            return async () => {}
          },
        },
      },
      logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    }
    apply(ctx as never, { dataDir, ttsBaseUrl: 'http://127.0.0.1:1', ttsSpeed: 1.0 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const call = async (action: string, payload: unknown = {}) =>
    (await handlers['/reading-panel']?.(action, payload)) as Record<string, unknown>

  it('挂载 /reading-panel 通道', () => {
    expect(handlers['/reading-panel']).toBeTypeOf('function')
  })

  it('books：列书架 + 断点 + tts 探活（不在线=false）', async () => {
    const res = await call('books')
    expect(res.ok).toBe(true)
    const value = res.value as {
      books: Array<Record<string, unknown>>
      ttsAlive: boolean
      currentId: null
      playing: boolean
      resume: Record<string, unknown> | null
    }
    expect(value.books).toHaveLength(4)
    expect(value.books.map((b) => b.readable)).toEqual([false, false, true, true])
    expect(value.ttsAlive).toBe(false)
    expect(value.currentId).toBeNull()
    // 面板 3s 轮询只调 books——实时引擎状态必须带上，否则别处开的朗读面板看不见
    expect(value.playing).toBe(false)
    expect(value.resume).toEqual({ id: 'b-1', title: '测试之书', offset: 0 })
  })

  it('play：文件不在盘上 → ok:false + 完整信封', async () => {
    const res = await call('play', { bookId: 'b-2' })
    expect(res.ok).toBe(false)
    const error = res.error as { code: string; message: string; details: object }
    expect(typeof error.code).toBe('string')
    expect(error.message).toContain('不在盘上')
    expect(error.details).toEqual({})
  })

  it('play：成功开读（想读联动在读）→ status 可查 → stop 收尾', async () => {
    const started = await call('play', { bookId: 'b-3', speed: 1.5, timerMin: 5 })
    expect(started.ok).toBe(true)
    const snap = started.value as { playing: boolean; status: { playing: boolean; title: string } }
    expect(snap.playing).toBe(true)
    expect(snap.status.title).toBe('在盘上的想读')

    // shelf.json 状态联动：wishlist → reading
    const shelf = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(join(dataDir, 'shelf.json'), 'utf-8'))) as ShelfData
    expect(shelf.books.find((b) => b.id === 'b-3')?.status).toBe('reading')

    const stopped = await call('stop')
    expect(stopped.ok).toBe(true)
    const stopSnap = stopped.value as { playing: boolean; status: { stoppedBy: string } | null }
    expect(stopSnap.playing).toBe(false)
    expect(stopSnap.status?.stoppedBy).toBe('user')
  }, 15_000)

  it('play：重复开读 → 报错文案', async () => {
    await call('play', { bookId: 'b-3' })
    const res = await call('play', { bookId: 'b-3' })
    expect(res.ok).toBe(false)
    expect((res.error as { message: string }).message).toContain('先停止')
    await call('stop')
  }, 15_000)

  it('未知动作 → bad_action 信封', async () => {
    const res = await call('nope')
    expect(res.ok).toBe(false)
    expect((res.error as { code: string }).code).toBe('bad_action')
  })

  it('chapters：扫出章节结构，start 是原文坐标；无结构返回 0', async () => {
    const withChapters = await call('chapters', { bookId: 'b-4' })
    expect(withChapters.ok).toBe(true)
    const value = withChapters.value as { total: number; chapters: Array<{ title: string; start: number }> }
    expect(value.total).toBe(3)
    expect(value.chapters[0]?.title).toBe('第一章 开始')
    expect(value.chapters[1]?.title).toBe('第二章 继续')
    // 第二章标题的原文坐标
    const text = '第一章 开始\n上山打水。\n第二章 继续\n下山回家。故事很长。\n第三章 收尾\n完了。'
    expect(value.chapters[1]?.start).toBe(text.indexOf('第二章 继续'))

    const none = await call('chapters', { bookId: 'b-3' })
    expect((none.value as { total: number }).total).toBe(0)
  })

  it('play：fromOffset 从指定坐标起播（章节直达）', async () => {
    const chapters = await call('chapters', { bookId: 'b-4' })
    const second = (chapters.value as { chapters: Array<{ start: number }> }).chapters[1]
    const res = await call('play', { bookId: 'b-4', fromOffset: second?.start, timerMin: 0 })
    expect(res.ok).toBe(true)
    const snap = res.value as { status: { offset: number; playing: boolean } }
    expect(snap.status.offset).toBe(second?.start)
    expect(snap.status.playing).toBe(true)
    await call('stop')
  }, 15_000)

  it('import：UTF-8 直解 → 入书架可读；重名报错；GBK 字节回落解码', async () => {
    const content = '第一章 起\n正文内容。\n第二章 承\n接着读。\n'
    const imported = await call('import', {
      name: '导入的书.txt',
      dataBase64: Buffer.from(content, 'utf-8').toString('base64'),
    })
    expect(imported.ok).toBe(true)
    const book = (imported.value as { book: { id: string; readable: boolean } }).book
    expect(book.id).toBe('导入的书')
    expect(book.readable).toBe(true)

    const chapters = await call('chapters', { bookId: '导入的书' })
    expect((chapters.value as { total: number }).total).toBe(2)

    const dup = await call('import', {
      name: '导入的书.txt',
      dataBase64: Buffer.from(content, 'utf-8').toString('base64'),
    })
    expect(dup.ok).toBe(false)
    expect((dup.error as { message: string }).message).toContain('同名')

    // GBK「我」= 0xCE 0xD2（非合法 UTF-8 → 回落 gb18030）
    const gbk = await call('import', {
      name: 'GBK书.txt',
      dataBase64: Buffer.from([0xce, 0xd2]).toString('base64'),
    })
    expect(gbk.ok).toBe(true)
    const gbkBook = (gbk.value as { book: { id: string } }).book
    expect(gbkBook.id).toBe('GBK书')
    const text = await import('node:fs/promises').then((fs) =>
      fs.readFile(join(dataDir, 'books-txt', 'GBK书.txt'), 'utf-8'),
    )
    expect(text).toBe('我')
  })
})
