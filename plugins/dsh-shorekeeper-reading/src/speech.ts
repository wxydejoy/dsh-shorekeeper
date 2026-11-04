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
