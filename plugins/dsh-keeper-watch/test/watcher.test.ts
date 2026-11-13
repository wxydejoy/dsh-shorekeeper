import { describe, expect, it } from 'vitest'
import { airAlertText, pm25Grade, upcomingHours, weatherChangeText, wmoCondition } from '../src/weather.ts'
import { createWatcher, type Watcher } from '../src/index.ts'
import { activationAlertText, scanActivationFailures, type ActivationScan } from '../src/gates.ts'
import type { KeeperWatchConfig } from '../src/config.ts'

function at(h: number, m = 0): Date {
  return new Date(2026, 10, 5, h, m, 0)
}

describe('wmoCondition / pm25Grade（对齐 hub weather.py）', () => {
  it('常见天气码', () => {
    expect(wmoCondition(0)).toBe('晴')
    expect(wmoCondition(3)).toBe('多云')
    expect(wmoCondition(61)).toBe('雨')
    expect(wmoCondition(75)).toBe('雪')
    expect(wmoCondition(80)).toBe('阵雨')
    expect(wmoCondition(95)).toBe('雷阵雨')
    expect(wmoCondition(45)).toBe('雾')
    expect(wmoCondition(2)).toBe('少云')
  })
  it('PM2.5 分档', () => {
    expect(pm25Grade(30)).toBe('优')
    expect(pm25Grade(70)).toBe('良')
    expect(pm25Grade(80)).toBe('轻度污染')
    expect(pm25Grade(160)).toBe('重度污染')
  })
  it('空气播报分档说话', () => {
    expect(airAlertText(90)).toContain('轻度污染')
    expect(airAlertText(160)).toContain('口罩')
  })
})

describe('upcomingHours / weatherChangeText（对齐 hub proactive.weather_change_text）', () => {
  const now = at(10)

  it('取未来两小时内的条目', () => {
    const entries = upcomingHours(now, {
      time: ['2026-11-05T09:00', '2026-11-05T11:00', '2026-11-05T13:00'],
      celsius: [20, 18, 16],
      code: [0, 61, 0],
      windKmh: [5, 10, 30],
    })
    expect(entries).toEqual([{ code: 61, celsius: 18, windKmh: 10 }])
  })

  it('只推变化：现在在下雨就不再说有雨', () => {
    const entries = [{ code: 63, celsius: 15, windKmh: 5 }]
    expect(weatherChangeText(now, 14, '雨', entries)).toBeNull()
  })

  it('雨 > 降温 > 大风', () => {
    const rain = [{ code: 61, celsius: 10, windKmh: 50 }]
    expect(weatherChangeText(now, 14, '晴', rain)).toContain('带伞')
    const drop = [{ code: 0, celsius: 8, windKmh: 50 }]
    expect(weatherChangeText(now, 14, '晴', drop)).toContain('降 6 度')
    const wind = [{ code: 0, celsius: 13, windKmh: 45 }]
    expect(weatherChangeText(now, 14, '晴', wind)).toContain('风要大')
  })
})

describe('createWatcher 端到端（假数据驱动）', () => {
  function makeConfig(overrides: Partial<KeeperWatchConfig> = {}): KeeperWatchConfig {
    return {
      enabled: true,
      quietHours: ['23:00', '07:00'],
      dailyLimit: 12,
      hubBaseUrl: 'http://127.0.0.1:17890',
      hubToken: '',
      phoneHost: '',
      phonePort: 5555,
      weatherCity: '上海',
      weatherEnabled: false,
      pm25Threshold: 75,
      cpuTempThresholdC: 85,
      cpuTempSustainedSec: 120,
      memoryPercentThreshold: 92,
      memorySustainedSec: 300,
      sedentaryMinutes: 90,
      watchDeviceIds: [],
      deviceOfflineSustainedSec: 600,
      pcOfflineAlert: false,
      pcOfflineSustainedSec: 600,
      phoneOfflineSustainedSec: 300,
      notifyUrl: 'http://127.0.0.1:47832/notify',
      notifyTokenPath: '/tmp/nonexistent-notify.json',
      activationAlert: true,
      activationLogPath: '',
      tickSec: 60,
      ...overrides,
    }
  }

  interface Harness {
    watcher: Watcher
    sent: string[]
    setSnapshot(s: unknown): void
    setPhone(alive: boolean): void
    setActivation(s: ActivationScan | null): void
  }

  function makeHarness(cfg: Partial<KeeperWatchConfig> = {}): Harness {
    const sent: string[] = []
    let snapshot: unknown = null
    let phone = true
    let activation: ActivationScan | null = null
    const watcher = createWatcher(makeConfig(cfg), {
      fetchSnapshot: async () => snapshot as never,
      phoneAlive: async () => phone,
      notify: { send: async (t) => (sent.push(t), true) },
      fetchHourly: async () => ({ currentCelsius: 14, currentCode: 0, hourly: { time: [], celsius: [], code: [], windKmh: [] } }),
      fetchPm25: async () => 20,
      readActivationFailures: async () => activation,
    })
    return {
      watcher,
      sent,
      setSnapshot: (s) => (snapshot = s),
      setPhone: (a) => (phone = a),
      setActivation: (s) => (activation = s),
    }
  }

  it('PC 过热：持续坏才说，一天一次', async () => {
    const h = makeHarness()
    const t0 = at(10)
    h.setSnapshot({ pc: { online: true, cpu: { temp_celsius: 90 }, memory: { percent: 40 } } })
    await h.watcher.tickOnce(t0)
    await h.watcher.tickOnce(new Date(t0.getTime() + 60_000)) // 才 1 分钟：不说
    expect(h.sent).toHaveLength(0)
    await h.watcher.tickOnce(new Date(t0.getTime() + 121_000)) // 持续 2 分钟：说
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]).toContain('90°')
    await h.watcher.tickOnce(new Date(t0.getTime() + 180_000)) // dup：不再说
    expect(h.sent).toHaveLength(1)
  })

  it('温度降回来：持续计时清零', async () => {
    const h = makeHarness()
    const t0 = at(10)
    h.setSnapshot({ pc: { online: true, cpu: { temp_celsius: 90 }, memory: { percent: 40 } } })
    await h.watcher.tickOnce(t0)
    h.setSnapshot({ pc: { online: true, cpu: { temp_celsius: 60 }, memory: { percent: 40 } } })
    await h.watcher.tickOnce(new Date(t0.getTime() + 90_000)) // 修好：清零
    h.setSnapshot({ pc: { online: true, cpu: { temp_celsius: 90 }, memory: { percent: 40 } } })
    await h.watcher.tickOnce(new Date(t0.getTime() + 100_000)) // 重新计时才 10s：不说
    expect(h.sent).toHaveLength(0)
  })

  it('内存压力：持续 5 分钟才说', async () => {
    const h = makeHarness()
    const t0 = at(10)
    h.setSnapshot({ pc: { online: true, cpu: { temp_celsius: 40 }, memory: { percent: 95 } } })
    await h.watcher.tickOnce(t0)
    await h.watcher.tickOnce(new Date(t0.getTime() + 301_000))
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]).toContain('95%')
  })

  it('设备离线：点名盯梢持续坏才说', async () => {
    const h = makeHarness({ watchDeviceIds: ['lamp'], deviceOfflineSustainedSec: 600 })
    const t0 = at(10)
    h.setSnapshot({ devices: [{ id: 'lamp', online: false }] })
    await h.watcher.tickOnce(t0)
    await h.watcher.tickOnce(new Date(t0.getTime() + 300_000)) // 5 分钟：还不够
    expect(h.sent).toHaveLength(0)
    await h.watcher.tickOnce(new Date(t0.getTime() + 601_000))
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]).toContain('lamp')
  })

  it('手机离线：持续 5 分钟才说', async () => {
    const h = makeHarness()
    const t0 = at(10)
    h.setPhone(false)
    await h.watcher.tickOnce(t0)
    await h.watcher.tickOnce(new Date(t0.getTime() + 60_000))
    expect(h.sent).toHaveLength(0)
    await h.watcher.tickOnce(new Date(t0.getTime() + 301_000))
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]).toContain('屏那边')
  })

  it('免打扰时段：坏着也不说，过了免打扰补说', async () => {
    const h = makeHarness()
    const t0 = at(2) // 凌晨 2 点
    h.setSnapshot({ pc: { online: true, cpu: { temp_celsius: 90 }, memory: { percent: 40 } } })
    await h.watcher.tickOnce(t0)
    await h.watcher.tickOnce(new Date(t0.getTime() + 121_000))
    expect(h.sent).toHaveLength(0)
    await h.watcher.tickOnce(at(8))
    expect(h.sent).toHaveLength(1)
  })

  it('快照取数失败：安静跳过，不炸不瞎猜', async () => {
    let boom = true
    const sent: string[] = []
    const watcher = createWatcher(makeConfig(), {
      fetchSnapshot: async () => {
        if (boom) throw new Error('boom')
        return { pc: { online: true, cpu: { temp_celsius: 90 }, memory: { percent: 40 } } }
      },
      phoneAlive: async () => true,
      notify: { send: async (t) => (sent.push(t), true) },
      fetchHourly: async () => ({ currentCelsius: 14, currentCode: 0, hourly: { time: [], celsius: [], code: [], windKmh: [] } }),
      fetchPm25: async () => 20,
      readActivationFailures: async () => null,
    })
    await watcher.tickOnce(at(10)) // 炸：静默
    expect(sent).toHaveLength(0)
    boom = false
    await watcher.tickOnce(at(10, 1))
    await watcher.tickOnce(new Date(at(10, 1).getTime() + 121_000))
    expect(sent).toHaveLength(1) // 恢复后正常走
  })

  it('改每日配额不会把今天已经说过的事再说一遍', async () => {
    const cfg = makeConfig()
    const sent: string[] = []
    const watcher = createWatcher(cfg, {
      fetchSnapshot: async () => ({ pc: { online: true, cpu: { temp_celsius: 90 }, memory: { percent: 40 } } }),
      phoneAlive: async () => true,
      notify: { send: async (t) => (sent.push(t), true) },
      fetchHourly: async () => ({ currentCelsius: 14, currentCode: 0, hourly: { time: [], celsius: [], code: [], windKmh: [] } }),
      fetchPm25: async () => 20,
      readActivationFailures: async () => null,
    })
    const t0 = at(10)
    await watcher.tickOnce(t0)
    await watcher.tickOnce(new Date(t0.getTime() + 121_000))
    expect(sent).toHaveLength(1)
    cfg.dailyLimit = 20
    await watcher.tickOnce(new Date(t0.getTime() + 180_000))
    expect(sent).toHaveLength(1)
  })

  it('PM2.5：连续坏满 10 分钟才说，5 分钟采样够得着这个窗口', async () => {
    const sent: string[] = []
    const watcher = createWatcher(makeConfig({ weatherEnabled: true }), {
      fetchSnapshot: async () => null,
      phoneAlive: async () => true,
      notify: { send: async (t) => (sent.push(t), true) },
      fetchHourly: async () => ({ currentCelsius: 14, currentCode: 0, hourly: { time: [], celsius: [], code: [], windKmh: [] } }),
      fetchPm25: async () => 120,
      readActivationFailures: async () => null,
    })
    const t0 = at(10)
    await watcher.tickOnce(t0)
    await watcher.tickOnce(new Date(t0.getTime() + 5 * 60_000))
    expect(sent).toHaveLength(0)
    await watcher.tickOnce(new Date(t0.getTime() + 10 * 60_000))
    expect(sent.some((text) => text.includes('PM2.5'))).toBe(true)
  })

  it('久坐：连续使用满 90 分钟才说；空闲满 5 分钟算休息，计时重来', async () => {
    const sent: string[] = []
    let idle = 10
    const watcher = createWatcher(makeConfig(), {
      fetchSnapshot: async () => ({ pc: { online: true, memory: { percent: 40 } }, idle_sec: idle }),
      phoneAlive: async () => true,
      notify: { send: async (t) => (sent.push(t), true) },
      fetchHourly: async () => ({ currentCelsius: 14, currentCode: 0, hourly: { time: [], celsius: [], code: [], windKmh: [] } }),
      fetchPm25: async () => 20,
      readActivationFailures: async () => null,
    })
    const t0 = at(10)
    await watcher.tickOnce(t0)
    await watcher.tickOnce(new Date(t0.getTime() + 89 * 60_000))
    expect(sent).toHaveLength(0)
    await watcher.tickOnce(new Date(t0.getTime() + 90 * 60_000))
    expect(sent).toEqual(['坐了一阵了，起来走走。'])

    idle = 300
    await watcher.tickOnce(new Date(t0.getTime() + 91 * 60_000))
    idle = 10
    await watcher.tickOnce(new Date(t0.getTime() + 92 * 60_000))
    await watcher.tickOnce(new Date(t0.getTime() + 181 * 60_000))
    expect(sent).toHaveLength(1)
  })
describe('激活自检哨兵（watcher 集成）', () => {
  it('失败名单报一次；同拍重扫不重发；重启（bootCount 变）才再报', async () => {
    const h = makeHarness()
    const now = at(10)
    h.setActivation({ bootCount: 1, plugins: ['dsh-keeper-console'] })
    await h.watcher.tickOnce(now)
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]).toContain('dsh-keeper-console')

    await h.watcher.tickOnce(new Date(now.getTime() + 60_000))
    expect(h.sent).toHaveLength(1) // 同一次启动、同一份名单：闭嘴

    // 名单变长（另一个插件也炸了）：AlertGate 一天一次拦住，不重复轰炸
    h.setActivation({ bootCount: 1, plugins: ['dsh-keeper-console', 'dsh-shorekeeper-reading'] })
    await h.watcher.tickOnce(new Date(now.getTime() + 120_000))
    expect(h.sent).toHaveLength(1)

    // 重启后还在坏：新的一天语境之外也允许再报一次？不——gate 一天一次；
    // 这里换到第二天验证重启确实重报
    const tomorrow = at(10)
    tomorrow.setDate(tomorrow.getDate() + 1)
    h.setActivation({ bootCount: 2, plugins: ['dsh-keeper-console', 'dsh-shorekeeper-reading'] })
    await h.watcher.tickOnce(tomorrow)
    expect(h.sent).toHaveLength(2)
    expect(h.sent[1]).toContain('dsh-shorekeeper-reading')
  })

  it('读不到日志（null）→ 静默跳过；修好（空名单）→ 不再提', async () => {
    const h = makeHarness()
    const now = at(10)
    h.setActivation(null)
    await h.watcher.tickOnce(now)
    expect(h.sent).toHaveLength(0)

    h.setActivation({ bootCount: 1, plugins: [] })
    await h.watcher.tickOnce(new Date(now.getTime() + 60_000))
    expect(h.sent).toHaveLength(0)
  })
})
})

describe('scanActivationFailures（err log 本次启动段）', () => {
  const BOOT = 'dsh web: listening on 10.14.14.117 over plain HTTP; restrict this port to a trusted proxy or network\n'

  it('提取本次启动段里激活失败的插件名（去重保序）', () => {
    const log = [
      BOOT,
      'dsh-keeper-console (dsh-keeper-console): Error: cannot get property "webServer" without inject',
      '    at new apply (file:///x/lib/index.js:390:18)',
      'dsh-shorekeeper-reading (dsh-shorekeeper-reading): Error: cannot get property "webServer" without inject',
      'dsh-keeper-console (dsh-keeper-console): Error: cannot get property "webServer" without inject',
    ].join('\n')
    expect(scanActivationFailures(log)).toEqual({ bootCount: 1, plugins: ['dsh-keeper-console', 'dsh-shorekeeper-reading'] })
  })

  it('只看最后一个启动标记之后：旧账不重翻', () => {
    const old = BOOT + 'dsh-keeper-console (dsh-keeper-console): Error: old boot failure\n'
    const log = old + BOOT
    expect(scanActivationFailures(log)).toEqual({ bootCount: 2, plugins: [] })
  })

  it('没有启动标记（轮转截断/标记变了）→ 保守空结果', () => {
    expect(scanActivationFailures('dsh-x (dsh-x): Error: boom\ndsh: warning: 1 entry did not activate')).toEqual({
      bootCount: 0,
      plugins: [],
    })
  })

  it('warning 行在但抓不到插件名 → 兜底占位', () => {
    const log = BOOT + 'dsh: warning: 2 entries did not activate\n'
    expect(scanActivationFailures(log).plugins).toEqual(['（没抓到名字，看日志）'])
  })

  it('文案带名单', () => {
    expect(activationAlertText(['a', 'b'])).toContain('2 个插件')
    expect(activationAlertText(['a', 'b'])).toContain('a、b')
  })
})

