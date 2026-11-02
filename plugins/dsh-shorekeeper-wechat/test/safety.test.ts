import { describe, expect, it } from 'vitest'
import { isWhitelisted, maskName, scanSensitive } from '../src/safety.ts'

describe('safety', () => {
  it('maskName 同名同别名，不泄露真名', () => {
    const first = maskName('妈妈')
    expect(maskName('妈妈')).toBe(first)
    expect(first).not.toContain('妈')
    expect(first).toMatch(/^联系人-[0-9a-f]{4}$/)
    expect(maskName('')).toBe('未知联系人')
  })

  it('scanSensitive：验证码（词+数字）命中 otp', () => {
    expect(scanSensitive('你的验证码是 482913，10 分钟内有效')).toMatchObject({ kind: 'otp' })
    expect(scanSensitive('verification code: 482913')).toMatchObject({ kind: 'otp' })
  })

  it('scanSensitive：验证码词但无数字不误伤', () => {
    expect(scanSensitive('验证码还没发来吗')).toMatchObject({ kind: 'normal' })
  })

  it('scanSensitive：转账/红包类命中 payment', () => {
    expect(scanSensitive('给你转了 500，收一下')).toMatchObject({ kind: 'payment' })
    expect(scanSensitive('发个红包奖励一下')).toMatchObject({ kind: 'payment' })
  })

  it('scanSensitive：普通消息放行', () => {
    expect(scanSensitive('晚上一起吃饭吗')).toMatchObject({ kind: 'normal' })
  })

  it('isWhitelisted：id 或名字精确命中；空名单全拒', () => {
    const list = ['wxid_abc', '妈妈']
    expect(isWhitelisted('wxid_abc', '备注', list)).toBe(true)
    expect(isWhitelisted('wxid_other', '妈妈', list)).toBe(true)
    expect(isWhitelisted('wxid_other', '妈妈 ', list)).toBe(true) // 两端空白容忍
    expect(isWhitelisted('wxid_other', '路人甲', list)).toBe(false)
    expect(isWhitelisted('wxid_abc', '备注', [])).toBe(false)
  })
})
