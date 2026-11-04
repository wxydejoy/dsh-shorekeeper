/** dsh-shorekeeper-reading —— 守岸人的阅读。
 *
 * 插件族规范（仓库根 README.md）：TS 模块、入口 apply(ctx)、注册工具前 inject ['tools']。
 * 数据与 migration/export_books.py 落点一致；听书三件（Z8）直连 keeper-tts 服务端喇叭，
 * 打断=再来一条指令即停（barge-in 桥 ⏸ T4）；记忆联动 ⏸ T3 选型。
 */

import type { Context } from '@deepseek-ai/cordis'
import { ShelfStore } from './shelf.ts'
import { createReadingTools } from './tools.ts'
import { Config, resolveDataDir, type ReadingConfig } from './config.ts'
import { TtsClient } from './tts-client.ts'
import { ListenEngine, ListenState } from './listen.ts'

export const inject = ['tools']

export { Config }

export function apply(ctx: Context, config: ReadingConfig): void {
  const dataDir = resolveDataDir(config)
  const store = new ShelfStore(dataDir)
  const tts = new TtsClient({ baseUrl: config.ttsBaseUrl })
  const state = new ListenState(store.dataDir)
  const engine = new ListenEngine({ store, tts, state, speedDefault: config.ttsSpeed })
  for (const tool of createReadingTools({ store, listen: engine })) {
    ctx.tools.register(tool)
  }
}
