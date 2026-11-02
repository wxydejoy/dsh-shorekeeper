/** 书架数据层。数据落盘位置与导出器一致：$DSH_HOME/data/reading（无 DSH_HOME → ~/.dsh/data/reading）。
 *
 * shelf.json 由 migration/export_books.py 产出（一次性迁移），之后由本插件接管读写；
 * notes.json 同源（岸亭无摘抄数据，导出为空骨架）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface BookChapters {
  index: number
  title: string
  start: number
  end: number
}

export interface Book {
  id: string
  title: string
  author: string | null
  source_file: string
  bytes: number | null
  sha256: string | null
  status: 'wishlist' | 'reading' | 'finished'
  chars: number | null
  chapters: BookChapters[]
  fidelity: 'exact' | 'approx' | null
  percent: number | null
  current_chapter: { index: number; title: string } | null
  encoding: string | null
  /** 岸亭迁移的原始书签（保留审计；插件自己的进度写在 progress） */
  migrated?: { book_id: string; offset: number | null; updated_at: number | null }
}

export interface BookProgress {
  page?: number
  percent?: number
  chapter_title?: string
  note?: string
  updated_at: string
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
  schema_version: number
  books: Book[]
}

export interface NotesData {
  schema_version: number
  notes: BookNote[]
}

export interface ReadingData {
  shelf: ShelfData
  notes: NotesData
  /** 插件侧进度（按书 id）：page/percent/chapter 的活数据 */
  progress: Record<string, BookProgress>
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
  private data: ReadingData

  constructor(dir = defaultDataDir()) {
    this.dir = dir
    this.data = {
      shelf: readJson<ShelfData>(join(dir, 'shelf.json'), { schema_version: 1, books: [] }),
      notes: readJson<NotesData>(join(dir, 'notes.json'), { schema_version: 1, notes: [] }),
      progress: readJson<Record<string, BookProgress>>(join(dir, 'progress.json'), {}),
    }
  }

  get books(): Book[] {
    return this.data.shelf.books
  }

  get notes(): BookNote[] {
    return this.data.notes.notes
  }

  get dataDir(): string {
    return this.dir
  }

  getProgress(bookId: string): BookProgress | undefined {
    return this.data.progress[bookId]
  }

  /** 按 id 或书名模糊匹配（不区分大小写，子串命中；唯一命中才返回） */
  findBook(query: string): Book | null {
    const q = query.trim().toLowerCase()
    if (!q) return null
    const hits = this.books.filter(
      (book) => book.id.toLowerCase().includes(q) || book.title.toLowerCase().includes(q),
    )
    return hits.length === 1 ? (hits[0] ?? null) : null
  }

  /** 进度更新（口语化解析在模型侧完成，这里收结构化结果） */
  updateProgress(bookId: string, patch: Omit<BookProgress, 'updated_at'>): BookProgress {
    const previous = this.data.progress[bookId]
    const next: BookProgress = { ...previous, ...patch, updated_at: new Date().toISOString() }
    this.data.progress[bookId] = next
    // 书架状态联动：记了进度就是 reading；percent 到 100 则 finished
    const book = this.books.find((candidate) => candidate.id === bookId)
    if (book) {
      if (next.percent !== undefined && next.percent >= 100) book.status = 'finished'
      else if (book.status === 'wishlist') book.status = 'reading'
      if (next.percent !== undefined) book.percent = next.percent
    }
    this.persist()
    return next
  }

  addNote(note: Omit<BookNote, 'id' | 'at'>): BookNote {
    const entry: BookNote = {
      ...note,
      id: `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
    }
    this.data.notes.notes.push(entry)
    this.persist()
    return entry
  }

  /** reading.ask 的本地检索：摘抄/随想 + 书名/进度信息。记忆插件检索 ⏸ T3 选型后挂接。 */
  ask(question: string): { notes: BookNote[]; books: Book[] } {
    const keywords = question
      .toLowerCase()
      .split(/[\s，。？、！,?.!]+/)
      .filter((word) => word.length >= 2)
    const hit = (text: string) => keywords.some((word) => text.toLowerCase().includes(word))
    const notes = this.notes.filter(
      (note) => hit(note.text) || hit(note.thought ?? '') || hit(note.bookTitle),
    )
    const books = this.books.filter((book) => hit(book.title) || hit(book.author ?? ''))
    return { notes, books }
  }

  private persist(): void {
    writeJson(join(this.dir, 'shelf.json'), this.data.shelf)
    writeJson(join(this.dir, 'notes.json'), this.data.notes)
    writeJson(join(this.dir, 'progress.json'), this.data.progress)
  }
}
