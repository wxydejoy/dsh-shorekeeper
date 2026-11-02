/** dsh-keeper-voice —— 守岸人的声音。
 *
 * 插件族规范（仓库根 README.md）：TS 模块、入口 apply(ctx)、注册工具前 inject ['tools']。
 * 说话主链路是 dsh-tts 的 custom provider 配置接线（零代码），本插件提供试听/打断/状态工具。
 */

import type { Context } from '@deepseek-ai/cordis'
import { KeeperClient } from './keeper-client.ts'
import { createKeeperTools } from './tools.ts'
import { Config, type KeeperVoiceConfig } from './config.ts'

export const inject = ['tools']

export { Config }

export function apply(ctx: Context, config: KeeperVoiceConfig): void {
  const client = new KeeperClient({ baseUrl: config.baseUrl, token: config.token })
  for (const tool of createKeeperTools({ client, config })) {
    ctx.tools.register(tool)
  }
}
