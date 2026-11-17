/** 播报出声：切段 → keeper-tts `/v1/audio/speech`（play:true 服务端在本机喇叭流式播）。
 *
 * 为什么不把整段一次发过去：稿子 150–200 字一口气合成，首字要等好几秒，而且
 * 中途想说「停」只能等整段结束。/v1/stop 能清队，所以按 36 字左右的段串行送，
 * 打断代价就是「当前这一小段」。
 *
 * 切块规则照抄 dsh-shorekeeper-reading/src/speech.ts 的 cut_sentences / pack_read_chunks
 * （books-format.md §4 的口径：句末 。！？ 与换行断句，逗号族再拆、拼到 36 字、上限 52）。
 * 跨插件 import 会把两个包的依赖绑在一起，所以拷一份精简版，口径改了两边一起改。
 */

const PACK_TARGET = 36
const PACK_LIMIT = 52
const SENTENCE_LIMIT = 120
const CHARS_PER_SECOND = 4.0
/** speak 早返回时按估时比例等待，避免把整个队列堆在服务端 */
const PACE_FACTOR = 0.9

const PUNCT_ONLY = /^[\s，。！？、；：「」『』""''…—·\p{P}\p{S}]*$/u

/** 句末断句（标点留块尾）。 */
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

/** 供 TTS 的段列表：先按句断，逗号族拆开，再拼到 36 字（上限 52），过短尾块并入前一段。 */
export function splitForSpeech(text: string): string[] {
  const clauses: string[] = []
  for (const raw of cutSentences(text)) {
    const sentence = raw.length <= SENTENCE_LIMIT ? raw : ''
    if (sentence === '') {
      // 超长无标点串：等长硬切
      for (let i = 0; i < raw.length; i += SENTENCE_LIMIT) {
        clauses.push(raw.slice(i, i + SENTENCE_LIMIT))
      }
      continue
    }
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
    if (clause.length > PACK_LIMIT) {
      if (buffer !== '') {
        packed.push(buffer)
        buffer = ''
      }
      for (let i = 0; i < clause.length; i += PACK_LIMIT) packed.push(clause.slice(i, i + PACK_LIMIT))
      continue
    }
    if (buffer !== '' && buffer.length + clause.length > PACK_TARGET) {
      packed.push(buffer)
      buffer = clause
      continue
    }
    buffer += clause
  }
  if (buffer !== '') {
    const last = packed[packed.length - 1]
    if (packed.length > 0 && buffer.length <= Math.ceil(PACK_TARGET / 2) && (last?.length ?? 0) + buffer.length <= PACK_LIMIT) {
      packed[packed.length - 1] = last + buffer
    } else {
      packed.push(buffer)
    }
  }
  return packed.filter((p) => p !== '' && !PUNCT_ONLY.test(p))
}

export interface SpeakerStatus {
  playing: boolean
  spokenChunks: number
  totalChunks: number
  /** 正在播的稿子（截断前的全文） */
  text: string
  startedAt: number | null
  /** 这一轮怎么收的尾：end / stop / error */
  stoppedBy: 'end' | 'stop' | 'error' | null
  error: string | null
}

export interface NewsSpeakerOptions {
  baseUrl: string
  speed: number
  volume: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** 段间节流系数（默认 0.9；测试传 0 就不等） */
  paceFactor?: number
  log?: { info(fmt: string, ...args: unknown[]): void; warn(fmt: string, ...args: unknown[]): void }
}

/** 串行播一段稿子；`start` 立即返回，出声在后台。 */
export class NewsSpeaker {
  private readonly baseUrl: string
  private readonly speedDefault: number
  private readonly volumeDefault: number
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly paceFactor: number
  private readonly log: NewsSpeakerOptions['log']

  private controller: AbortController | null = null
  private loop: Promise<void> | null = null
  private spoken = 0
  private total = 0
  private text = ''
  private startedAt: number | null = null
  private stoppedBy: 'end' | 'stop' | 'error' | null = null
  private errorMessage: string | null = null

  constructor(options: NewsSpeakerOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.speedDefault = options.speed
    this.volumeDefault = options.volume
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 120_000
    this.paceFactor = options.paceFactor ?? PACE_FACTOR
    this.log = options.log
  }

  get playing(): boolean {
    return this.loop !== null
  }

  get status(): SpeakerStatus {
    return {
      playing: this.loop !== null,
      spokenChunks: this.spoken,
      totalChunks: this.total,
      text: this.text,
      startedAt: this.startedAt,
      stoppedBy: this.stoppedBy,
      error: this.errorMessage,
    }
  }

  /** 开播。正在播时先打断旧的（点第二次就是重播）。空稿返回 false。 */
  start(text: string, options: { speed?: number; volume?: number } = {}): boolean {
    const chunks = splitForSpeech(text)
    if (chunks.length === 0) return false
    // 旧一轮先 abort（不等它收尾，避免点播时卡住）
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    this.spoken = 0
    this.total = chunks.length
    this.text = text
    this.startedAt = Date.now()
    this.stoppedBy = null
    this.errorMessage = null
    const speed = clampSpeed(options.speed ?? this.speedDefault)
    const volume = clampVolume(options.volume ?? this.volumeDefault)
    this.loop = this.run(chunks, speed, volume, controller)
      .catch((error: unknown) => {
        this.stoppedBy = 'error'
        this.errorMessage = error instanceof Error ? error.message : String(error)
        this.log?.warn('播报中断：%s', this.errorMessage)
      })
      .finally(() => {
        if (this.controller === controller) {
          this.controller = null
          this.loop = null
        }
      })
    return true
  }

  /** 打断：本地循环中止 + 服务端喇叭清队。 */
  async stop(): Promise<void> {
    this.stoppedBy = 'stop'
    this.controller?.abort()
    try {
      await this.fetchImpl(`${this.baseUrl}/v1/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(2_000),
      })
    } catch {
      // 打断尽力而为：服务不在线时本地循环自己会停
    }
    if (this.loop) await this.loop.catch(() => {})
  }

  private async run(chunks: string[], speed: number, volume: number, controller: AbortController): Promise<void> {
    for (const chunk of chunks) {
      if (controller.signal.aborted) {
        this.stoppedBy = this.stoppedBy ?? 'stop'
        return
      }
      const startedAt = Date.now()
      const ok = await this.speakChunk(chunk, speed, volume, controller.signal)
      if (!ok) {
        if (controller.signal.aborted) {
          this.stoppedBy = this.stoppedBy ?? 'stop'
          return
        }
        this.stoppedBy = 'error'
        this.errorMessage = this.errorMessage ?? 'keeper-tts 连续失败'
        return
      }
      this.spoken += 1
      // 让声音别排队：按估时等到这一段的 90% 再送下一段
      const estimateMs = (chunk.replace(/\s/g, '').length / CHARS_PER_SECOND / speed) * 1000 * this.paceFactor
      const remain = estimateMs - (Date.now() - startedAt)
      if (remain > 0) await sleep(Math.min(remain, 15_000), controller.signal)
    }
    this.stoppedBy = 'end'
  }

  /** 单段合成+播放。502/网络错重试一次（PortAudio 偶发 -9986）。 */
  private async speakChunk(chunk: string, speed: number, volume: number, signal: AbortSignal): Promise<boolean> {
    const body = JSON.stringify({ input: chunk, play: true, speed, volume })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (signal.aborted) return false
      if (attempt > 0) {
        const paused = await sleep(600, signal)
        if (!paused) return false
      }
      try {
        const resp = await this.fetchImpl(`${this.baseUrl}/v1/audio/speech`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'audio/*' },
          body,
          signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
        })
        if (resp.ok) {
          await resp.arrayBuffer()
          return true
        }
        // 4xx 不重试（请求本身有问题），5xx 留给下一轮
        if (resp.status < 500) {
          this.log?.warn('keeper-tts 拒绝播报：HTTP %d', resp.status)
          return false
        }
      } catch (error) {
        if (signal.aborted) return false
        this.log?.warn('keeper-tts 不可达：%s', error instanceof Error ? error.message : String(error))
      }
    }
    return false
  }
}

function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1.0
  return Math.min(2.0, Math.max(0.5, value))
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 40
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** 可中止的 sleep：被 abort 时立即返回 false。 */
function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false)
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
