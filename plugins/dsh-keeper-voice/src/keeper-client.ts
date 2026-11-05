/** keeper-tts（:18100 独立进程）客户端。
 *
 * 端点：GET /health、POST /v1/audio/speech（OpenAI 兼容，T4 新增）、POST /v1/stop（打断，既有）。
 * 设计约束（对齐 server.py）：本客户端只回字节不出声——本地播放由 dsh-tts 播放器接管；
 * 打断链路：dsh-tts 播放器 barge-in（自身）+ 本客户端 stop()（冗余保险，停 keeper 本地喇叭与在途合成）。
 */

export class KeeperRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(`keeper-tts ${status} ${code}: ${message}`)
    this.name = 'KeeperRequestError'
    this.status = status
    this.code = code
  }
}

export interface KeeperClientOptions {
  /** 例如 http://127.0.0.1:18100 */
  baseUrl: string
  /** 服务端设了 --token 时必填；本机回环默认免口令 */
  token?: string
  fetchImpl?: typeof fetch
  /** 超时可注入（单测用短超时打超时分支；线上默认 5s/120s/2s） */
  timeouts?: Partial<{ health: number; speech: number; stop: number }>
}

export interface KeeperHealth {
  ok: boolean
  service: string
  ready: boolean
  model: string
  voice: string
  clone: boolean
  play: boolean
  speed: number
  error: string | null
}

export interface SpeechRequest {
  input: string
  /** wav（默认）或 pcm（裸 16bit LE 24kHz） */
  format?: 'wav' | 'pcm'
  /** 0.7–1.5，路由层钳位 */
  speed?: number
  /** 克隆模式下引擎忽略 voice，透传仅为了将来非克隆音色 */
  voice?: string
}

export interface SpeechResult {
  audio: Uint8Array
  contentType: string
  firstAudioMs: number
}

const TIMEOUT_MS = { health: 5_000, speech: 120_000, stop: 2_000 } as const

export class KeeperClient {
  private readonly baseUrl: string
  private readonly token: string | undefined
  private readonly fetchImpl: typeof fetch
  private readonly timeouts: { health: number; speech: number; stop: number }

  constructor(options: KeeperClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token || undefined
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeouts = { ...TIMEOUT_MS, ...options.timeouts }
  }

  async health(): Promise<KeeperHealth> {
    return this.request('GET', '/health', { timeoutMs: this.timeouts.health, auth: false })
  }

  /** OpenAI 兼容合成。慢请求：整段合成按文本长度可能数十秒 */
  async speech(request: SpeechRequest): Promise<SpeechResult> {
    const body: Record<string, unknown> = { input: request.input }
    if (request.format !== undefined) body.response_format = request.format
    if (request.speed !== undefined) body.speed = request.speed
    if (request.voice !== undefined) body.voice = request.voice
    const response = await this.raw('POST', '/v1/audio/speech', { body, timeoutMs: this.timeouts.speech })
    if (!response.ok) throw await this.toError(response)
    const audio = new Uint8Array(await response.arrayBuffer())
    return {
      audio,
      contentType: response.headers.get('Content-Type') ?? 'audio/wav',
      firstAudioMs: Number(response.headers.get('X-First-Audio-Ms') ?? 0) || 0,
    }
  }

  /** 打断：清 keeper 本地喇叭播放队列 + 作废在途合成（幂等，服务端永远 200） */
  async stop(): Promise<void> {
    await this.request('POST', '/v1/stop', { body: {}, timeoutMs: this.timeouts.stop })
  }

  /** F31 白噪音状态（GET /v1/noise） */
  async noiseStatus(): Promise<{ ok: boolean; playing: boolean; name: string | null; seconds_left: number; minutes: number }> {
    return this.request('GET', '/v1/noise', { timeoutMs: this.timeouts.stop, auth: false })
  }

  /** F31 白噪音：放/停。name=off 即停；到点她自动淡出（FADE_SEC 45s），不用再喊一声。
   *  和音乐共用喇叭，谁后到谁说了算（服务端自己 stop 对方）。 */
  async noise(name: 'rain' | 'waves' | 'fan' | 'brown' | 'off', minutes?: number): Promise<{ ok: boolean; name: string | null; minutes: number; seconds_left: number }> {
    return this.request('POST', '/v1/noise', {
      body: { name, ...(minutes !== undefined ? { minutes } : {}) },
      timeoutMs: 10_000,
    })
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; timeoutMs: number; auth?: boolean },
  ): Promise<T> {
    const response = await this.raw(method, path, options)
    if (!response.ok) throw await this.toError(response)
    const text = await response.text()
    return (text ? JSON.parse(text) : {}) as T
  }

  private async raw(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; timeoutMs: number; auth?: boolean },
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs)
    const headers: Record<string, string> = { Accept: 'application/json, audio/*' }
    if (options.auth !== false && this.token) headers.Authorization = `Bearer ${this.token}`
    const init: RequestInit = { method, headers, signal: controller.signal }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(options.body)
    }
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, init)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new KeeperRequestError(0, 'timeout', `请求超时（${options.timeoutMs}ms）：${path}`)
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new KeeperRequestError(0, 'network', `keeper-tts 不可达：${reason}`)
    } finally {
      clearTimeout(timer)
    }
  }

  private async toError(response: Response): Promise<KeeperRequestError> {
    let code = 'unknown'
    let message = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } }
      if (body?.error) {
        code = body.error.code ?? code
        message = body.error.message ?? message
      }
    } catch {
      // 音频响应出错时可能不是 JSON
    }
    return new KeeperRequestError(response.status, code, message)
  }
}
