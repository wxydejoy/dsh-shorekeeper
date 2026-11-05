/** keeper-settings.json 运行时覆盖 —— 守岸人设置面板（dsh-keeper-console）写、
 *  本插件每个 tick 现读。文件缺省 = 全部回落 Config 基线；字段显式给出才生效。
 *
 * 结构（面板与两插件共用的一个文件）：
 * { "watch":  { "enabled": true, "quietEnabled": true, "dailyLimit": 12 },
 *   "deskMi": { "controlEnabled": false, "controlPerMinute": 10 } }
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface WatchOverrides {
  enabled?: boolean
  quietEnabled?: boolean
  dailyLimit?: number
}

export function overridesFilePath(): string {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'keeper-settings.json')
}

export function readWatchOverridesSync(): WatchOverrides {
  try {
    const raw = JSON.parse(readFileSync(overridesFilePath(), 'utf8'))
    const watch = raw && typeof raw === 'object' && raw.watch && typeof raw.watch === 'object' ? raw.watch : {}
    const out: WatchOverrides = {}
    if (typeof watch.enabled === 'boolean') out.enabled = watch.enabled
    if (typeof watch.quietEnabled === 'boolean') out.quietEnabled = watch.quietEnabled
    if (typeof watch.dailyLimit === 'number' && Number.isFinite(watch.dailyLimit) && watch.dailyLimit >= 0) {
      out.dailyLimit = Math.floor(watch.dailyLimit)
    }
    return out
  } catch {
    return {}
  }
}

/** 覆盖叠加到基线（纯函数，测试可直接驱动）。显式缺字段 = 回落基线；
 *  这里也做一遍消毒（读侧已滤过一轮，双层同界防脏值直达闸门）。
 */
export function applyWatchOverrides(
  base: { enabled: boolean; quietHours: [string, string] | []; dailyLimit: number },
  o: WatchOverrides,
): { enabled: boolean; quietHours: [string, string] | []; dailyLimit: number } {
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    // 免打扰开关只在显式 false 时关掉时段；缺省维持基线（允许跨零点的窗口）
    quietHours: o.quietEnabled === false ? [] : base.quietHours,
    dailyLimit:
      typeof o.dailyLimit === 'number' && Number.isFinite(o.dailyLimit) && o.dailyLimit >= 0
        ? Math.floor(o.dailyLimit)
        : base.dailyLimit,
  }
}
