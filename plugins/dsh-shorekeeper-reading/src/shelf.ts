/** 书架数据层。数据落盘位置与导出器一致：$DSH_HOME/data/reading（无 DSH_HOME → ~/.dsh/data/reading）。
 *
 * shelf.json / notes.json 由 migration/export_books.py 产出（真实 schema 以其 render_shelf 为准：
 * progress 是书对象里的嵌套结构，不是旁路文件），之后由本插件接管读写。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface BookProgress {
  kind: 'char' | 'page'
  char_offset?: number
  page?: number
  percent?: number | null
  chapter_index?: number | null
  chapter_title?: string | null
  fidelity?: 'exact' | 'approx' | null
}

export interface Book {
  id: string
  title: string
  author: string | null
  status: 'wishlist' | 'reading' | 'finished'
  source: string
  added_at: number | null
  last_read_at: number | null
  finished_at: number | null
  progress: BookProgress | null
  migrated?: {
    book_id: string
    source_file: string
    sha256: string | null
    bytes: number | null
    oversize: boolean
  }
}

export interface BookNote {
  id: string
  bookId: string
  bookTitle: string
  chapterTitle?: string
  text: string
  thought?: string
  at: string
}

export interface ShelfData {
  version: number
  imported_from?: string
  books: Book[]
}

export interface NotesData {
  schema_version: number
  notes: BookNote[]
}

export function defaultDataDir(): string {
  const home = process.env.DSH_HOME
  return home ? join(home, 'data', 'reading') : join(process.env.HOME ?? '.', '.dsh', 'data', 'reading')
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

export class ShelfStore {
  private readonly dir: string
  private shelf: ShelfData
  private notesData: NotesData

  constructor(dir = defaultDataDir()) {
    this.dir = dir
    this.shelf = readJson<ShelfData>(join(dir, 'shelf.json'), { version: 1, books: [] })
    this.notesData = readJson<NotesData>(join(dir, 'notes.json'), { schema_version: 1, notes: [] })
  }

  get books(): Book[] {
    return this.shelf.books
  }

  get notes(): BookNote[] {
    return this.notesData.notes
  }

  get dataDir(): string {
    return this.dir
  }

  /** 按 id 或书名模糊匹配（不区分大小写，子串命中；唯一命中才返回） */
  findBook(query: string): Book | null {
    const q = query.trim().toLowerCase()
    if (!q) return null
    const hits = this.shelf.books.filter(
      (book) => book.id.toLowerCase().includes(q) || book.title.toLowerCase().includes(q),
    )
    return hits.length === 1 ? (hits[0] ?? null) : null
  }

  getProgress(bookId: string): BookProgress | undefined {
    return this.shelf.books.find((book) => book.id === bookId)?.progress ?? undefined
  }

  /** 进度更新（口语化解析在模型侧完成，这里收结构化结果）。写进书对象的 progress（与导出器同构） */
  updateProgress(bookId: string, patch: { page?: number; percent?: number; chapter_title?: string; note?: string }): BookProgress {
    const book = this.shelf.books.find((candidate) => candidate.id === bookId)
    if (!book) throw new Error(`书架里没有这本书：${bookId}`)
    const progress: BookProgress = { kind: 'char', ...(book.progress ?? {}) }
    if (patch.page !== undefined) progress.page = patch.page
    if (patch.percent !== undefined) progress.percent = patch.percent
    if (patch.chapter_title !== undefined) progress.chapter_title = patch.chapter_title
    book.progress = progress
    // 书架状态联动：记了进度就是 reading；percent 到 100 则 finished
    if (progress.percent !== undefined && progress.percent !== null && progress.percent >= 100) {
      book.status = 'finished'
      book.finished_at = Math.floor(Date.now() / 1000)
    } else if (book.status === 'wishlist') {
      book.status = 'reading'
    }
    book.last_read_at = Math.floor(Date.now() / 1000)
    this.persist()
    return progress
  }

  addNote(note: Omit<BookNote, 'id' | 'at'>): BookNote {
    const entry: BookNote = {
      ...note,
      id: `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
    }
    this.notesData.notes.push(entry)
    this.persist()
    return entry
  }

  /** reading.ask 的本地检索：摘抄/随想 + 书名/进度信息。记忆插件检索 ⏸ T3 选型后挂接（T1 已选 feiyu-memory）。 */
  ask(question: string): { notes: BookNote[]; books: Book[] } {
    const keywords = question
      .toLowerCase()
      .split(/[\s，。？、！,?.!]+/)
      .filter((word) => word.length >= 2)
    const hit = (text: string) => keywords.some((word) => text.toLowerCase().includes(word))
    const notes = this.notesData.notes.filter(
      (note) => hit(note.text) || hit(note.thought ?? '') || hit(note.bookTitle),
    )
    const books = this.shelf.books.filter((book) => hit(book.title) || hit(book.author ?? ''))
    return { notes, books }
  }

  private persist(): void {
    writeJson(join(this.dir, 'shelf.json'), this.shelf)
    writeJson(join(this.dir, 'notes.json'), this.notesData)
  }
}
