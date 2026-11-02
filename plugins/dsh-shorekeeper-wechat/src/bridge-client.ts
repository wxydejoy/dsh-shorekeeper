/** 微信桥客户端。桥是 Windows 挂机侧的独立小服务（wcferry 实现，契约见 docs/bridge-contract.md）。
 * 插件与桥 HTTP 解耦：桥崩可重启不丢状态（任务书风险对策）；桥不可达 → 工具层优雅降级。
 */

export class BridgeRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`wechat bridge ${status} ${code}: ${message}`)
    this.name = 'BridgeRequestError'
  }
}

export interface BridgeClientOptions {
  /** 例如 http://win.lan:17901 */
  baseUrl: string
  token?: string
  fetchImpl?: typeof fetch
}

export interface BridgeHealth {
  ok: boolean
  service: string
  /** 桥与微信的连接态：wcferry 掉线时 false */
  wechatOnline: boolean
  account?: string
}

const TIMEOUT_MS = { health: 5_000, digest: 10_000, read: 10_000, send: 15_000 } as const

export class BridgeClient {
  private readonly baseUrl: string
  private readonly token: string | undefined
  private readonly fetchImpl: typeof fetch

  constructor(options: BridgeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token || undefined
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async health(): Promise<BridgeHealth> {
    return this.request('GET', '/api/health', { timeoutMs: TIMEOUT_MS.health })
  }

  async digest(): Promise<{ groups: import('./types.ts').DigestGroup[] }> {
    return this.request('GET', '/api/digest', { timeoutMs: TIMEOUT_MS.digest })
  }

  async read(contactId: string, limit: number): Promise<{ messages: import('./types.ts').BridgeMessage[] }> {
    return this.request('POST', '/api/read', {
      body: { contactId, limit: Math.min(50, Math.max(1, Math.floor(limit))) },
      timeoutMs: TIMEOUT_MS.read,
    })
  }

  async send(contactId: string, text: string): Promise<{ ok: true; at: string }> {
    return this.request('POST', '/api/send', { body: { contactId, text }, timeoutMs: TIMEOUT_MS.send })
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; timeoutMs: number },
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    const init: RequestInit = { method, headers, signal: controller.signal }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(options.body)
    }
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, init)
      if (!response.ok) {
        let code = 'unknown'
        let message = `HTTP ${response.status}`
        try {
          const parsed = (await response.json()) as { error?: { code?: string; message?: string } }
          code = parsed.error?.code ?? code
          message = parsed.error?.message ?? message
        } catch {
          // 非 JSON 错误体
        }
        throw new BridgeRequestError(response.status, code, message)
      }
      const text = await response.text()
      return (text ? JSON.parse(text) : {}) as T
    } catch (error) {
      if (error instanceof BridgeRequestError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new BridgeRequestError(0, 'timeout', `请求超时（${options.timeoutMs}ms）：${path}`)
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new BridgeRequestError(0, 'network', `微信桥不可达：${reason}`)
    } finally {
      clearTimeout(timer)
    }
  }
}
