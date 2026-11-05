/** keeper-settings.json 运行时覆盖（deskMi 段）—— 守岸人设置面板
 *  （dsh-keeper-console）写、本插件每次控制执行现读。
 *
 * 与 keeper-watch 共用一个文件；本段只关心 deskMi：
 * { "deskMi": { "controlEnabled": false, "controlPerMinute": 10 } }
 * 文件缺省/字段缺省 = 回落 Config 基线（写入闸门红线默认不变）。
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface DeskMiOverrides {
  controlEnabled?: boolean
  controlPerMinute?: number
}

export function overridesFilePath(): string {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'keeper-settings.json')
}

export function readDeskMiOverridesSync(): DeskMiOverrides {
  try {
    const raw = JSON.parse(readFileSync(overridesFilePath(), 'utf8'))
    const deskMi = raw && typeof raw === 'object' && raw.deskMi && typeof raw.deskMi === 'object' ? raw.deskMi : {}
    const out: DeskMiOverrides = {}
    if (typeof deskMi.controlEnabled === 'boolean') out.controlEnabled = deskMi.controlEnabled
    if (
      typeof deskMi.controlPerMinute === 'number' &&
      Number.isFinite(deskMi.controlPerMinute) &&
      deskMi.controlPerMinute >= 0
    ) {
      out.controlPerMinute = Math.floor(deskMi.controlPerMinute)
    }
    return out
  } catch {
    return {}
  }
}

/** 覆盖叠加到基线（纯函数，测试可直接驱动）。读侧滤过一轮，这里双层同界再消毒。 */
export function applyDeskMiOverrides(
  base: { controlEnabled: boolean; controlPerMinute: number },
  o: DeskMiOverrides,
): { controlEnabled: boolean; controlPerMinute: number } {
  return {
    controlEnabled: typeof o.controlEnabled === 'boolean' ? o.controlEnabled : base.controlEnabled,
    controlPerMinute:
      typeof o.controlPerMinute === 'number' && Number.isFinite(o.controlPerMinute) && o.controlPerMinute >= 0
        ? Math.floor(o.controlPerMinute)
        : base.controlPerMinute,
  }
}
