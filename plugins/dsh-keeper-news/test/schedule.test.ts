import { describe, expect, it } from 'vitest'
import { inQuietHours, localDateKey, parseClock, slotDue } from '../src/schedule.ts'

const at = (h: number, m: number, day = 18): Date => new Date(2026, 10, day, h, m)

describe('slotDue', () => {
  it('正好到点、今天没播过 → 播', () => {
    expect(slotDue('08:30', at(8, 30), null, 90)).toBe(true)
  })

  it('没到点不播', () => {
    expect(slotDue('08:30', at(8, 29), null, 90)).toBe(false)
  })

  it('今天已经播过 → 不播（重启也不重复）', () => {
    expect(slotDue('08:30', at(8, 40), '2026-11-18', 90)).toBe(false)
  })

  it('昨天播过 → 今天照播', () => {
    expect(slotDue('08:30', at(8, 40), '2026-11-17', 90)).toBe(true)
  })

  it('补播窗口内还播，超出就不翻旧账', () => {
    expect(slotDue('08:30', at(9, 59), null, 90)).toBe(true)
    expect(slotDue('08:30', at(10, 1), null, 90)).toBe(false)
    // 窗口 0 = 只在那一分钟内播
    expect(slotDue('08:30', at(8, 31), null, 0)).toBe(false)
  })

  it('时间点格式不对一律不播（宁可静默，不要按 00:00 炸一整夜）', () => {
    for (const slot of ['', '8:3', '25:00', 'abc', '08:60']) {
      expect(slotDue(slot, at(12, 0), null, 90)).toBe(false)
    }
  })
})

describe('inQuietHours', () => {
  it('跨零点区间', () => {
    expect(inQuietHours(['23:00', '07:00'], at(23, 30))).toBe(true)
    expect(inQuietHours(['23:00', '07:00'], at(3, 0))).toBe(true)
    expect(inQuietHours(['23:00', '07:00'], at(7, 0))).toBe(false)
    expect(inQuietHours(['23:00', '07:00'], at(8, 30))).toBe(false)
  })

  it('同日区间与不设防', () => {
    expect(inQuietHours(['12:00', '14:00'], at(13, 0))).toBe(true)
    expect(inQuietHours(['12:00', '14:00'], at(15, 0))).toBe(false)
    expect(inQuietHours([], at(3, 0))).toBe(false)
    expect(inQuietHours(['09:00', '09:00'], at(9, 0))).toBe(false)
  })
})

describe('localDateKey / parseClock', () => {
  it('本地日期键（不是 UTC，晚八点后不串天）', () => {
    expect(localDateKey(at(23, 30))).toBe('2026-11-18')
    expect(localDateKey(at(0, 5))).toBe('2026-11-18')
  })

  it('parseClock 边界', () => {
    expect(parseClock('00:00')).toBe(0)
    expect(parseClock('23:59')).toBe(1439)
    expect(parseClock('7:05')).toBe(425)
    expect(parseClock('07:5')).toBeNull()
  })
})
