/** k20 屏网关扩展路由客户端（协议增补提案）。
 *
 * 现行 lan-protocol v1 没有三件事的客户端入口：字幕推送、phone.layout 写入、熄屏。
 * 按协议文档 §13 的规矩，先把契约写成增补提案（docs/protocol-addendum.md），
 * 再写客户端——网关侧（T7 的瘦身 Hub）与安卓渲染落地前，真实环境会 404，
 * 工具层据此优雅降级。
 */

import type { PhoneLayoutPatch } from './types.ts'
import { HubRequestError, type HubClientOptions } from './hub-client.ts'

export interface CaptionStyle {
  /** 字幕字号缩放百分比（60–140），缺省用屏上当前值 */
  scale?: number
}

export interface GatewayClientOptions extends HubClientOptions {}

export class GatewayClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch

  constructor(options: GatewayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  /** 推字幕。text 空串等价 clear()。成功后 snapshot.caption 更新（带 at 时间戳去重） */
  async caption(text: string, style?: CaptionStyle): Promise<{ ok: true }> {
    const body: Record<string, unknown> = { text }
    if (style?.scale !== undefined) body.scale = style.scale
    return this.post('/v1/caption', body)
  }

  /** 清字幕 */
  async clearCaption(): Promise<{ ok: true }> {
    return this.post('/v1/caption', { clear: true })
  }

  /** 写入主屏布局（服务端负责把 layout.rev 递增；安卓按 rev 变大才套用。槽位矩形可部分给，缺省字段服务端保留现值） */
  async setPhoneLayout(layout: PhoneLayoutPatch): Promise<{ ok: true }> {
    return this.post('/v1/phone/layout', { layout })
  }

  /** 设备管理员熄屏（高危，工具层走审批） */
  async lock(): Promise<{ ok: true }> {
    return this.post('/v1/lock', {})
  }

  private async post(path: string, body: unknown): Promise<{ ok: true }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
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
        throw new HubRequestError(response.status, code, message)
      }
      return { ok: true }
    } catch (error) {
      if (error instanceof HubRequestError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new HubRequestError(0, 'timeout', `请求超时：${path}`)
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new HubRequestError(0, 'network', `网关不可达：${reason}`)
    } finally {
      clearTimeout(timer)
    }
  }
}
