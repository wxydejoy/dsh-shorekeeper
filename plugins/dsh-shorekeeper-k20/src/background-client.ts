/** k20 安卓端 BackgroundServer（:17920）客户端。
 *
 * 依据岸亭安卓源码（dock/android .../background/BackgroundServer.kt）实现：
 * - 会话：POST /api/login（JSON {"token"}）→ Set-Cookie dock_bg=<session>；其余路由全靠 cookie
 * - GET  /api/backgrounds                → {current, items[]}
 * - POST /api/backgrounds                → multipart 上传（file + 可选 realname），201，上传即设为当前
 * - POST /api/backgrounds/clear          → 清空当前背景
 * - POST /api/backgrounds/{id}/select    → 设为当前
 * - DELETE /api/backgrounds/{id}         → 删除
 * - GET  /api/backgrounds/{id}/media     → 原文件
 * - GET  /api/layout                     → 布局现状（只读；没就绪回 503）
 */

import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { BackgroundIndex } from './types.ts'

export class BackgroundRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(`k20 background ${status}: ${message}`)
    this.name = 'BackgroundRequestError'
    this.status = status
  }
}

export class LayoutNotReadyError extends BackgroundRequestError {
  constructor() {
    super(503, '布局还没就绪，稍后再试')
    this.name = 'LayoutNotReadyError'
  }
}

export interface BackgroundClientOptions {
  /** 例如 http://k20.lan:17920 */
  baseUrl: string
  /** 与 Hub 同一枚共享 token（安卓用它换会话 cookie） */
  token: string
  fetchImpl?: typeof fetch
}

export class BackgroundClient {
  private session: string | null = null
  private readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch

  constructor(options: BackgroundClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async login(): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: this.token }),
    })
    if (!response.ok) throw new BackgroundRequestError(response.status, '口令不对')
    this.session = readSessionCookie(response)
    if (!this.session) throw new BackgroundRequestError(response.status, '登录响应缺少会话 cookie')
  }

  async backgrounds(): Promise<BackgroundIndex> {
    return this.request('GET', '/api/backgrounds')
  }

  /** 上传即生效（服务端把新文件设为当前背景）。realname 用于控制台显示署名 */
  async upload(filename: string, data: Uint8Array, realName?: string): Promise<BackgroundIndex> {
    await this.ensureSession()
    const boundary = `dock-bg-${randomUUID().replaceAll('-', '')}`
    const safeName = filename.replace(/[\r\n"]/g, '_')
    const needsEncoded = /[^\x20-\x7e]/.test(safeName)
    const disposition = needsEncoded
      ? `form-data; name="file"; filename*=UTF-8''${encodeURIComponent(safeName)}`
      : `form-data; name="file"; filename="${safeName}"`
    const parts: Uint8Array[] = []
    const text = (value: string) => new TextEncoder().encode(value)
    if (realName !== undefined) {
      parts.push(
        text(
          `--${boundary}\r\nContent-Disposition: form-data; name="realname"\r\n\r\n${realName}\r\n`,
        ),
      )
    }
    parts.push(text(`--${boundary}\r\nContent-Disposition: ${disposition}\r\nContent-Type: application/octet-stream\r\n\r\n`))
    parts.push(data)
    parts.push(text(`\r\n--${boundary}--\r\n`))
    const body = concat(parts)
    const response = await this.fetchImpl(`${this.baseUrl}/api/backgrounds`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        ...(this.session ? { Cookie: `dock_bg=${this.session}` } : {}),
      },
      body,
    })
    return this.parse('POST /api/backgrounds', response, 201)
  }

  /** 边收边转发的上传。面板走专用 HTTP 路由时用它，200MB 的视频也不进内存做 base64。
   *
   * 手机端（BackgroundServer.readForm）按 Content-Length 限流读取，chunked 会被当成空文件，
   * 所以这里必须把「头 + 文件 + 尾」的总长度算出来显式带上；payloadLength 未知时退回整段缓冲。
   */
  async uploadStream(
    filename: string,
    data: AsyncIterable<Uint8Array>,
    realName?: string,
    payloadLength?: number,
  ): Promise<BackgroundIndex> {
    await this.ensureSession()
    const boundary = `dock-bg-${randomUUID().replaceAll('-', '')}`
    const safeName = filename.replace(/[\r\n"]/g, '_')
    const needsEncoded = /[^\x20-\x7e]/.test(safeName)
    const disposition = needsEncoded
      ? `form-data; name="file"; filename*=UTF-8''${encodeURIComponent(safeName)}`
      : `form-data; name="file"; filename="${safeName}"`
    const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
    const head = [
      ...(realName !== undefined
        ? [`--${boundary}\r\nContent-Disposition: form-data; name="realname"\r\n\r\n${realName}\r\n`]
        : []),
      `--${boundary}\r\nContent-Disposition: ${disposition}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ].join('')
    const headBytes = encode(head)
    const tailBytes = encode(`\r\n--${boundary}--\r\n`)
    async function* multipart(): AsyncGenerator<Uint8Array> {
      yield headBytes
      for await (const chunk of data) yield chunk
      yield tailBytes
    }
    const response = await this.fetchImpl(`${this.baseUrl}/api/backgrounds`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        ...(payloadLength !== undefined && Number.isFinite(payloadLength)
          ? { 'Content-Length': String(headBytes.byteLength + payloadLength + tailBytes.byteLength) }
          : {}),
        ...(this.session ? { Cookie: `dock_bg=${this.session}` } : {}),
      },
      body: Readable.from(multipart()) as unknown as RequestInit['body'],
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    return this.parse('POST /api/backgrounds', response, 201)
  }

  /** 原文件流。面板缩略图/预览走它，cookie 由本进程代持，浏览器不直连手机。 */
  async mediaResponse(id: string, retry = true): Promise<Response> {
    await this.ensureSession()
    const headers: Record<string, string> = {}
    if (this.session) headers.Cookie = `dock_bg=${this.session}`
    const response = await this.fetchImpl(`${this.baseUrl}/api/backgrounds/${encodeURIComponent(id)}/media`, {
      method: 'GET',
      headers,
    })
    if (response.status === 401 && retry) {
      this.session = null
      return this.mediaResponse(id, false)
    }
    if (!response.ok) throw new BackgroundRequestError(response.status, `GET media：HTTP ${response.status}`)
    return response
  }

  async select(id: string): Promise<BackgroundIndex> {
    return this.request('POST', `/api/backgrounds/${encodeURIComponent(id)}/select`)
  }

  async clear(): Promise<BackgroundIndex> {
    return this.request('POST', '/api/backgrounds/clear')
  }

  async remove(id: string): Promise<BackgroundIndex> {
    return this.request('DELETE', `/api/backgrounds/${encodeURIComponent(id)}`)
  }

  /** 布局现状（画布尺寸、槽位目录、默认布局与已存布局）。503 = 布局还没就绪 */
  async layout(): Promise<unknown> {
    return this.request('GET', '/api/layout')
  }

  private async ensureSession(): Promise<void> {
    if (!this.session) await this.login()
  }

  private async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, retry = true): Promise<T> {
    await this.ensureSession()
    const headers: Record<string, string> = {}
    if (this.session) headers.Cookie = `dock_bg=${this.session}`
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers })
    if (response.status === 401 && retry) {
      this.session = null
      return this.request<T>(method, path, false)
    }
    return this.parse<T>(`${method} ${path}`, response, 200)
  }

  private async parse<T>(what: string, response: Response, expected: number): Promise<T> {
    if (response.status === 503) throw new LayoutNotReadyError()
    if (response.status !== expected) {
      let message = `HTTP ${response.status}`
      try {
        const body = (await response.json()) as { error?: string }
        if (body?.error) message = body.error
      } catch {
        // 非 JSON 错误体
      }
      throw new BackgroundRequestError(response.status, `${what}：${message}`)
    }
    const text = await response.text()
    return (text ? JSON.parse(text) : {}) as T
  }
}

function readSessionCookie(response: Response): string | null {
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  for (const cookie of cookies) {
    const pair = cookie.split(';')[0]?.trim() ?? ''
    if (pair.startsWith('dock_bg=')) {
      const value = pair.slice('dock_bg='.length)
      if (value) return value
    }
  }
  return null
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}
