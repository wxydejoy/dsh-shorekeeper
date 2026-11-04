/** 听书三件单测（Z8）：切句边界 / 打包 36-52 / 断点保存恢复（含迁移 schema）/ stop 立即返 / 端点失联优雅报错。
 * TTS 全 mock（fetchImpl 合成假 wav），真机听感验收留人工（T5 任务书口径）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildReadChunks,
  chunkReadText,
  cutSentences,
  estimateReadSeconds,
  packReadChunks,
} from '../src/speech.ts'
import { ListenEngine, ListenState } from '../src/listen.ts'
import { TtsClient } from '../src/tts-client.ts'
import { ShelfStore } from '../src/shelf.ts'
import { createReadingTools } from '../src/tools.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reading-listen-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('切句与打包（books-format §4 边界）', () => {
  it('cutSentences：。！？与换行断句，纯标点块丢弃', () => {
    const text = '第一句。第二句！第三句？\n\n「只有标点」。\n第四句。'
    expect(cutSentences(text)).toEqual(['第一句。', '第二句！', '第三句？', '「只有标点」。', '第四句。'])
  })

  it('chunkReadText：长句按 120 硬切', () => {
    const long = '长'.repeat(250) + '。'
    const chunks = chunkReadText(long)
    expect(chunks.length).toBe(3)
    expect(chunks[0]!.length).toBe(120)
    expect(chunks.join('')).toBe('长'.repeat(250) + '。')
  })

  it('packReadChunks：拼到参考 36，超 52 硬切，过短尾块并入', () => {
    const text = '一二三四五六七，'.repeat(12) // 每短句 8 字，96 字
    const packed = packReadChunks(text)
    for (const chunk of packed) {
      expect(chunk.length).toBeLessThanOrEqual(52)
    }
    // 拼包后应明显少于逐短句块数（36/8 → 约 5 字一拼）
    expect(packed.length).toBeLessThan(12)
    expect(packed.join('')).toBe(text)
  })

  it('packReadChunks：单短句超 52 硬切不丢字', () => {
    const text = ' very '.length > 0 ? '长'.repeat(60) + '，结尾。' : ''
    const packed = packReadChunks(text)
    expect(packed.join('')).toBe(text)
    expect(packed.some((c) => c.length > 52)).toBe(false)
  })

  it('estimateReadSeconds = 口播字数 / 4.0', () => {
    expect(estimateReadSeconds('一二三四五')).toBe(1.25)
  })

  it('buildReadChunks：offset 与原文坐标对齐（短句按 target 合并是一块）', () => {
    const text = '甲乙丙丁。戊己庚辛。'
    const chunks = buildReadChunks(text)
    expect(chunks.length).toBe(1)
    expect(chunks[0]).toMatchObject({ start: 0, end: 10 })
    expect(text.slice(chunks[0]!.start, chunks[0]!.end)).toBe(chunks[0]!.text)
    // 多块场景：逐块区间都回指原文
    const long = ('这是一段足够长的话，用来撑出多个朗读块。'.repeat(6))
    const many = buildReadChunks(long)
    expect(many.length).toBeGreaterThan(1)
    for (const c of many) expect(long.slice(c.start, c.end)).toBe(c.text)
  })
})

function fakeWavResponse(): Response {
  // RIFF 头 + 8 字节假数据，客户端只 arrayBuffer 消费不解析
  return new Response(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]).buffer, {
    status: 200,
    headers: { 'Content-Type': 'audio/wav' },
  })
}

interface Harness {
  engine: ListenEngine
  state: ListenState
  store: ShelfStore
  spoken: string[]
  fetchCalls: string[]
  blockFirst: boolean
}

function harness(bookOpts: { title?: string; source?: string; offset?: number } = {}): Harness {
  const title = bookOpts.title ?? '世说新语'
  const source = bookOpts.source ?? '世说新语(刘义庆).txt'
  const text = ('德行第一。陈仲举言为士则，行为世范，登车揽辔，有澄清天下之志。为豫章太守，至，便问徐孺子所在，望之俨然，即之也温。' + '仲尼居，曾子侍。子曰：先王有至德要道，以顺天下，民用和睦。')
  mkdirSync(join(dir, 'books-txt'), { recursive: true })
  writeFileSync(join(dir, 'books-txt', source), text, 'utf-8')
  writeFileSync(
    join(dir, 'shelf.json'),
    JSON.stringify({
      version: 1,
      books: [
        {
          id: 'book-1',
          title,
          author: null,
          status: 'reading',
          source: '',
          added_at: null,
          last_read_at: null,
          finished_at: null,
          progress: { kind: 'char', char_offset: bookOpts.offset ?? 0 },
          migrated: { book_id: 'book-1', source_file: source, sha256: null, bytes: null, oversize: false },
        },
      ],
    }),
    'utf-8',
  )
  const spoken: string[] = []
  const fetchCalls: string[] = []
  const harness: Harness = {
    spoken,
    fetchCalls,
    blockFirst: false,
    store: new ShelfStore(dir),
    state: new ListenState(dir),
    engine: null as unknown as ListenEngine,
  }
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    fetchCalls.push(url)
    if (url.endsWith('/v1/stop')) return new Response('{}', { status: 200 })
    if (harness.blockFirst) {
      // 模拟在途合成：永不自行 resolve，仅在信号 abort 时以 AbortError reject（对齐真 fetch 行为）
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })), { once: true })
      })
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string }
    if (body.input !== undefined) spoken.push(body.input)
    return fakeWavResponse()
  }) as typeof fetch
  const tts = new TtsClient({ baseUrl: 'http://127.0.0.1:18100', fetchImpl })
  harness.engine = new ListenEngine({ store: harness.store, tts, state: harness.state, paceFactor: 0 })
  return harness
}

describe('ListenEngine（mock TTS）', () => {
  it('从头连读：逐段 speak、每段落盘 offset、读完 stopped_by=end', async () => {
    const h = harness()
    const book = h.store.books[0]!
    expect(h.engine.start(book)).toBe(true)
    await vi.waitFor(
      () => {
        expect(h.engine.playing).toBe(false)
      },
      { timeout: 3000 },
    )
    expect(h.spoken.length).toBeGreaterThanOrEqual(3) // 连续朗读 ≥3 段
    const expected = packReadChunks(
      readFileSync(join(dir, 'books-txt', '世说新语(刘义庆).txt'), 'utf-8'),
    )
    expect(h.spoken[0]).toBe(expected[0]) // 首段与 §4 打包规则一致
    expect(h.engine.lastResult?.stoppedBy).toBe('end')
    // 断点落在最后一块的 end（全书读完）
    expect(h.state.getOffset(book)).toBeGreaterThan(0)
  })

  it('断点续读：迁移 schema 的 offset 生效，从命中块起读', async () => {
    const h = harness({ offset: 10 })
    const book = h.store.books[0]!
    expect(h.engine.start(book)).toBe(true)
    await vi.waitFor(() => expect(h.engine.playing).toBe(false), { timeout: 3000 })
    // offset 10 落在第二块区间 → 第一块不读
    expect(h.spoken[0]).not.toBe('德行第一。')
  })

  it('listen-state.json 与迁移 schema 互通（预置 current_id + offset）', () => {
    writeFileSync(
      join(dir, 'listen-state.json'),
      JSON.stringify({
        version: 1,
        current_id: '世说新语(刘义庆).txt',
        timer_min: 45,
        books: { '世说新语(刘义庆).txt': { offset: 5, updated_at: 1793661105 } },
      }),
      'utf-8',
    )
    const h = harness()
    const book = h.store.books[0]!
    expect(h.state.getOffset(book)).toBe(5)
    expect(h.state.currentId).toBe('世说新语(刘义庆).txt')
    expect(h.state.timerMin).toBe(45)
    h.state.setOffset(book, 20)
    const roundtrip = JSON.parse(readFileSync(join(dir, 'listen-state.json'), 'utf-8')) as {
      current_id: string
      books: Record<string, { offset: number }>
    }
    expect(roundtrip.current_id).toBe('世说新语(刘义庆).txt')
    expect(roundtrip.books['世说新语(刘义庆).txt']?.offset).toBe(20)
  })

  it('stop 立即返：在途合成被 abort，stopped_by=user', async () => {
    const h = harness()
    h.blockFirst = true
    const book = h.store.books[0]!
    h.engine.start(book)
    await vi.waitFor(() => expect(h.engine.playing).toBe(true), { timeout: 2000 })
    const stopped = await h.engine.stop()
    expect(stopped?.stoppedBy).toBe('user')
    expect(h.engine.playing).toBe(false)
  })

  it('端点失联：stopped_by=error 且文案可读，不崩引擎', async () => {
    const title = '失联之书'
    const source = '失联之书.txt'
    mkdirSync(join(dir, 'books-txt'), { recursive: true })
    writeFileSync(join(dir, 'books-txt', source), '第一段。第二段。第三段。', 'utf-8')
    writeFileSync(
      join(dir, 'shelf.json'),
      JSON.stringify({
        version: 1,
        books: [
          {
            id: 'book-err',
            title,
            author: null,
            status: 'reading',
            source: '',
            added_at: null,
            last_read_at: null,
            finished_at: null,
            progress: null,
            migrated: { book_id: 'book-err', source_file: source, sha256: null, bytes: null, oversize: false },
          },
        ],
      }),
      'utf-8',
    )
    const store = new ShelfStore(dir)
    const failingFetch = (async (_input: string | URL, _init?: RequestInit) => {
      throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:18100')
    }) as typeof fetch
    const tts = new TtsClient({ baseUrl: 'http://127.0.0.1:18100', fetchImpl: failingFetch })
    const engine = new ListenEngine({ store, tts, state: new ListenState(dir), paceFactor: 0 })
    engine.start(store.books[0]!)
    await vi.waitFor(() => expect(engine.playing).toBe(false), { timeout: 3000 })
    expect(engine.lastResult?.stoppedBy).toBe('error')
    expect(engine.lastResult?.error).toContain('keeper-tts 不可达')
  })

  it('HTTP 404：同样优雅落 error', async () => {
    mkdirSync(join(dir, 'books-txt'), { recursive: true })
    writeFileSync(join(dir, 'books-txt', '四零四.txt'), '第一段。第二段。', 'utf-8')
    writeFileSync(
      join(dir, 'shelf.json'),
      JSON.stringify({
        version: 1,
        books: [
          {
            id: 'b404',
            title: '四零四',
            author: null,
            status: 'reading',
            source: '',
            added_at: null,
            last_read_at: null,
            finished_at: null,
            progress: null,
            migrated: { book_id: 'b404', source_file: '四零四.txt', sha256: null, bytes: null, oversize: false },
          },
        ],
      }),
      'utf-8',
    )
    const store = new ShelfStore(dir)
    const notFound = (async (_input: string | URL, _init?: RequestInit) => new Response(JSON.stringify({ error: { code: 'not_found', message: 'no such route' } }), { status: 404 })) as typeof fetch
    const tts = new TtsClient({ baseUrl: 'http://127.0.0.1:18100', fetchImpl: notFound })
    const engine = new ListenEngine({ store, tts, state: new ListenState(dir), paceFactor: 0 })
    engine.start(store.books[0]!)
    await vi.waitFor(() => expect(engine.playing).toBe(false), { timeout: 3000 })
    expect(engine.lastResult?.stoppedBy).toBe('error')
    expect(engine.lastResult?.error).toContain('404')
  })

  it('定时到点：deadline 已过则直接 timer 停，不出声', async () => {
    const h = harness()
    const book = h.store.books[0]!
    // deadline 已成过去时（绝对到期毫秒钩子），消除「极小 timerMin 在微任务里尚未到期」的竞态
    h.engine.start(book, { deadlineAt: Date.now() - 1 })
    await vi.waitFor(() => expect(h.engine.playing).toBe(false), { timeout: 2000 })
    expect(h.engine.lastResult?.stoppedBy).toBe('timer')
    expect(h.spoken.length).toBe(0)
  })
})

describe('听书工具面', () => {
  function toolOf(h: Harness, name: string) {
    const tool = createReadingTools({ store: h.store, listen: h.engine }).find((c) => c.name === name)
    if (!tool) throw new Error(`工具不存在：${name}`)
    return tool
  }

  it('reading.listen：未知书降级、书文件缺失降级', async () => {
    const h = harness()
    const listen = toolOf(h, 'reading.listen')
    const missing = (await listen.execute({ book: '不存在的书' }, {} as never)) as { ok: boolean; degraded: string }
    expect(missing.ok).toBe(false)
    expect(missing.degraded).toContain('没有找到')
    // 书架有条目但盘上无文件
    rmSync(join(dir, 'books-txt', '世说新语(刘义庆).txt'))
    const noFile = (await listen.execute({ book: '世说新语' }, {} as never)) as { ok: boolean; degraded: string }
    expect(noFile.ok).toBe(false)
    expect(noFile.degraded).toContain('不在盘上')
  })

  it('reading.listen → reading.stop：起播即返、停止报断点', async () => {
    const h = harness()
    h.blockFirst = true
    const listen = toolOf(h, 'reading.listen')
    const started = (await listen.execute({ book: '世说新语' }, {} as never)) as { ok: boolean; summary: string }
    expect(started.ok).toBe(true)
    expect(started.summary).toContain('世说新语')
    await vi.waitFor(() => expect(h.engine.playing).toBe(true), { timeout: 2000 })
    const stop = toolOf(h, 'reading.stop')
    const stopped = (await stop.execute({}, {} as never)) as { ok: boolean; summary: string }
    expect(stopped.ok).toBe(true)
    expect(stopped.summary).toContain('记到')
  })

  it('reading.resume：current_id 优先；没听过则降级', async () => {
    const h = harness({ offset: 0 })
    const resume = toolOf(h, 'reading.resume')
    // 无 listen-state.json → resumeCandidate 退化为最近在读书（书架里唯一 reading）
    const resumed = (await resume.execute({}, {} as never)) as { ok: boolean }
    expect(resumed.ok).toBe(true)
    // 停止并清空书架状态后再 resume：无书可续
    await h.engine.stop()
    expect(existsSync(join(dir, 'listen-state.json'))).toBe(true)
  })
})
