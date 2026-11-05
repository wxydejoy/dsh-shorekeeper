/** dsh-shorekeeper-reading —— 守岸人的阅读。
 *
 * 插件族规范（仓库根 README.md）：TS 模块、入口 apply(ctx)、注册工具前 inject ['tools']。
 * 数据与 migration/export_books.py 落点一致；听书三件（Z8）直连 keeper-tts 服务端喇叭，
 * 打断=再来一条指令即停（barge-in 桥 ⏸ T4）；记忆联动 ⏸ T3 选型。
 */

import type { Context } from '@deepseek-ai/cordis'
// 引入 connection 服务的类型增强（ctx.connection），仅类型副作用
import type {} from '@deepseek-ai/dsh-client-connection'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ShelfStore, type Book } from './shelf.ts'
import { createReadingTools } from './tools.ts'
import { Config, resolveDataDir, type ReadingConfig } from './config.ts'
import { TtsClient } from './tts-client.ts'
import { ListenEngine, ListenState } from './listen.ts'
import { findChapters, type ChapterMark } from './speech.ts'
import { getVolume, setVolume, setMuted } from './volume.ts'

export const inject = ['tools', 'connection']

export { Config }

/** 导入上限（解码后字节数）：网文 txt 一般 <10MB，留足余量。 */
const IMPORT_MAX_BYTES = 15 * 1024 * 1024

export function apply(ctx: Context, config: ReadingConfig): void {
  const dataDir = resolveDataDir(config)
  const store = new ShelfStore(dataDir)
  const tts = new TtsClient({ baseUrl: config.ttsBaseUrl })
  const state = new ListenState(store.dataDir)
  const engine = new ListenEngine({ store, tts, state, speedDefault: config.ttsSpeed })
  for (const tool of createReadingTools({ store, listen: engine })) {
    ctx.tools.register(tool)
  }
  registerPanelRpc(ctx, { store, state, engine, ttsBaseUrl: config.ttsBaseUrl })
}

/** 页面半区：/reading-panel RPC，给「小说朗读」侧栏面板用。
 *
 * 与工具面共用同一 ListenEngine / ShelfStore 实例——页面开的朗读和守岸人
 * 「读会儿书」是同一条线程，断点（listen-state.json）天然互通。
 * 信封契约对齐 dsh-keeper-console：error.code/message 字符串 + details 对象。
 *
 * 动作：books / status / play / stop / chapters / import / volume / setVolume / setMuted。
 */
function registerPanelRpc(
  ctx: Context,
  deps: { store: ShelfStore; state: ListenState; engine: ListenEngine; ttsBaseUrl: string },
): void {
  const { store, state, engine, ttsBaseUrl } = deps

  /** 章节缓存：bookId → { mtime, chapters }。书文件没变就不再重扫几 MB 全文。 */
  const chapterCache = new Map<string, { mtime: number; chapters: ChapterMark[] }>()

  function bookEntry(book: Book) {
    const offset = state.getOffset(book)
    return {
      id: book.id,
      title: book.title,
      author: book.author,
      status: book.status,
      percent: book.progress?.percent ?? null,
      page: book.progress?.page ?? null,
      chapterTitle: book.progress?.chapter_title ?? null,
      offset,
      lastReadAt: book.last_read_at,
      readable: store.hasBookText(book),
    }
  }

  function statusSnapshot() {
    const resume = engine.resumeCandidate()
    return {
      playing: engine.playing,
      status: engine.status,
      resume: resume ? { id: resume.id, title: resume.title, offset: state.getOffset(resume) } : null,
      timerMin: state.timerMin,
    }
  }

  async function keeperTtsAlive(): Promise<boolean> {
    try {
      // keeper-tts 无 /v1/models 路由（404 也算活）——HTTP 有响应即在线
      await fetch(ttsBaseUrl.replace(/\/+$/, '') + '/v1/models', { signal: AbortSignal.timeout(1_500) })
      return true
    } catch {
      return false
    }
  }

  function chaptersOf(book: Book): ChapterMark[] {
    const mtime = store.bookTextMtime(book)
    const cached = chapterCache.get(book.id)
    if (cached && cached.mtime === mtime) return cached.chapters
    const text = store.readBookText(book)
    const chapters = text === null ? [] : findChapters(text)
    chapterCache.set(book.id, { mtime, chapters })
    return chapters
  }

  type PanelPayload = {
    bookId?: string
    timerMin?: number
    speed?: number
    fromOffset?: number
    name?: string
    dataBase64?: string
    volume?: number
    muted?: boolean
  }

  ctx.connection.rpc.handle('/reading-panel', async (action, rawPayload) => {
    const payload: PanelPayload =
      rawPayload && typeof rawPayload === 'object' ? (rawPayload as PanelPayload) : {}
    try {
      switch (action) {
        case 'books': {
          const books = store.books.map(bookEntry)
          const alive = await keeperTtsAlive()
          return { ok: true, value: { books, currentId: state.currentId, timerMin: state.timerMin, ttsAlive: alive } }
        }

        case 'status':
          return { ok: true, value: { ...statusSnapshot(), ttsAlive: await keeperTtsAlive() } }

        case 'chapters': {
          const bookId = typeof payload.bookId === 'string' ? payload.bookId : ''
          const book = store.books.find((candidate) => candidate.id === bookId)
          if (!book) throw new Error('书架上没有这本书')
          const chapters = chaptersOf(book)
          return { ok: true, value: { bookId: book.id, total: chapters.length, chapters } }
        }

        case 'play': {
          const bookId = typeof payload.bookId === 'string' ? payload.bookId : ''
          let book = bookId ? (store.books.find((candidate) => candidate.id === bookId) ?? null) : null
          if (!book && !bookId) book = engine.resumeCandidate()
          if (!book) throw new Error(bookId ? '书架上没有这本书' : '还没有可续读的书：先从书架挑一本')
          if (engine.playing) throw new Error(`正在读《${engine.status?.title ?? ''}》，先停止再换`)
          if (store.readBookText(book) === null) {
            throw new Error(`《${book.title}》的书文件不在盘上（未迁移），读不了`)
          }
          if (book.status === 'wishlist') store.updateProgress(book.id, {})
          const options: { timerMin?: number; speed?: number; fromOffset?: number } = {}
          // 定时语义（2026-11-05 修正）：只在显式传入时生效——面板不再静默沿用上次的
          // 定时（曾把 E2E 的 timerMin:2 持久化，之后每次开读 2 分钟就自己停）。
          // 0 = 不限；工具面（reading.listen）行为不变。
          if (typeof payload.timerMin === 'number' && Number.isFinite(payload.timerMin)) {
            options.timerMin = Math.min(120, Math.max(0, Math.floor(payload.timerMin)))
          }
          if (typeof payload.speed === 'number' && Number.isFinite(payload.speed)) {
            options.speed = Math.min(2.0, Math.max(0.5, payload.speed))
          }
          if (typeof payload.fromOffset === 'number' && Number.isFinite(payload.fromOffset) && payload.fromOffset >= 0) {
            options.fromOffset = Math.floor(payload.fromOffset)
          }
          if (!engine.start(book, options)) throw new Error('开读失败（引擎已在朗读）')
          return { ok: true, value: statusSnapshot() }
        }

        case 'stop': {
          const result = await engine.stop()
          return { ok: true, value: { ...statusSnapshot(), status: result } }
        }

        case 'import': {
          const name = typeof payload.name === 'string' ? payload.name.trim() : ''
          const dataBase64 = typeof payload.dataBase64 === 'string' ? payload.dataBase64 : ''
          if (!name || !dataBase64) throw new Error('name 和 dataBase64 必填')
          const raw = Buffer.from(dataBase64, 'base64')
          if (raw.length === 0) throw new Error('文件是空的')
          if (raw.length > IMPORT_MAX_BYTES) {
            throw new Error(`文件太大（${Math.round(raw.length / 1024 / 1024)}MB），上限 15MB`)
          }
          // 编码探测：先严格 UTF-8，失败退 GB18030（网文 txt 的常见编码）
          let text: string
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(raw)
          } catch {
            text = new TextDecoder('gb18030').decode(raw)
          }
          const baseName = name.replace(/\.(txt|text)$/i, '').trim() || '未命名'
          if (/[\\/\u0000]/.test(baseName)) throw new Error('文件名含非法字符')
          const sourceFile = `${baseName}.txt`
          const book: Book = {
            id: baseName,
            title: baseName,
            author: null,
            status: 'wishlist',
            source: 'import',
            added_at: Math.floor(Date.now() / 1000),
            last_read_at: null,
            finished_at: null,
            progress: null,
            migrated: { book_id: baseName, source_file: sourceFile, sha256: null, bytes: raw.length, oversize: false },
          }
          const dir = join(store.dataDir, 'books-txt')
          mkdirSync(dir, { recursive: true })
          writeFileSync(join(dir, sourceFile), text, 'utf-8')
          store.addBook(book)
          chapterCache.delete(book.id)
          return { ok: true, value: { book: bookEntry(book) } }
        }

        case 'volume':
          return { ok: true, value: await getVolume() }

        case 'setVolume': {
          if (typeof payload.volume !== 'number' || !Number.isFinite(payload.volume)) {
            throw new Error('volume 必须是数字（0–100）')
          }
          const applied = await setVolume(payload.volume)
          return { ok: true, value: { volume: applied } }
        }

        case 'setMuted': {
          if (typeof payload.muted !== 'boolean') throw new Error('muted 必须是布尔')
          const applied = await setMuted(payload.muted)
          return { ok: true, value: { muted: applied } }
        }

        default:
          throw Object.assign(new Error(`unknown action: ${action}`), { code: 'bad_action' })
      }
    } catch (rawError) {
      const error = rawError as { code?: unknown; message?: unknown; details?: unknown }
      return {
        ok: false,
        error: {
          code: String(error.code || 'reading-panel/error'),
          message: String(error.message || rawError),
          details: (error.details && typeof error.details === 'object' ? error.details : {}) as object,
        },
      }
    }
  })

  ctx.logger('shorekeeper-reading').info('reading-panel 就绪：小说朗读通道 /reading-panel 已挂（章节/导入/音量）')
}
