/** dsh-shorekeeper-desk-mi —— desk 薄工具层：now 时钟 + 米家只读/受控工具。
 *
 * 产物动机（T1/T3 实测）：dsh 运行时上下文只有日期无时钟（L4）；mijia-sidebar 无工具面（D12）。
 * 插件族规范：TS 模块、apply(ctx)、inject ['tools']；控制类默认关（红线）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { createBridge, defaultScriptPath } from './bridge.ts'
import { lightReply, matchLightCommand } from './fast-light.ts'
import { createDeskMiTools } from './tools.ts'
import { Config, type DeskMiConfig } from './config.ts'

export const inject = ['tools']

export { Config }

export function apply(ctx: Context, config: DeskMiConfig): void {
  const bridge = createBridge({
    pythonBin: config.pythonBin,
    scriptPath: defaultScriptPath(import.meta.url),
  })

  const tools = createDeskMiTools({ bridge, config })
  for (const tool of tools) {
    ctx.tools.register(tool)
  }

  // 微信入站在进模型前调用。只截「一盏灯 + 一个动作」；没命中返回 null，会话照旧进守岸人。
  const light = tools.find((tool) => tool.name === 'desk_mi_light')
  const hooks = globalThis as {
    __shorekeeperFastLight?: (text: string) => Promise<string | null>
    __shorekeeperPushCaption?: (text: string) => void
  }
  hooks.__shorekeeperFastLight = async (text: string) => {
    const command = matchLightCommand(text)
    if (!command || !light) return null
    let ok = false
    try {
      const value = await light.execute(
        { name: command.name, action: command.action, brightness: command.brightness },
        null as never,
      )
      ok = typeof value === 'object' && value !== null && (value as { ok?: boolean }).ok === true
    } catch {
      ok = false
    }
    const reply = lightReply(command, ok)
    try {
      hooks.__shorekeeperPushCaption?.(reply)
    } catch {
      // 屏不在也不挡微信回复
    }
    return reply
  }

  ctx.logger('desk-mi').info(
    'desk-mi 就绪：sensors=%d controlEnabled=%s',
    config.sensors.length,
    String(config.controlEnabled),
  )
}
