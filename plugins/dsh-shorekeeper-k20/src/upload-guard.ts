/** 背景壁纸上传闸门：格式白名单 + 魔数嗅探 + 大小上限。
 *
 * 面板（浏览器）和 curl 都走 POST /k20-bg/upload，闸门放在转发到手机之前：
 * - 扩展名决定 kind（图片/视频两套上限），扩展名不在白名单直接 415；
 * - 前 12 字节对魔数，防止改了后缀的怪文件进手机（HEIC 改 .png 之类）；
 * - 声明的 Content-Length 超上限先 413，不给手机传半截；
 * - 拿不到长度的 chunked 上传，边转边数，超了就抛 413。
 *
 * 手机端 BackgroundServer 自己不做尺寸限制（实测 43MB 视频照收），所以这里是唯一闸门。
 */

export type BackgroundKind = 'image' | 'video'

export interface UploadLimits {
  /** 图片上限（MB） */
  imageMB: number
  /** 视频上限（MB） */
  videoMB: number
}

export const EXTENSIONS: Record<BackgroundKind, readonly string[]> = {
  image: ['jpg', 'jpeg', 'png', 'webp'],
  video: ['mp4', 'webm'],
}

export const DEFAULT_LIMITS: UploadLimits = { imageMB: 20, videoMB: 200 }

/** 上传被闸门拒绝（带 HTTP 状态，路由直接回给浏览器） */
export class UploadRejected extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'UploadRejected'
    this.status = status
  }
}

export function normalizeLimits(raw?: { imageMB?: number | undefined; videoMB?: number | undefined }): UploadLimits {
  const pick = (value: unknown, fallback: number): number => {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) return fallback
    return Math.min(Math.max(Math.round(n), 1), 4096)
  }
  return {
    imageMB: pick(raw?.imageMB, DEFAULT_LIMITS.imageMB),
    videoMB: pick(raw?.videoMB, DEFAULT_LIMITS.videoMB),
  }
}

export function limitBytes(kind: BackgroundKind, limits: UploadLimits): number {
  return (kind === 'video' ? limits.videoMB : limits.imageMB) * 1024 * 1024
}

/** 人话：给面板和错误文案共用 */
export function describeLimits(limits: UploadLimits): string {
  return `图片 ${EXTENSIONS.image.join('/').toUpperCase()} ≤${limits.imageMB}MB；视频 ${EXTENSIONS.video.join('/').toUpperCase()} ≤${limits.videoMB}MB`
}

export function extensionsOf(kind: BackgroundKind): string[] {
  return [...EXTENSIONS[kind]]
}

/** 按扩展名判定 kind；没有扩展名或不在白名单返回 null */
export function kindOfFile(name: string): BackgroundKind | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(name.trim())
  if (match === null) return null
  const ext = (match[1] ?? '').toLowerCase()
  for (const kind of ['image', 'video'] as const) {
    if (EXTENSIONS[kind].includes(ext)) return kind
  }
  return null
}

function ascii(head: Uint8Array, from: number, length: number): string {
  return Buffer.from(head.subarray(from, from + length)).toString('latin1')
}

/** 前 12 字节认容器格式。返回 null = 不认识 */
export function sniffKind(head: Uint8Array): BackgroundKind | null {
  const at = (offset: number): number => head[offset] ?? -1
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image'
  if (at(0) === 0x89 && ascii(head, 1, 3) === 'PNG' && at(4) === 0x0d) return 'image'
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return 'image'
  if (at(4) === 0x66 && at(5) === 0x74 && at(6) === 0x79 && at(7) === 0x70) return 'video' // ftyp
  if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) return 'video' // EBML/webm
  return null
}

const SNIFF_BYTES = 12

/** 转发前先验：扩展名 → 上限 → 声明长度 → 魔数。返回 kind 与已读的头部字节 */
export interface Admission {
  kind: BackgroundKind
  maxBytes: number
  limits: UploadLimits
  /** 声明长度（浏览器基本都给；curl -F 也给） */
  declared?: number
}

export function admitUpload(options: {
  filename: string
  declaredLength?: number | undefined
  kindHint?: BackgroundKind | null
  limits: UploadLimits
}): Admission {
  const { filename, declaredLength, limits } = options
  const kind = kindOfFile(filename) ?? options.kindHint ?? null
  if (kind === null) {
    throw new UploadRejected(415, `不收这个格式：${filename}。${describeLimits(limits)}（没有后缀就加 ?kind=image|video）`)
  }
  const maxBytes = limitBytes(kind, limits)
  if (declaredLength !== undefined && Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new UploadRejected(413, overSizeMessage(declaredLength, maxBytes, kind, limits))
  }
  return {
    kind,
    maxBytes,
    limits,
    ...(declaredLength !== undefined && Number.isFinite(declaredLength) ? { declared: declaredLength } : {}),
  }
}

function overSizeMessage(bytes: number, maxBytes: number, kind: BackgroundKind, limits: UploadLimits): string {
  return `${kind === 'video' ? '视频' : '图片'} ${formatMB(bytes)} 超过上限 ${formatMB(maxBytes)}（${describeLimits(limits)}）`
}

function formatMB(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10}MB`
}

/** 先把头读出来（最多 12 字节），剩下的还是流。
 *
 * 这一步必须在连手机之前做：内容不合格要当场拒，不能让手机收到半截
 * multipart 头留个 0 字节背景。 */
export interface Peeked {
  head: Uint8Array
  rest: AsyncIterable<Uint8Array>
}

export async function peekHead(source: AsyncIterable<Uint8Array>, min = SNIFF_BYTES): Promise<Peeked> {
  const iterator = source[Symbol.asyncIterator]()
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < min) {
    const next = await iterator.next()
    if (next.done === true) break
    const chunk = toBytes(next.value)
    chunks.push(chunk)
    total += chunk.byteLength
  }
  if (total === 0) {
    await iterator.return?.(undefined)
    throw new UploadRejected(400, '上传体是空的：把文件字节放进 body（curl 用 --data-binary @文件）')
  }
  async function* remainder(): AsyncGenerator<Uint8Array> {
    for (;;) {
      const next = await iterator.next()
      if (next.done === true) return
      yield toBytes(next.value)
    }
  }
  return { head: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))), rest: remainder() }
}

/** 头部字节与后缀声明的 kind 对得上吗 */
export function assertContent(head: Uint8Array, admission: Admission): void {
  const sniffed = sniffKind(head)
  if (sniffed === null) {
    throw new UploadRejected(415, `认不出这个文件的格式，${describeLimits(admission.limits)}`)
  }
  if (sniffed !== admission.kind) {
    const actual = sniffed === 'video' ? '视频' : '图片'
    const declared = admission.kind === 'video' ? '视频' : '图片'
    throw new UploadRejected(415, `文件内容像${actual}，但后缀说的是${declared}——换回正确后缀再来`)
  }
}

/** 已经开始转发后的计数闸门：拿不到 Content-Length 时靠它兜底 */
export async function* guardStream(
  head: Uint8Array,
  rest: AsyncIterable<Uint8Array>,
  admission: Admission,
): AsyncGenerator<Uint8Array> {
  let total = head.byteLength
  if (total > admission.maxBytes) throw new UploadRejected(413, `超过上限 ${formatMB(admission.maxBytes)}`)
  yield head
  for await (const chunk of rest) {
    total += chunk.byteLength
    if (total > admission.maxBytes) throw new UploadRejected(413, `超过上限 ${formatMB(admission.maxBytes)}`)
    yield chunk
  }
}

function toBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk)
  throw new UploadRejected(400, '拿到非字节的上传分片')
}
