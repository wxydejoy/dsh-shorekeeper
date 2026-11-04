/** keeper-tts 直连客户端（reading 专用薄封装）。
 *
 * 端点：POST /v1/audio/speech（OpenAI 兼容；body 带 play:true 时服务端在本机喇叭
 * 流式出声——keeper-tts 以 --play 起，见 migration/books-format.md §4 与 T8 播放链），
 * POST /v1/stop（打断：清服务端喇叭队列 + 作废在途合成，幂等 200）。
 * 与 dsh-keeper-voice 的 KeeperClient 分工：那是 TTS provider 桥（回字节给 dsh-tts
 * 播放器），这里是听书工具自己驱动播放，不复用以免跨插件依赖。
 */

export class TtsRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(`keeper-tts ${status} ${code}: ${message}`)
    this.name = 'TtsRequestError'
    this.status = status
    this.code = code
  }
}

export interface TtsClientOptions {
  /** 例如 http://127.0.0.1:18100 */
  baseUrl: string
  fetchImpl?: typeof fetch
}

const TIMEOUT_MS = { speech: 120_000, stop: 2_000 } as const

export class TtsClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: TtsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /** 合成并在服务端喇叭出声（play:true）。慢请求：整段按长度可能数十秒。 */
  async speak(input: string, options: { speed?: number; signal?: AbortSignal } = {}): Promise<void> {
    const body: Record<string, unknown> = { input, play: true }
    if (options.speed !== undefined) body.speed = options.speed
    let response: Response
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/*' },
      body: JSON.stringify(body),
    }
    if (options.signal !== undefined) init.signal = options.signal
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/audio/speech`, init)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      const reason = error instanceof Error ? error.message : String(error)
      throw new TtsRequestError(0, 'network', `keeper-tts 不可达：${reason}`)
    }
    if (!response.ok) {
      let code = 'unknown'
      let message = `HTTP ${response.status}`
      try {
        const parsed = (await response.json()) as { error?: { code?: string; message?: string } }
        if (parsed?.error) {
          code = parsed.error.code ?? code
          message = parsed.error.message ?? message
        }
      } catch {
        // 错误响应可能不是 JSON
      }
      throw new TtsRequestError(response.status, code, message)
    }
    // 消费掉音频字节（服务端已出声；字节留作将来接字幕/存档）
    await response.arrayBuffer()
  }

  /** 打断：清 keeper 本地喇叭与在途合成（幂等）。 */
  async stop(): Promise<void> {
    try {
      await this.fetchImpl(`${this.baseUrl}/v1/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(TIMEOUT_MS.stop),
      })
    } catch {
      // 打断尽力而为：服务端不在线时本地循环自己会停
    }
  }
}
