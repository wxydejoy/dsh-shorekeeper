/** 播报状态落盘（~/.dsh/keeper-news-state.json）。
 *
 * 存两件事：哪个档位今天已经播过（跨重启不重复开口）、最近一次播了什么
 * （工具面「刚才播了啥」/ 排查用）。写失败只 warn，不影响播报本身。
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_STATE, type NewsStateFile } from './schedule.ts'

export function defaultStatePath(): string {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'keeper-news-state.json')
}

export class NewsState {
  private readonly path: string
  private readonly warn: (message: string) => void
  private data: NewsStateFile

  constructor(path: string, warn?: (message: string) => void) {
    this.path = path
    this.warn = warn ?? (() => {})
    this.data = this.load()
  }

  private load(): NewsStateFile {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<NewsStateFile>
      return {
        version: 1,
        lastRun: raw.lastRun && typeof raw.lastRun === 'object' ? (raw.lastRun as Record<string, string>) : {},
        lastText: typeof raw.lastText === 'string' ? raw.lastText : '',
        lastAt: typeof raw.lastAt === 'number' ? raw.lastAt : null,
        lastTitles: Array.isArray(raw.lastTitles) ? raw.lastTitles.filter((t): t is string => typeof t === 'string') : [],
      }
    } catch {
      return { ...DEFAULT_STATE, lastRun: {}, lastTitles: [] }
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n', 'utf8')
      renameSync(tmp, this.path)
    } catch (error) {
      this.warn(`播报状态写盘失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 这一档最后播的日期（没播过 = null）。 */
  lastRunDate(slot: string): string | null {
    return this.data.lastRun[slot] ?? null
  }

  markRan(slot: string, dateKey: string): void {
    this.data.lastRun[slot] = dateKey
    this.persist()
  }

  remember(text: string, titles: string[], at: number): void {
    this.data.lastText = text
    this.data.lastTitles = titles.slice(0, 10)
    this.data.lastAt = at
    this.persist()
  }

  get lastText(): string {
    return this.data.lastText
  }

  get lastAt(): number | null {
    return this.data.lastAt
  }

  get lastTitles(): string[] {
    return this.data.lastTitles
  }
}
