/** 三重闸 + 持续坏判定 —— 从 dock-hub proactive.py 移植（TS 版）。
 *
 * 异动提醒最容易变成噪音源，所以每个判断都用假时钟可验：
 * 1. 免打扰时段（允许跨零点）一律不说；
 * 2. 每日配额用完不说，第二天归零；
 * 3. 同一件事（key）一天最多说一次——被闸拦下时不记「说过」，
 *    缓一缓（比如过了免打扰）还可以再说。
 * 4. Sustained：某件事要连续坏多久才值得开口，修好清零。
 */

export interface GateDecision {
  said: boolean
  reason: 'off' | 'dup' | 'quiet' | 'quota' | 'spoke'
}

function minutesOf(clock: string): number {
  const [h, m] = clock.split(':')
  return Number(h) * 60 + Number(m)
}

/** 免打扰时段，允许跨零点（23:00–07:00 就是跨的）。start==end = 不设防。 */
export function inQuietHours(clock: readonly [string, string] | [], now: Date): boolean {
  if (!clock || clock.length < 2) return false
  const start = minutesOf(clock[0]!)
  const end = minutesOf(clock[1]!)
  if (start === end) return false
  const current = now.getHours() * 60 + now.getMinutes()
  if (start < end) return current >= start && current < end
  return current >= start || current < end
}

/** 连续坐着多久。键鼠空闲满 5 分钟算休息过，计时清零。
 *  idle 为 null 表示这一拍不知道：不开始、不清零、不提醒。 */
export class SedentaryWatch {
  static readonly BREAK_SEC = 300
  private since: number | null = null

  tick(idle: number | null, nowMs: number, limitMinutes: number): boolean {
    if (limitMinutes <= 0) return false
    if (idle === null) return false
    if (idle >= SedentaryWatch.BREAK_SEC) {
      this.since = null
      return false
    }
    if (this.since === null) {
      this.since = nowMs
      return false
    }
    return nowMs - this.since >= limitMinutes * 60_000
  }

  reset(): void {
    this.since = null
  }
}

/** 某件事要连续坏多久才值得开口。坏着计时，修好清零。 */
export class Sustained {
  private first = new Map<string, number>()

  check(key: string, bad: boolean, now: number, seconds: number): boolean {
    if (!bad) {
      this.first.delete(key)
      return false
    }
    const existing = this.first.get(key)
    const at = existing ?? now
    if (existing === undefined) this.first.set(key, now)
    return now - at >= seconds * 1000
  }

  clear(key: string): void {
    this.first.delete(key)
  }

  /** 全清（总开关关闭时用：重开后所有事从零计时）。 */
  clearAll(): void {
    this.first.clear()
  }
}

/** 异动闸：免打扰 / 配额 / 同一件事一天一次。 */
export interface AlertGateOpts {
  quietHours: readonly [string, string] | []
  dailyLimit: number
}

export class AlertGate {
  private opts: AlertGateOpts
  private day = ''
  private count = 0
  private alerted = new Map<string, string>()

  // 注：不用 constructor 参数属性——dsh 以 strip-only 模式直载 .ts，不支持该语法
  constructor(opts: AlertGateOpts) {
    this.opts = opts
  }

  configure(opts: { quietHours?: readonly [string, string] | []; dailyLimit?: number }): void {
    if (opts.quietHours !== undefined) this.opts.quietHours = opts.quietHours
    if (opts.dailyLimit !== undefined) this.opts.dailyLimit = opts.dailyLimit
    // 配额与「今天说过没有」不跟着配置重建（同 proactive.py 的规矩）
    this.resetIfNewDay(new Date())
  }

  /** key = 这件事的名字（如 'pm25' / 'offline:lamp'）。send 成功才算说过。 */
  async alert(key: string, now: Date, send: () => boolean | Promise<boolean>): Promise<GateDecision> {
    // 0 = 今天不再提醒。用 quota 而不是 off：off 在 watcher 里表示桥没通，会进重试冷静期。
    if (this.opts.dailyLimit === 0) return { said: false, reason: 'quota' }
    this.resetIfNewDay(now)
    const today = dayKey(now)
    if (this.alerted.get(key) === today) return { said: false, reason: 'dup' }
    if (inQuietHours(this.opts.quietHours, now)) return { said: false, reason: 'quiet' }
    if (this.opts.dailyLimit > 0 && this.count >= this.opts.dailyLimit) {
      return { said: false, reason: 'quota' }
    }
    if (!(await send())) return { said: false, reason: 'off' } // 桥没通：不算说过，下轮再试
    this.alerted.set(key, today)
    this.count += 1
    return { said: true, reason: 'spoke' }
  }

  stats(): { saidToday: number; dailyLimit: number } {
    return { saidToday: this.count, dailyLimit: this.opts.dailyLimit }
  }

  private resetIfNewDay(now: Date): void {
    const today = dayKey(now)
    if (this.day === today) return
    this.day = today
    this.count = 0
  }
}

function dayKey(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 插件激活自检（2026-11-13 面板 405 事故：插件没起来只有 err log 一行警告，
 *  面板上表现为 405/空白，没人盯日志就发现不了）。
 *
 * dsh err log 是跨重启追加的，每次启动打一行 `dsh web: listening …`；
 * 激活失败的插件紧随其后打 `<id> (<name>): Error: …`。只看最后一个
 * marker 之后的段落 = 只看本次启动，旧账不重翻。找不到 marker（轮转截断/
 * 标记行变了）时保守返回空，宁可漏报不误报。
 */
export interface ActivationScan {
  /** 日志里启动标记出现的次数（重启一次 +1；watcher 据此识别「新的一次启动」） */
  bootCount: number
  /** 本次启动里激活失败的插件名（去重，按出现序） */
  plugins: string[]
}

const BOOT_MARKER = 'dsh web: listening'
const PLUGIN_ERROR_LINE = /^\S+ \(([^)]+)\): Error/m

export function scanActivationFailures(log: string): ActivationScan {
  const bootCount = log.split(BOOT_MARKER).length - 1
  if (bootCount === 0) return { bootCount: 0, plugins: [] }
  const current = log.slice(log.lastIndexOf(BOOT_MARKER))
  const plugins: string[] = []
  for (const line of current.split('\n')) {
    const m = PLUGIN_ERROR_LINE.exec(line)
    const name = m?.[1]
    if (name && !plugins.includes(name)) plugins.push(name)
  }
  if (plugins.length === 0 && /did not activate/.test(current)) {
    plugins.push('（没抓到名字，看日志）')
  }
  return { bootCount, plugins }
}

/** 激活失败提醒文案（守岸人口吻，报名单不说教）。 */
export function activationAlertText(plugins: string[]): string {
  return `有 ${plugins.length} 个插件这次没起来：${plugins.join('、')}。它们的功能这一轮是缺的，重启一下 :3090，或者叫我看日志。`
}
