/** dsh-shorekeeper-desk-mi —— desk 薄工具层：now 时钟 + 米家只读/受控工具。
 *
 * 产物动机（T1/T3 实测）：dsh 运行时上下文只有日期无时钟（L4）；mijia-sidebar 无工具面（D12）。
 * 插件族规范：TS 模块、apply(ctx)、inject ['tools']；控制类默认关（红线）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { createBridge, defaultScriptPath } from './bridge.ts'
import { createDeskMiTools } from './tools.ts'
import { Config, type DeskMiConfig } from './config.ts'

export const inject = ['tools']

export { Config }

export function apply(ctx: Context, config: DeskMiConfig): void {
  const bridge = createBridge({
    pythonBin: config.pythonBin,
    scriptPath: defaultScriptPath(import.meta.url),
  })

  for (const tool of createDeskMiTools({ bridge, config })) {
    ctx.tools.register(tool)
  }

  ctx.logger('desk-mi').info(
    'desk-mi 就绪：sensors=%d controlEnabled=%s',
    config.sensors.length,
    String(config.controlEnabled),
  )
}
