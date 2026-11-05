import { describe, expect, it } from 'vitest'
import { applyDeskMiOverrides, type DeskMiOverrides } from '../src/overrides.ts'

const base = { controlEnabled: false, controlPerMinute: 10 }

describe('applyDeskMiOverrides（面板覆盖叠加）', () => {
  it('空覆盖 = 原样回落基线（写入闸门红线默认不变）', () => {
    expect(applyDeskMiOverrides(base, {})).toEqual({ controlEnabled: false, controlPerMinute: 10 })
  })

  it('controlEnabled 显式开闸生效', () => {
    expect(applyDeskMiOverrides(base, { controlEnabled: true }).controlEnabled).toBe(true)
  })

  it('controlPerMinute 覆盖并取整；非法值回落基线', () => {
    expect(applyDeskMiOverrides(base, { controlPerMinute: 3.9 }).controlPerMinute).toBe(3)
    const dirty = { controlPerMinute: -1 } as unknown as DeskMiOverrides
    expect(applyDeskMiOverrides(base, dirty).controlPerMinute).toBe(10)
  })
})
