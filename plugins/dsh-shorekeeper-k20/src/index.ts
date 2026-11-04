/** dsh-shorekeeper-k20 —— k20 安卓屏驱动。
 *
 * 插件族规范（仓库根 README.md）：TS 模块、入口 apply(ctx)、注册工具前 inject ['tools']。
 * 配置按 Schemastery（src/config.ts），工具面见 src/tools.ts 与插件 README。
 */

import type { Context } from '@deepseek-ai/cordis'
import { HubClient } from './hub-client.ts'
import { SnapshotWatcher } from './longpoll.ts'
import { BackgroundClient } from './background-client.ts'
import { GatewayClient } from './gateway.ts'
import { createK20Tools } from './tools.ts'
import { Config, hubBaseUrl, backgroundBaseUrl, type K20Config } from './config.ts'
import { K20Gateway, registerK20Server } from './server.ts'

// tools 必需；webServer 必需（cordis 4.0.5 只认 string[] 形式，obmc-web 同款先例）
export const inject = ['tools', 'webServer']

export { Config }

export function apply(ctx: Context, config: K20Config): void {
  const hub = new HubClient({ baseUrl: hubBaseUrl(config), token: config.token })
  const background = new BackgroundClient({ baseUrl: backgroundBaseUrl(config), token: config.token })
  const gateway = new GatewayClient({ baseUrl: hubBaseUrl(config), token: config.token })

  for (const tool of createK20Tools({ hub, background, gateway, config })) {
    ctx.tools.register(tool)
  }

  // 长轮询订阅：维持与网关的连接并跟踪 seq，供 T3/T4 后续接入唤醒/打断事件。
  // TODO(T1 真机校准)：cordis 分支的 Events 没有 dispose 事件，卸载时的 watcher 停止
  // 接线待对照真实宿主生命周期 API 补上；此前插件重载会多挂一个轮询循环。
  const watcher = new SnapshotWatcher({
    client: hub,
    waitSec: 25,
    onSnapshot: () => {},
    onError: (error) => {
      ctx.logger('k20').warn('长轮询断开，将自动重连：%s', error instanceof Error ? error.message : String(error))
    },
  })
  watcher.start()

  // —— T7 直链：宿主有 webServer 且 serve 开启时，把 lan-protocol 服务化 ——
  // 客户端三面不自动改指向：部署时把插件 config 的 hubHost/port 指到本实例即可
  // （如 http://10.14.14.117:3090），工具与网关路由同源。
  if (!config.serve) return
  const webServer = getWebServer(ctx)
  if (webServer === undefined) {
    ctx.logger('k20').warn('serve=true 但宿主没有 webServer 服务，网关路由未注册')
    return
  }
  const gatewayState = new K20Gateway(config.serverName ?? 'study')
  registerK20Server({ ctx, webServer, config: { token: config.token, serverName: config.serverName ?? 'study' }, gateway: gatewayState })
  ctx.logger('k20').info('k20 网关已挂上宿主 webServer（/health /v1/snapshot /v1/caption /v1/phone/layout /v1/lock /v1/devices/*）')
}

interface WebServerLike {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => unknown }): () => unknown
}

/** optional 注入 + 软取双保险：cordis 把注入服务挂 ctx 属性，缺失时不抛 */
function getWebServer(ctx: Context): WebServerLike | undefined {
  const candidates = [
    (ctx as unknown as { webServer?: unknown }).webServer,
    (ctx as { get?: (name: string) => unknown }).get?.('webServer'),
  ]
  for (const value of candidates) {
    if (value !== null && value !== undefined && typeof (value as { register?: unknown }).register === 'function') {
      return value as WebServerLike
    }
  }
  return undefined
}
