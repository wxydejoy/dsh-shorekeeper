/** 插件 Config（Schemastery）。host 侧设置卡片由此生成。 */

import Schema from '@deepseek-ai/schemastery'

export interface K20Config {
  /** k20 屏网关（瘦身 Hub）地址，例如 http://192.168.1.12 */
  host: string
  /** Hub 与 k20 不同机时的 Hub 地址（缺省回落 host）。典型部署：Hub 在 Mac（127.0.0.1），背景面在 k20.lan */
  hubHost?: string
  /** 主协议端口（lan-protocol §2 默认 17890） */
  port: number
  /** 共享 token（主协议 Bearer 与 :17920 登录同源） */
  token: string
  /** k20 安卓端 BackgroundServer 端口（BackgroundServer.kt PORT=17920） */
  backgroundPort: number
  /** 字幕默认字号缩放（60–140） */
  captionScale: number
  /** 熄屏高危开关：false 时 k20.lock 一律拒绝 */
  lockEnabled: boolean
}

export const Config = Schema.object({
  host: Schema.string().description('k20 安卓端地址（背景面 BackgroundServer 所在）').default('http://k20.lan').required(),
  hubHost: Schema.string().description('Hub 瘦身地址（与 k20 不同机时必填；缺省回落 host）'),
  port: Schema.number().min(1).max(65535).description('主协议端口').default(17890),
  token: Schema.string().description('共享 token（≥8 字符；与安卓设置页一致）').required(),
  backgroundPort: Schema.number().min(1).max(65535).description('安卓端 BackgroundServer 端口').default(17920),
  captionScale: Schema.number().min(60).max(140).description('字幕默认字号缩放百分比').default(100),
  lockEnabled: Schema.boolean().description('允许熄屏（高危；关闭时 k20.lock 直接拒绝）').default(false),
})

export function hubBaseUrl(config: K20Config): string {
  const base = (config.hubHost?.trim() || config.host).replace(/\/+$/, '')
  return `${base}:${config.port}`
}

export function backgroundBaseUrl(config: K20Config): string {
  return `${config.host.replace(/\/+$/, '')}:${config.backgroundPort}`
}
