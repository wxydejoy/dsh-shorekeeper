/** reading 工具面：shelf / progress / note / ask。全部 read-only 数据修改经守岸人对话完成（任务书权限口径）。
 * 听书模式（调 keeper-voice 流式朗读）⏸ 联调依赖 T4；记忆插件联动 ⏸ T3 选型。
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { ShelfStore, type Book } from './shelf.ts'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export interface ReadingToolDeps {
  store: ShelfStore
}

function describeBook(book: Book): string {
  const bits = [book.title]
  if (book.author) bits.push(book.author)
  if (book.status === 'finished') bits.push('已读完')
  else if (book.status === 'wishlist') bits.push('想读')
  else if (book.progress?.percent !== undefined && book.progress.percent !== null) bits.push(`读到 ${book.progress.percent}%`)
  else if (book.status === 'reading') bits.push('在读')
  if (book.progress?.page !== undefined) bits.push(`第 ${book.progress.page} 页`)
  if (book.progress?.chapter_title) bits.push(book.progress.chapter_title)
  return bits.join(' · ')
}

export function createReadingTools(deps: ReadingToolDeps): ToolDefinition[] {
  const { store } = deps

  const shelf = defineTool({
    name: 'reading.shelf',
    description:
      '查看书架：在读/读完/想读 + 进度，按最近阅读排序。守岸人聊「最近在读什么」「上次读到哪」从这里拿事实。',
    parameters: {
      status: { type: 'string', enum: ['reading', 'finished', 'wishlist'], description: '按状态过滤；缺省全部' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute(args) {
      const status = typeof args.status === 'string' ? args.status : undefined
      const books = status ? store.books.filter((book) => book.status === status) : store.books
      const lines = books.map((book) => describeBook(book))
      return {
        ok: true,
        total: books.length,
        books: books.map((book) => ({
          id: book.id,
          title: book.title,
          author: book.author,
          status: book.status,
          percent: book.progress?.percent ?? null,
        })) satisfies Json,
        summary: lines.length > 0 ? `书架 ${books.length} 本：${lines.join('；')}` : '书架还是空的。',
      } satisfies Json
    },
  })

  const progress = defineTool({
    name: 'reading.progress',
    description:
      '记录阅读进度（页码/百分比/章节，至少给一个）。守岸人代记「看到 217 页了」就调这里；记完书架状态自动联动（想读→在读，100%→读完）。',
    parameters: {
      book: { type: 'string', description: '书名或书 id（唯一命中即可）', required: true },
      page: { type: 'number', description: '页码' },
      percent: { type: 'number', description: '百分比 0–100' },
      chapterTitle: { type: 'string', description: '章节名' },
      note: { type: 'string', description: '一句话状态备注（可选）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute(args) {
      const query = typeof args.book === 'string' ? args.book : ''
      const book = store.findBook(query)
      if (!book) {
        const ambiguous = store.books.filter((candidate) => candidate.title.toLowerCase().includes(query.toLowerCase()))
        return {
          ok: false,
          degraded:
            query.trim() === ''
              ? 'book 必填'
              : ambiguous.length > 1
                ? `书名命中 ${ambiguous.length} 本（${ambiguous.map((b) => b.title).join('、')}），请说得更具体些`
                : `书架上没有找到「${query}」`,
        } satisfies Json
      }
      const patch: { page?: number; percent?: number; chapter_title?: string; note?: string } = {}
      if (typeof args.page === 'number') patch.page = args.page
      if (typeof args.percent === 'number') patch.percent = Math.min(100, Math.max(0, args.percent))
      if (typeof args.chapterTitle === 'string' && args.chapterTitle.trim()) patch.chapter_title = args.chapterTitle.trim()
      if (typeof args.note === 'string' && args.note.trim()) patch.note = args.note.trim()
      if (Object.keys(patch).length === 0) return { ok: false, degraded: 'page/percent/chapterTitle/note 至少给一个' } satisfies Json
      const saved = store.updateProgress(book.id, patch)
      return {
        ok: true,
        book: book.id,
        progress: JSON.parse(JSON.stringify(saved)) as Json,
        summary: `记下了：《${book.title}》${saved.page !== undefined ? `第 ${saved.page} 页` : ''}${
          saved.percent !== undefined && saved.percent !== null ? `（${saved.percent}%）` : ''
        }${saved.chapter_title ? `，${saved.chapter_title}` : ''}`,
      } satisfies Json
    },
  })

  const note = defineTool({
    name: 'reading.note',
    description: '把摘抄或随想落库，可关联书与章节。守岸人「把这句记下来」就调这里。',
    parameters: {
      book: { type: 'string', description: '关联的书（可空：不关联的随想）' },
      text: { type: 'string', description: '摘抄原文或随想内容', required: true },
      thought: { type: 'string', description: '你的随想/批注（与 text 分开存）' },
      chapterTitle: { type: 'string', description: '章节名' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute(args) {
      const text = typeof args.text === 'string' ? args.text.trim() : ''
      if (!text) return { ok: false, degraded: 'text 必填' } satisfies Json
      const query = typeof args.book === 'string' ? args.book : ''
      const book = query ? store.findBook(query) : null
      if (query && !book) return { ok: false, degraded: `书架上没有找到「${query}」，可去掉 book 存为自由随想` } satisfies Json
      const chapterTitle =
        typeof args.chapterTitle === 'string' && args.chapterTitle.trim() ? args.chapterTitle.trim() : undefined
      const thought = typeof args.thought === 'string' && args.thought.trim() ? args.thought.trim() : undefined
      const saved = store.addNote({
        bookId: book?.id ?? '',
        bookTitle: book?.title ?? '',
        ...(chapterTitle !== undefined ? { chapterTitle } : {}),
        text,
        ...(thought !== undefined ? { thought } : {}),
      })
      return {
        ok: true,
        noteId: saved.id,
        summary: `摘抄已记下${book ? `（《${book.title}》${saved.chapterTitle ?? ''}）` : '（自由随想）'}`,
      } satisfies Json
    },
  })

  const ask = defineTool({
    name: 'reading.ask',
    description:
      '对读过的内容提问：在摘抄/随想与书架信息里检索。守岸人「上次读到那章了」「你摘过哪句」走这里。（长期记忆检索 ⏸ T3 选型后挂接）',
    parameters: {
      question: { type: 'string', description: '问题或关键词', required: true },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute(args) {
      const question = typeof args.question === 'string' ? args.question.trim() : ''
      if (!question) return { ok: false, degraded: 'question 必填' } satisfies Json
      const { notes, books } = store.ask(question)
      const lines = [
        ...notes.slice(0, 5).map((note) => `摘抄（《${note.bookTitle || '自由随想'}》${note.chapterTitle ?? ''}）：${note.text}`),
        ...books.slice(0, 5).map((book) => `书目：${describeBook(book)}`),
      ]
      return {
        ok: true,
        notes: JSON.parse(JSON.stringify(notes.slice(0, 5))) as Json,
        books: books.slice(0, 5).map((book) => ({ id: book.id, title: book.title, status: book.status })) satisfies Json,
        summary: lines.length > 0 ? lines.join('；') : `书架与摘抄里没有命中的内容（「${question}」）`,
      } satisfies Json
    },
  })

  return [shelf, progress, note, ask]
}

function summaryOf(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'summary' in value) {
    const summary = (value as { summary?: unknown }).summary
    if (typeof summary === 'string') return summary
  }
  return 'reading 完成'
}
