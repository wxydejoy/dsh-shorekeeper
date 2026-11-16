import { describe, expect, it } from 'vitest'
import { AlertGate, Sustained, inQuietHours, type GateState } from '../src/gates.ts'

function at(h: number, m = 0, day = 15): Date {
  return new Date(2026, 10, day, h, m, 0)
}

describe('inQuietHours（对齐 hub proactive.in_quiet_hours）', () => {
  const q: [string, string] = ['23:00', '07:00']
  it('跨零点：夜里在、白天不在', async () => {
    expect(inQuietHours(q, at(23, 30))).toBe(true)
    expect(inQuietHours(q, at(3, 0))).toBe(true)
    expect(inQuietHours(q, at(6, 59))).toBe(true)
    expect(inQuietHours(q, at(7, 0))).toBe(false)
    expect(inQuietHours(q, at(12, 0))).toBe(false)
    expect(inQuietHours(q, at(22, 59))).toBe(false)
    expect(inQuietHours(q, at(23, 0))).toBe(true)
  })
  it('start==end = 不设防；空数组同', async () => {
    expect(inQuietHours(['23:00', '23:00'], at(23, 30))).toBe(false)
    expect(inQuietHours([], at(3, 0))).toBe(false)
  })
})

describe('AlertGate 三重闸', () => {
  const quiet: [string, string] = ['23:00', '07:00']

  function makeGate(limit = 5) {
    let spoken: string[] = []
    const gate = new AlertGate({ quietHours: quiet, dailyLimit: limit })
    return {
      gate,
      spoken,
      send: (ok = true) => {
        if (ok) spoken.push('x')
        return ok
      },
    }
  }

  it('正常说：记配额、记「今天说过」', async () => {
    const { gate, send, spoken } = makeGate()
    expect(await gate.alert('pm25', at(10), send)).toEqual({ said: true, reason: 'spoke' })
    expect(spoken).toHaveLength(1)
    expect(gate.stats().saidToday).toBe(1)
  })

  it('同一件事一天一次（dup）', async () => {
    const { gate, send, spoken } = makeGate()
    await gate.alert('pm25', at(10), send)
    expect(await gate.alert('pm25', at(11), send)).toEqual({ said: false, reason: 'dup' })
    expect(spoken).toHaveLength(1)
    // 不同的事还能说
    expect(await gate.alert('memory', at(11), send)).toEqual({ said: true, reason: 'spoke' })
  })

  it('第二天 dup 清零', async () => {
    const { gate, send } = makeGate()
    gate.alert('pm25', at(10, 0, 15), send)
    expect(await gate.alert('pm25', at(10, 0, 16), send)).toEqual({ said: true, reason: 'spoke' })
  })

  it('免打扰拦下不算说过——过了免打扰可以补', async () => {
    const { gate, send, spoken } = makeGate()
    expect(await gate.alert('pm25', at(2), send)).toEqual({ said: false, reason: 'quiet' })
    expect(await gate.alert('pm25', at(8), send)).toEqual({ said: true, reason: 'spoke' })
    expect(spoken).toHaveLength(1)
  })

  it('配额用完不说，第二天归零', async () => {
    const { gate, send } = makeGate(1)
    expect((await gate.alert('a', at(9), send)).said).toBe(true)
    expect(await gate.alert('b', at(9, 30), send)).toEqual({ said: false, reason: 'quota' })
    expect((await gate.alert('c', at(10, 0, 16), send)).said).toBe(true)
  })

  it('send 失败不算说过（桥没通：下轮再试）', async () => {
    const { gate, send, spoken } = makeGate()
    expect(await gate.alert('pm25', at(10), () => false)).toEqual({ said: false, reason: 'off' })
    expect(await gate.alert('pm25', at(10, 1), send)).toEqual({ said: true, reason: 'spoke' })
    expect(spoken).toHaveLength(1)
  })
})

describe('AlertGate 落盘（2026-11-16 重复提醒事故）', () => {
  const quiet: [string, string] = ['23:00', '07:00']

  /** 内存版 GateStore：模拟同一个状态文件被下一个进程读回 */
  function memStore() {
    let state: GateState | null = null
    return {
      load: () => state,
      save: (next: GateState) => {
        state = JSON.parse(JSON.stringify(next)) as GateState
      },
      peek: () => state,
    }
  }

  it('重启（新建 gate）后同一件事不再说第二遍', async () => {
    const store = memStore()
    const first = new AlertGate({ quietHours: quiet, dailyLimit: 12 }, store)
    expect((await first.alert('pm25', at(21, 0), () => true)).said).toBe(true)

    // dsh 重启：新进程、新 gate，从同一个文件读回
    const second = new AlertGate({ quietHours: quiet, dailyLimit: 12 }, store)
    expect(await second.alert('pm25', at(21, 11), () => true)).toEqual({ said: false, reason: 'dup' })
    expect(second.stats().saidToday).toBe(1)
  })

  it('配额也一起恢复：重启不把今天的条数清零', async () => {
    const store = memStore()
    const first = new AlertGate({ quietHours: quiet, dailyLimit: 2 }, store)
    await first.alert('a', at(9), () => true)
    await first.alert('b', at(10), () => true)

    const second = new AlertGate({ quietHours: quiet, dailyLimit: 2 }, store)
    expect(await second.alert('c', at(11), () => true)).toEqual({ said: false, reason: 'quota' })
  })

  it('跨天后 read 回来的状态作废：昨天说过的不算今天', async () => {
    const store = memStore()
    const first = new AlertGate({ quietHours: quiet, dailyLimit: 12 }, store)
    await first.alert('pm25', at(21, 0, 15), () => true)

    const second = new AlertGate({ quietHours: quiet, dailyLimit: 12 }, store)
    expect((await second.alert('pm25', at(9, 0, 16), () => true)).said).toBe(true)
    expect(second.stats().saidToday).toBe(1)
  })

  it('store 坏了（load 抛错）也照常工作，只是不记忆', async () => {
    const broken = {
      load: () => {
        throw new Error('disk gone')
      },
      save: () => {
        throw new Error('disk gone')
      },
    }
    const gate = new AlertGate({ quietHours: quiet, dailyLimit: 12 }, broken)
    expect((await gate.alert('pm25', at(10), () => true)).said).toBe(true)
    expect(await gate.alert('pm25', at(10, 5), () => true)).toEqual({ said: false, reason: 'dup' })
  })
})

describe('Sustained（对齐 hub proactive.Sustained）', () => {
  it('坏着计时，够秒才 True；修好清零', async () => {
    const s = new Sustained()
    const t0 = at(10).getTime()
    expect(s.check('k', true, t0, 120)).toBe(false)
    expect(s.check('k', true, t0 + 119_000, 120)).toBe(false)
    expect(s.check('k', true, t0 + 120_000, 120)).toBe(true)
    expect(s.check('k', false, t0 + 121_000, 120)).toBe(false)
    expect(s.check('k', true, t0 + 122_000, 120)).toBe(false) // 重新计时
    expect(s.check('k', true, t0 + 242_000, 120)).toBe(true)
  })
})
