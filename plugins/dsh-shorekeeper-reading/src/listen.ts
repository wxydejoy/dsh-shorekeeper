/** 听书引擎：切句打包（speech.ts）→ keeper-tts 服务端喇叭逐段朗读 → 每段落盘 offset（断点续读）。
 *
 * 业务规则对齐 migration/books-format.md §4 / books.py：
 * - 打断 = 再来一条指令即停（最简版，barge-in 桥 ⏸ T4）：reading_stop 调 /v1/stop + 本地循环中止。
 * - 朗读中每句落盘 offset——天然就是「断点续读」。
 * - 定时：deadline 到点停（stopped_by: "timer"）；恢复续跑不重置剩余时长。
 * - stopped_by 取值：user / timer / end / error。
 * - listen-state.json 沿用迁移 schema（migration/export_books.py 产出）：
 *   { version, current_id, timer_min, books: { [source_file]: { offset, updated_at } } }。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { estimateReadSeconds, openReadCursor, PACK_TARGET, type ReadChunk, type ReadCursor } from './speech.ts'
import { TtsClient } from './tts-client.ts'
import type { Book, ShelfStore } from './shelf.ts'

export type StoppedBy = 'user' | 'timer' | 'end' | 'error'

export interface ListenStateFile {
  version: number
  current_id: string | null
  timer_min: number
  /** 朗读音量 0-100（采样增益，不动系统音量）。缺省 100 = 不衰减。 */
  volume: number
  muted: boolean
  books: Record<string, { offset: number; updated_at: number }>
}

export interface ListenStatus {
  playing: boolean
  bookId: string
  title: string
  chunkIndex: number
  totalChunks: number
  offset: number
  /** 这一轮用的定时（分钟）。0 = 不限。和 listen-state 里持久的 timer_min 不是一回事。 */
  sessionTimerMin: number
  stoppedBy: StoppedBy | null
  error: string | null
}

const STATE_FILE = 'listen-state.json'

export class ListenState {
  private readonly path: string
  private data: ListenStateFile

  constructor(dir: string) {
    this.path = join(dir, STATE_FILE)
    this.data = this.load()
  }

  private load(): ListenStateFile {
    if (!existsSync(this.path)) {
      return { version: 1, current_id: null, timer_min: 30, volume: 100, muted: false, books: {} }
    }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as Partial<ListenStateFile>
      return {
        version: 1,
        current_id: typeof parsed.current_id === 'string' ? parsed.current_id : null,
        timer_min: typeof parsed.timer_min === 'number' ? parsed.timer_min : 30,
        volume: typeof parsed.volume === 'number' ? Math.min(100, Math.max(0, parsed.volume)) : 100,
        muted: parsed.muted === true,
        books: parsed.books && typeof parsed.books === 'object' ? parsed.books : {},
      }
    } catch {
      return { version: 1, current_id: null, timer_min: 30, volume: 100, muted: false, books: {} }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(this.data, null, 2) + '\n', 'utf-8')
  }

  /** 听书键与迁移 schema 一致：migrated.source_file（即文件名），无迁移信息的书退化为 title。 */
  static bookKey(book: Book): string {
    return book.migrated?.source_file ?? `${book.title}.txt`
  }

  getOffset(book: Book): number {
    return this.data.books[ListenState.bookKey(book)]?.offset ?? 0
  }

  setOffset(book: Book, offset: number): void {
    this.data.books[ListenState.bookKey(book)] = { offset, updated_at: Math.floor(Date.now() / 1000) }
    this.data.current_id = ListenState.bookKey(book)
    this.persist()
  }

  get currentId(): string | null {
    return this.data.current_id
  }

  get volume(): number {
    return this.data.volume
  }

  get muted(): boolean {
    return this.data.muted
  }

  setVolume(volume: number): void {
    this.data.volume = Math.min(100, Math.max(0, Math.round(volume)))
    this.persist()
  }

  setMuted(muted: boolean): void {
    this.data.muted = muted
    this.persist()
  }

  get timerMin(): number {
    return this.data.timer_min
  }

  setTimerMin(minutes: number): void {
    this.data.timer_min = minutes
    this.persist()
  }
}

export interface ListenEngineOptions {
  store: ShelfStore
  tts: TtsClient
  state: ListenState
  /** 缺省语速（Config.ttsSpeed），单次 listen 可再覆盖 */
  speedDefault?: number
  /** 朗读完一段后等待的富余（估时已含语速；speak 若早返回，靠它避免深排队）。默认 0.9 系数 */
  paceFactor?: number
}

export class ListenEngine {
  private readonly store: ShelfStore
  private readonly tts: TtsClient
  private readonly state: ListenState
  private readonly speedDefault: number
  private readonly paceFactor: number

  private current: {
    book: Book
    textLength: number
    /** 已经交出去念的段数（进度条用；全文不预切） */
    spoken: number
    startedAt: number
    deadline: number | null
    speed: number
    timerMin: number
  } | null = null
  private controller: AbortController | null = null
  private loop: Promise<void> | null = null
  private result: ListenStatus | null = null

  constructor(options: ListenEngineOptions) {
    this.store = options.store
    this.tts = options.tts
    this.state = options.state
    this.speedDefault = options.speedDefault ?? 1.0
    this.paceFactor = options.paceFactor ?? 0.9
  }

  /** 上一轮的收尾状态（stoppedBy / error），未播过为 null */
  get lastResult(): ListenStatus | null {
    return this.result
  }

  get playing(): boolean {
    return this.loop !== null
  }

  /** 当前播放快照（工具查询用） */
  get status(): ListenStatus | null {
    if (!this.current) return this.result
    const { book, textLength, spoken } = this.current
    const offset = this.state.getOffset(book)
    const totalChunks = Math.max(1, Math.ceil(textLength / PACK_TARGET))
    return {
      playing: this.loop !== null,
      bookId: book.id,
      title: book.title,
      chunkIndex: spoken,
      totalChunks,
      offset,
      sessionTimerMin: this.current.timerMin,
      stoppedBy: null,
      error: null,
    }
  }

  /** 开读（从断点或 0）。已在播放时返回 false。deadlineAt=绝对到期毫秒（测试/冻结剩余时长用）。
   *  fromOffset=显式起播坐标（章节选择用）：先落盘断点再起播，覆盖已有断点。
   *  timerMin 缺省沿用 listen-state；显式传入且 rememberTimer !== false 才写回。
   *  面板开读传 rememberTimer:false，避免把「本次定时」写进工具面共用的断点。 */
  start(
    book: Book,
    options: { timerMin?: number; speed?: number; deadlineAt?: number; fromOffset?: number; rememberTimer?: boolean } = {},
  ): boolean {
    if (this.loop) return false
    const text = this.store.readBookText(book)
    if (text === null) throw new Error(`书文件不在盘上（未迁移或被移动）：${ListenState.bookKey(book)}`)
    if (options.fromOffset !== undefined) {
      this.state.setOffset(book, Math.max(0, Math.min(text.length, Math.floor(options.fromOffset))))
    }
    const speed = clampSpeed(options.speed ?? this.speedDefault)
    const timerMin = clampTimer(options.timerMin ?? this.state.timerMin)
    if (options.timerMin !== undefined && options.rememberTimer !== false) this.state.setTimerMin(timerMin)
    const fromOffset = this.state.getOffset(book)
    this.current = {
      book,
      textLength: text.length,
      spoken: 0,
      startedAt: Date.now(),
      deadline: options.deadlineAt ?? (timerMin > 0 ? Date.now() + timerMin * 60_000 : null),
      speed,
      timerMin,
    }
    this.controller = new AbortController()
    this.result = null
    const controller = this.controller
    this.loop = this.runLoop(book, text, fromOffset, speed, timerMin, controller)
      .catch((error: unknown) => {
        this.finish({
          playing: false,
          bookId: book.id,
          title: book.title,
          chunkIndex: 0,
          totalChunks: Math.max(1, Math.ceil(text.length / PACK_TARGET)),
          offset: this.state.getOffset(book),
          sessionTimerMin: timerMin,
          stoppedBy: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        if (this.controller === controller) this.controller = null
        this.loop = null
      })
    return true
  }

  /** 打断：本地循环中止 + keeper 喇叭清队。等循环收尾（≤一次请求超时）。 */
  async stop(): Promise<ListenStatus | null> {
    this.controller?.abort()
    await this.tts.stop()
    if (this.loop) await this.loop
    return this.result
  }

  /** 续读目标：state.current_id 指向的书；没有再退化为最近 last_read_at 的在读书。 */
  resumeCandidate(): Book | null {
    const currentId = this.state.currentId
    if (currentId) {
      const hit = this.store.books.find((book) => ListenState.bookKey(book) === currentId)
      if (hit) return hit
    }
    const reading = this.store.books
      .filter((book) => book.status === 'reading')
      .sort((a, b) => (b.last_read_at ?? 0) - (a.last_read_at ?? 0))
    return reading[0] ?? null
  }

  private finish(status: ListenStatus): void {
    this.result = status
    // 播完就放开 current，之后 status 回到 lastResult（带 stoppedBy）。
    // 留着 current 的话，轮询永远看到 stoppedBy=null，面板不知道是读完、到点还是手动停。
    this.current = null
  }

  private async runLoop(
    book: Book,
    text: string,
    fromOffset: number,
    speed: number,
    timerMin: number,
    controller: AbortController,
  ): Promise<void> {
    const current = this.current
    if (!current) return
    const cursor: ReadCursor = openReadCursor(text, fromOffset)
    const totalChunks = Math.max(1, Math.ceil(text.length / PACK_TARGET))
    let index = 0
    let stoppedBy: StoppedBy = 'end'
    let errorMessage: string | null = null

    for (;;) {
      if (controller.signal.aborted) {
        stoppedBy = 'user'
        break
      }
      if (current.deadline !== null && Date.now() >= current.deadline) {
        stoppedBy = 'timer'
        break
      }
      const chunk: ReadChunk | null = cursor.next()
      if (!chunk) break
      const startedAt = Date.now()
      try {
        await this.tts.speak(chunk.text, { speed, signal: controller.signal, volume: this.state.muted ? 0 : this.state.volume })
      } catch (error) {
        if (controller.signal.aborted) {
          stoppedBy = 'user'
          break
        }
        stoppedBy = 'error'
        errorMessage = error instanceof Error ? error.message : String(error)
        break
      }
      this.state.setOffset(book, chunk.end)
      index += 1
      current.spoken = index
      // 节流：speak 若早于估时返回，等到估时比例点再取下一段（服务端喇叭串行，避免深排队）
      if (current.deadline !== null && Date.now() >= current.deadline) {
        stoppedBy = 'timer'
        break
      }
      const estimateMs = (estimateReadSeconds(chunk.text) / speed) * 1000 * this.paceFactor
      const remain = estimateMs - (Date.now() - startedAt)
      if (remain > 0) await sleep(Math.min(remain, 10_000), controller.signal)
    }

    this.finish({
      playing: false,
      bookId: book.id,
      title: book.title,
      chunkIndex: index,
      totalChunks,
      offset: this.state.getOffset(book),
      sessionTimerMin: timerMin,
      stoppedBy,
      error: errorMessage,
    })
  }
}

function clampTimer(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(120, Math.max(0, Math.floor(value)))
}

function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1.0
  return Math.min(2.0, Math.max(0.5, value))
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveSleep) => {
    const timer = setTimeout(resolveSleep, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolveSleep()
      },
      { once: true },
    )
  })
}
