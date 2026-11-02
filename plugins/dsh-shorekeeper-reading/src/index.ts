/** dsh-shorekeeper-reading —— 守岸人的阅读。
 *
 * 插件族规范（仓库根 README.md）：TS 模块、入口 apply(ctx)、注册工具前 inject ['tools']。
 * 数据与 migration/export_books.py 落点一致；听书 ⏸ T4 联调、记忆联动 ⏸ T3 选型。
 */

import type { Context } from '@deepseek-ai/cordis'
import { ShelfStore } from './shelf.ts'
import { createReadingTools } from './tools.ts'
import { Config, resolveDataDir, type ReadingConfig } from './config.ts'

export const inject = ['tools']

export { Config }

export function apply(ctx: Context, config: ReadingConfig): void {
  const store = new ShelfStore(resolveDataDir(config))
  for (const tool of createReadingTools({ store })) {
    ctx.tools.register(tool)
  }
}
