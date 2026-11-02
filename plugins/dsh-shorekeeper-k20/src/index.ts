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

export const inject = ['tools']

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
}
