/** keeper-settings.json 运行时覆盖 —— 与 keeper-watch 共用同一个文件，新闻占 `news` 段。
 *
 * { "news": { "enabled": true, "morningAt": "08:30", "eveningAt": "21:00",
 *             "count": 5, "speakOnlyWhenPresent": false } }
 *
 * 每个 tick 现读：面板改完下一分钟就生效，不用重启 dsh（重启会顺手把会话状态清一遍）。
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { NewsConfig } from './config.ts'

export interface NewsOverrides {
  enabled?: boolean
  morningAt?: string
  eveningAt?: string
  count?: number
  speakOnlyWhenPresent?: boolean
}

export function overridesFilePath(): string {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'keeper-settings.json')
}

export function readNewsOverridesSync(path = overridesFilePath()): NewsOverrides {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const news = readObject(raw, 'news')
    const out: NewsOverrides = {}
    if (typeof news.enabled === 'boolean') out.enabled = news.enabled
    if (typeof news.morningAt === 'string') out.morningAt = news.morningAt.trim()
    if (typeof news.eveningAt === 'string') out.eveningAt = news.eveningAt.trim()
    if (typeof news.count === 'number' && Number.isFinite(news.count)) out.count = Math.min(10, Math.max(1, Math.floor(news.count)))
    if (typeof news.speakOnlyWhenPresent === 'boolean') out.speakOnlyWhenPresent = news.speakOnlyWhenPresent
    return out
  } catch {
    return {}
  }
}

function readObject(raw: unknown, key: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) return {}
  const value = (raw as Record<string, unknown>)[key]
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** 覆盖叠加到基线（纯函数，测试可直接驱动）。 */
export function applyNewsOverrides(base: NewsConfig, o: NewsOverrides): NewsConfig {
  return {
    ...base,
    enabled: o.enabled ?? base.enabled,
    morningAt: o.morningAt ?? base.morningAt,
    eveningAt: o.eveningAt ?? base.eveningAt,
    count: o.count ?? base.count,
    speakOnlyWhenPresent: o.speakOnlyWhenPresent ?? base.speakOnlyWhenPresent,
  }
}
