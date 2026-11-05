import { describe, expect, it } from 'vitest'
import { applyWatchOverrides, type WatchOverrides } from '../src/overrides.ts'

const base = { enabled: true, quietHours: ['23:00', '07:00'] as [string, string], dailyLimit: 12 }

describe('applyWatchOverrides（面板覆盖叠加）', () => {
  it('空覆盖 = 原样回落基线', () => {
    const out = applyWatchOverrides(base, {})
    expect(out).toEqual({ enabled: true, quietHours: ['23:00', '07:00'], dailyLimit: 12 })
  })

  it('enabled 显式 false 生效（此前 Config.enabled 是死字段，现在 tick 真消费）', () => {
    const out = applyWatchOverrides(base, { enabled: false })
    expect(out.enabled).toBe(false)
  })

  it('quietEnabled=false 清空免打扰时段（全天可说）；缺省维持基线', () => {
    expect(applyWatchOverrides(base, { quietEnabled: false }).quietHours).toEqual([])
    expect(applyWatchOverrides(base, { quietEnabled: true }).quietHours).toEqual(['23:00', '07:00'])
    expect(applyWatchOverrides(base, {}).quietHours).toEqual(['23:00', '07:00'])
  })

  it('dailyLimit 覆盖基线并取整', () => {
    expect(applyWatchOverrides(base, { dailyLimit: 3.9 }).dailyLimit).toBe(3)
  })

  it('非法/缺字段不毒化配置', () => {
    const dirty = { enabled: undefined, dailyLimit: -5 } as unknown as WatchOverrides
    const out = applyWatchOverrides(base, dirty)
    expect(out.enabled).toBe(true)
    expect(out.dailyLimit).toBe(12)
  })
})
