/** dsh-shorekeeper-wechat —— 守岸人的微信接入。
 *
 * 插件族规范（仓库根 README.md）：TS 模块、入口 apply(ctx)、注册工具前 inject ['tools']。
 * 桥（Windows 挂机侧 wcferry 小服务）契约见 docs/bridge-contract.md；路线决策见
 * docs/decisions-wechat-route.md（主选 wcferry，待漂泊者签字后才接真账号）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { BridgeClient } from './bridge-client.ts'
import { createWechatTools } from './tools.ts'
import { Config, type WechatConfig } from './config.ts'

export const inject = ['tools']

export { Config }

export function apply(ctx: Context, config: WechatConfig): void {
  const bridge = new BridgeClient({ baseUrl: config.bridgeBaseUrl, token: config.bridgeToken })
  for (const tool of createWechatTools({ bridge, config })) {
    ctx.tools.register(tool)
  }
}
