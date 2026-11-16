/** 闸门状态的落盘（2026-11-16 重复提醒事故的修法）。
 *
 * 事故：异动闸的「同一件事一天一次」只记在内存里，dsh 一重启就归零。
 * 那天 dsh 重启了六次（改配置/装插件/手动 kickstart），PM2.5 连着发了
 * 六条「外面空气不好了，PM2.5 到 101 了」。重启是可以预期的日常动作，
 * 去重不能因为重启就失效，所以把「今天说过哪些事 + 说了几条」写进
 * `~/.dsh/keeper-watch-state.json`。
 *
 * 只存判定所需的最小状态：日期、条数、key→日期。没有正文、没有设备信息，
 * 文件坏了按「今天什么都没说过」处理（宁可多说一句，不能永远闭嘴）。
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { GateState, GateStore } from './gates.ts'

/** 读回来是不是一个能用的状态。字段类型不对就整份丢掉。 */
export function parseGateState(raw: string): GateState | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>
  const day = obj.day
  const count = obj.count
  if (typeof day !== 'string' || day === '') return null
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return null
  const alerted: Record<string, string> = {}
  const rawAlerted = obj.alerted
  if (typeof rawAlerted === 'object' && rawAlerted !== null) {
    for (const [key, value] of Object.entries(rawAlerted as Record<string, unknown>)) {
      if (typeof value === 'string') alerted[key] = value
    }
  }
  return { day, count: Math.floor(count), alerted }
}

/** 文件型 GateStore。读不到/坏了回 null；写用临时文件 + rename，别留半截 JSON。 */
export function createFileGateStore(path: string, warn?: (message: string) => void): GateStore {
  return {
    load(): GateState | null {
      let raw: string
      try {
        raw = readFileSync(path, 'utf8')
      } catch {
        return null // 还没写过（第一次装）：当今天什么都没说过
      }
      return parseGateState(raw)
    },
    save(state: GateState): void {
      try {
        const tmp = `${path}.tmp`
        writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
        renameSync(tmp, path)
      } catch (error) {
        warn?.(`闸门状态落盘失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}
