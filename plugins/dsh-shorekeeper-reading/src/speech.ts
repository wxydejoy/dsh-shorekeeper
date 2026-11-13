/** 听书切句与打包（migration/books-format.md §4，对齐 hub speech.py 克隆音色经验值）。
 *
 * 规则出处（books-format.md §4，实现不自创）：
 * - cut_sentences：在 。！？ 与换行处断句；chunk_read_text(limit=120) 长句再硬切。
 * - pack_read_chunks(target=36, limit=52)：按逗号（，、；：）拆短句再拼回参考长度，
 *   过短碎片合并，>52 硬切——保证语速稳定（参考块 37 字 / 9.5 秒）。
 * - estimate_read_seconds = 口播字数 / 4.0（界面估时用，非 TTS 真实语速）。
 */

/** 参考打包长度（字） */
export const PACK_TARGET = 36
/** 单块硬上限（字），超过必须切 */
export const PACK_LIMIT = 52
/** 长句硬切长度（字） */
export const SENTENCE_LIMIT = 120
/** 估时速率（字/秒，books.py 同款） */
export const READ_CHARS_PER_SECOND = 4.0

/** 纯标点/空白块：不进朗读队列 */
const PUNCT_ONLY = /^[\s，。！？、；：「」『』""''…—·\p{P}\p{S}]*$/u

/** 断句：在 。！？ 与换行处切开，标点留在块尾。 */
export function cutSentences(text: string): string[] {
  const pieces: string[] = []
  let current = ''
  for (const ch of text) {
    current += ch
    if (ch === '。' || ch === '！' || ch === '？' || ch === '\n') {
      pieces.push(current)
      current = ''
    }
  }
  if (current !== '') pieces.push(current)
  return pieces.map((p) => p.trim()).filter((p) => p !== '' && !PUNCT_ONLY.test(p))
}

/** 长句硬切：超过 limit 的块按等长窗口切开（books.py chunk_read_text 同参 limit=120）。 */
export function chunkReadText(text: string, limit = SENTENCE_LIMIT): string[] {
  const out: string[] = []
  for (const piece of cutSentences(text)) {
    if (piece.length <= limit) {
      out.push(piece)
      continue
    }
    for (let i = 0; i < piece.length; i += limit) out.push(piece.slice(i, i + limit))
  }
  return out
}

/** 打包：短句按 ，、；： 拆回再拼到参考长度 36；过短尾块并入前一块（≤limit 即合法）；单句 >52 硬切。 */
export function packReadChunks(text: string, target = PACK_TARGET, limit = PACK_LIMIT): string[] {
  const clauses: string[] = []
  for (const sentence of chunkReadText(text)) {
    // 逗号族拆短句（标点保留在块尾，与 cut_sentences 同风格）
    let current = ''
    for (const ch of sentence) {
      current += ch
      if (ch === '，' || ch === '、' || ch === '；' || ch === '：') {
        clauses.push(current)
        current = ''
      }
    }
    if (current !== '') clauses.push(current)
  }

  const packed: string[] = []
  let buffer = ''
  for (const clause of clauses) {
    // 单短句超硬限：先冲刷手头缓冲，再把超长短句等长硬切
    if (clause.length > limit) {
      if (buffer !== '') {
        packed.push(buffer)
        buffer = ''
      }
      for (let i = 0; i < clause.length; i += limit) packed.push(clause.slice(i, i + limit))
      continue
    }
    if (buffer !== '' && buffer.length + clause.length > target) {
      packed.push(buffer)
      buffer = clause
      continue
    }
    buffer += clause
  }
  if (buffer !== '') {
    // 过短碎片合并：尾块 ≤target/2 且与前一块可并（合并后 ≤limit）时并入，保证语速稳定
    const last = packed[packed.length - 1]
    if (packed.length > 0 && buffer.length <= Math.ceil(target / 2) && (last?.length ?? 0) + buffer.length <= limit) {
      packed[packed.length - 1] = last + buffer
    } else {
      packed.push(buffer)
    }
  }
  return packed.filter((p) => p !== '' && !PUNCT_ONLY.test(p))
}

/** 界面估时（books.py estimate_read_seconds 同款）：口播字数 / 4.0。 */
export function estimateReadSeconds(text: string): number {
  const spoken = text.replace(/\s/g, '')
  return spoken.length / READ_CHARS_PER_SECOND
}

/** 带 char offset 的朗读块：offset 是原文坐标（clean 后），与书签 char_offset 同基准。 */
export interface ReadChunk {
  start: number
  end: number
  text: string
}

/** 切块并记录原文区间：pack 会重排，这里按字符消费进度回推 offset。 */
export function buildReadChunks(text: string, target = PACK_TARGET, limit = PACK_LIMIT): ReadChunk[] {
  const chunks = packReadChunks(text, target, limit)
  const result: ReadChunk[] = []
  let cursor = 0
  for (const chunk of chunks) {
    const idx = text.indexOf(chunk, cursor)
    // pack 重排后 chunk 一定还是原文子串（拼接不改字），idx 必命中；防御性兜底：找不到就按顺序推进
    const start = idx >= 0 ? idx : cursor
    result.push({ start, end: start + chunk.length, text: chunk })
    cursor = start + chunk.length
  }
  return result
}

export interface ReadCursor {
  /** 下一段要念的。读完返回 null。 */
  next(): ReadChunk | null
}

/**
 * 从 offset 起按需切下一段，不先把整本书打成块。
 *
 * 全书先 buildReadChunks 再开口：300 万字要扫十多秒，请求还没发出声音就空等。
 * 这里和 packReadChunks 同一套 36/52 规则，但只往前消化到「当前这段已经稳定」
 * （后一段也已成形，或已经到文末并做完过短尾块合并）。offset 落在某段中间时，
 * 返回的仍是那一整段（和 findIndex(end > offset) 一样，不从半段开口）。
 */
export function openReadCursor(text: string, offset = 0, target = PACK_TARGET, limit = PACK_LIMIT): ReadCursor {
  const n = text.length
  const tailMax = Math.ceil(target / 2)
  let scan = 0
  let buffer = ''
  let bufferStart = 0
  let bufferEnd = 0
  let held: ReadChunk | null = null
  let eof = false
  const ready: ReadChunk[] = []

  function pushReady(chunk: ReadChunk): void {
    if (!chunk.text || PUNCT_ONLY.test(chunk.text)) return
    ready.push(chunk)
  }

  function hold(chunk: ReadChunk): void {
    if (!chunk.text || PUNCT_ONLY.test(chunk.text)) return
    if (held) pushReady(held)
    held = chunk
  }

  function flushBuffer(): void {
    if (!buffer) return
    hold({ text: buffer, start: bufferStart, end: bufferEnd })
    buffer = ''
  }

  function addClause(clause: string, start: number, end: number): void {
    if (!clause) return
    if (clause.length > limit) {
      flushBuffer()
      for (let k = 0; k < clause.length; k += limit) {
        const part = clause.slice(k, k + limit)
        hold({ text: part, start: start + k, end: start + k + part.length })
      }
      return
    }
    if (buffer !== '' && buffer.length + clause.length > target) {
      flushBuffer()
      buffer = clause
      bufferStart = start
      bufferEnd = end
      return
    }
    if (buffer === '') {
      buffer = clause
      bufferStart = start
      bufferEnd = end
    } else {
      buffer += clause
      bufferEnd = end
    }
  }

  function consumeRaw(rawStart: number, rawEnd: number): void {
    const raw = text.slice(rawStart, rawEnd)
    const sentence = raw.trim()
    if (!sentence || PUNCT_ONLY.test(sentence)) return
    const lead = raw.indexOf(sentence)
    const origin = rawStart + (lead >= 0 ? lead : 0)
    const pieces: Array<{ text: string; start: number }> = []
    if (sentence.length <= SENTENCE_LIMIT) pieces.push({ text: sentence, start: origin })
    else {
      for (let k = 0; k < sentence.length; k += SENTENCE_LIMIT) {
        pieces.push({ text: sentence.slice(k, k + SENTENCE_LIMIT), start: origin + k })
      }
    }
    for (const piece of pieces) {
      let clauseAt = 0
      for (let k = 0; k < piece.text.length; k++) {
        const ch = piece.text[k]
        if (ch === '，' || ch === '、' || ch === '；' || ch === '：') {
          addClause(piece.text.slice(clauseAt, k + 1), piece.start + clauseAt, piece.start + k + 1)
          clauseAt = k + 1
        }
      }
      if (clauseAt < piece.text.length) {
        addClause(piece.text.slice(clauseAt), piece.start + clauseAt, piece.start + piece.text.length)
      }
    }
  }

  function finish(): void {
    if (buffer) {
      if (held && buffer.length <= tailMax && held.text.length + buffer.length <= limit) {
        held = { text: held.text + buffer, start: held.start, end: bufferEnd }
      } else {
        hold({ text: buffer, start: bufferStart, end: bufferEnd })
      }
      buffer = ''
    }
    if (held) {
      pushReady(held)
      held = null
    }
  }

  function pump(): void {
    if (eof) return
    if (scan >= n) {
      eof = true
      finish()
      return
    }
    let j = scan
    while (j < n) {
      const ch = text[j]
      if (ch === '。' || ch === '！' || ch === '？' || ch === '\n') break
      j++
    }
    const rawEnd = j < n ? j + 1 : n
    consumeRaw(scan, rawEnd)
    scan = rawEnd
  }

  let primed = false
  function prime(): void {
    if (primed) return
    primed = true
    if (offset <= 0) return
    for (;;) {
      while (ready.length === 0 && !eof) pump()
      if (ready.length === 0) return
      if ((ready[0]?.end ?? 0) > offset) return
      ready.shift()
    }
  }

  return {
    next(): ReadChunk | null {
      prime()
      while (ready.length === 0 && !eof) pump()
      return ready.shift() ?? null
    },
  }
}

// ------------------------------------------------------------------ 章节 --

/** 章节标题行：第 X 章/节/卷/回/部/集，或常见特殊章名（序章/楔子/终章等）。 */
const CHAPTER_LINE =
  /^[ \t　]*((?:第[0-9０-９零一二三四五六七八九十百千万两]+[章节卷回部集]|Chapter\s+\d+|序章|楔子|引子|前言|后记|尾声|终章|番外)[^\n]{0,60})[ \t　]*$/gim

/** 章节标记：start/end 是原文 char offset（与 ReadChunk 同基准），可直达 buildReadChunks 坐标。 */
export interface ChapterMark {
  index: number
  title: string
  start: number
  end: number
}

/** 章节扫描：按行首标题行切分。命中 <2 视为无章节结构（返回 []）。 */
export function findChapters(text: string): ChapterMark[] {
  const hits: Array<{ title: string; start: number }> = []
  CHAPTER_LINE.lastIndex = 0
  for (let m = CHAPTER_LINE.exec(text); m !== null; m = CHAPTER_LINE.exec(text)) {
    hits.push({ title: (m[1] ?? '').trim().slice(0, 60), start: m.index })
    // 防御零宽匹配死循环（正则可匹配空串时）
    if (m[0] === '') CHAPTER_LINE.lastIndex++
  }
  if (hits.length < 2) return []
  return hits.map((hit, i) => ({
    index: i,
    title: hit.title,
    start: hit.start,
    end: i + 1 < hits.length ? (hits[i + 1]?.start ?? text.length) : text.length,
  }))
}
