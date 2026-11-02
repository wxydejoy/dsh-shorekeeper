/** k20 Hub（屏网关）协议客户端。依据 reference/lan-protocol.md 快照 TS 重实现。
 *
 * 传输约定：HTTP/1.1 无 TLS、UTF-8 JSON、Bearer token（/health 免鉴权）、
 * 超时按 §2.2（health/snapshot 5s、command 10s、stop 2s、announce 8s）。
 * 错误统一 §7 JSON 形状，归一化为 HubRequestError 抛出。
 */

import type {
  DeviceCommandResult,
  HubErrorBody,
  HubHealth,
  MediaCommandResult,
  SceneResult,
  Snapshot,
} from './types.ts'

export class HubRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`k20 hub ${status} ${code}: ${message}`)
    this.name = 'HubRequestError'
  }
}

export interface HubClientOptions {
  /** 例如 http://192.168.1.12:17890 */
  baseUrl: string
  token: string
  fetchImpl?: typeof fetch
}

const TIMEOUT_MS = {
  health: 5_000,
  snapshot: 5_000,
  command: 10_000,
  scene: 10_000,
  stop: 2_000,
  announce: 8_000,
  notify: 8_000,
  default: 8_000,
} as const

export const MAX_LONGPOLL_WAIT_SEC = 30

export class HubClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch

  constructor(options: HubClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /** 探活。用于确认地址是岸亭 Hub（service=dock-hub） */
  async health(): Promise<HubHealth> {
    return this.request('GET', '/health', { timeoutMs: TIMEOUT_MS.health, auth: false })
  }

  /** 主屏唯一读接口。since/wait 用于长轮询；wait 上限 30 秒 */
  async snapshot(options: { since?: number; wait?: number } = {}): Promise<Snapshot> {
    const query = new URLSearchParams()
    if (options.since !== undefined) query.set('since', String(options.since))
    if (options.wait !== undefined) query.set('wait', String(clampWait(options.wait)))
    const suffix = query.size > 0 ? `?${query}` : ''
    return this.request('GET', `/v1/snapshot${suffix}`, { timeoutMs: TIMEOUT_MS.snapshot })
  }

  /** 控制一个设备（白名单 id）。media 命令走保留 id `media`，返回 media 对象 */
  async command(id: string, body: Record<string, unknown>): Promise<DeviceCommandResult | MediaCommandResult> {
    return this.request('POST', `/v1/devices/${encodeURIComponent(id)}/command`, {
      body,
      timeoutMs: TIMEOUT_MS.command,
    })
  }

  /** 媒体键：toggle / next / previous */
  async media(action: 'toggle' | 'next' | 'previous'): Promise<MediaCommandResult> {
    return (await this.command('media', { media: action })) as MediaCommandResult
  }

  /** 一次开关一组设备（场景 id 来自 snapshot.scenes） */
  async scene(id: string): Promise<SceneResult> {
    return this.request('POST', `/v1/scenes/${encodeURIComponent(id)}`, {
      body: {},
      timeoutMs: TIMEOUT_MS.scene,
    })
  }

  /** 让守岸人在书桌喇叭说 1~3 句（不走对话调度） */
  async announce(text: string): Promise<{ text: string; audio_id: string | null }> {
    return this.request('POST', '/v1/companion/announce', { body: { text }, timeoutMs: TIMEOUT_MS.announce })
  }

  /** 打断当前说话（立刻停 Mini 喇叭） */
  async stopSpeaking(): Promise<{ ok: true }> {
    return this.request('POST', '/v1/companion/stop', { body: {}, timeoutMs: TIMEOUT_MS.stop })
  }

  /** 往手机递一条通知（F33 队列，最多 10 条、24 小时） */
  async notifyPhone(text: string, from = 'dsh'): Promise<{ id: number; text: string; source: string; at: string }> {
    return this.request('POST', '/v1/notify/phone', { body: { text, from }, timeoutMs: TIMEOUT_MS.notify })
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: { body?: unknown; timeoutMs?: number; auth?: boolean } = {},
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? TIMEOUT_MS.default
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.auth !== false && this.token) headers.Authorization = `Bearer ${this.token}`
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    const init: RequestInit = { method, headers, signal: controller.signal }
    if (options.body !== undefined) init.body = JSON.stringify(options.body)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, init)
      if (!response.ok) throw await this.toError(response)
      if (response.status === 204) return undefined as T
      const text = await response.text()
      if (!text) return undefined as T
      return JSON.parse(text) as T
    } catch (error) {
      if (error instanceof HubRequestError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new HubRequestError(0, 'timeout', `请求超时（${timeoutMs}ms）：${path}`)
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new HubRequestError(0, 'network', `Hub 不可达：${reason}`)
    } finally {
      clearTimeout(timer)
    }
  }

  private async toError(response: Response): Promise<HubRequestError> {
    let code = 'unknown'
    let message = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as Partial<HubErrorBody>
      if (body?.error) {
        code = body.error.code ?? code
        message = body.error.message ?? message
      }
    } catch {
      // 非 JSON 错误体：保留 HTTP 状态码信息
    }
    return new HubRequestError(response.status, code, message)
  }
}

export function clampWait(wait: number): number {
  if (!Number.isFinite(wait) || wait <= 0) return 0
  return Math.min(MAX_LONGPOLL_WAIT_SEC, Math.floor(wait))
}
