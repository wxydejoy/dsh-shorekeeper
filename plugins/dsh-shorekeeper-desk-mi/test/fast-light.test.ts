import { describe, expect, it } from 'vitest'
import { lightReply, matchLightCommand } from '../src/fast-light.ts'

describe('matchLightCommand', () => {
  it('开灯带', () => {
    expect(matchLightCommand('把灯带打开')).toEqual({ name: '灯带', action: 'on' })
  })

  it('关台灯', () => {
    expect(matchLightCommand('关掉台灯')).toEqual({ name: '台灯', action: 'off' })
  })

  it('调到数字', () => {
    expect(matchLightCommand('灯带调到 60')).toEqual({ name: '灯带', action: 'brightness', brightness: 60 })
  })

  it('口误折回灯带', () => {
    expect(matchLightCommand('打开当代')).toEqual({ name: '灯带', action: 'on' })
    expect(matchLightCommand('灯袋关掉')).toEqual({ name: '灯带', action: 'off' })
  })

  it('口误折回台灯', () => {
    expect(matchLightCommand('太灯关掉')).toEqual({ name: '台灯', action: 'off' })
  })

  it('挂灯亮一点', () => {
    expect(matchLightCommand('挂灯亮一点')).toEqual({ name: '挂灯', action: 'brightness', brightness: 80, phrase: '亮一点' })
  })

  it('暗一点', () => {
    expect(matchLightCommand('把台灯调暗')).toEqual({ name: '台灯', action: 'brightness', brightness: 35, phrase: '暗一点' })
  })

  it('客套话不挡命令', () => {
    expect(matchLightCommand('帮我把灯带打开一下')).toEqual({ name: '灯带', action: 'on' })
  })

  it('只提灯、没点名，不截', () => {
    expect(matchLightCommand('把灯打开')).toBeNull()
  })

  it('只提设备、没有动作，不截', () => {
    expect(matchLightCommand('记得灯带的事')).toBeNull()
    expect(matchLightCommand('台灯坏了')).toBeNull()
  })

  it('在问状态，不截', () => {
    expect(matchLightCommand('灯带开着吗')).toBeNull()
  })

  it('两盏灯一起说，不截', () => {
    expect(matchLightCommand('台灯和灯带都打开')).toBeNull()
  })

  it('后面还有别的事，不截', () => {
    expect(matchLightCommand('灯带打开，今天天气怎么样')).toBeNull()
  })

  it('空话不截', () => {
    expect(matchLightCommand('')).toBeNull()
    expect(matchLightCommand('   ')).toBeNull()
  })
})

describe('lightReply', () => {
  it('成功是短句', () => {
    expect(lightReply({ name: '灯带', action: 'on' }, true)).toBe('好。灯带给你留亮了。')
    expect(lightReply({ name: '台灯', action: 'off' }, true)).toBe('好。台灯关掉了。')
    expect(lightReply({ name: '灯带', action: 'brightness', brightness: 60 }, true)).toBe('好。灯带调到 60。')
    expect(lightReply({ name: '挂灯', action: 'brightness', brightness: 80, phrase: '亮一点' }, true)).toBe('好。挂灯亮一点。')
  })

  it('失败不假装动过', () => {
    expect(lightReply({ name: '灯带', action: 'on' }, false)).toBe('这次没动成。')
  })
})
