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
    if (this.opts.dailyLimit === 0) return { said: false, reason: 'off' }
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
