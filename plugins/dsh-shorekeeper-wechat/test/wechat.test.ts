import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BridgeClient } from '../src/bridge-client.ts'
import { createWechatTools } from '../src/tools.ts'
import { createMockBridge, BRIDGE_TOKEN, type MockBridge } from './mock-bridge.ts'
import type { WechatConfig } from '../src/config.ts'

let mock: MockBridge

beforeEach(async () => {
  mock = await createMockBridge()
})

afterEach(async () => {
  await mock.close()
})

function config(overrides: Partial<WechatConfig> = {}): WechatConfig {
  return {
    bridgeBaseUrl: mock.url,
    bridgeToken: BRIDGE_TOKEN,
    maskNames: true,
    sendEnabled: false,
    sendWhitelist: [],
    ...overrides,
  }
}

function tools(overrides: Partial<WechatConfig> = {}) {
  return createWechatTools({
    bridge: new BridgeClient({ baseUrl: mock.url, token: BRIDGE_TOKEN }),
    config: config(overrides),
  })
}

function byName(name: string, overrides: Partial<WechatConfig> = {}) {
  const tool = tools(overrides).find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`工具不存在：${name}`)
  return tool
}

describe('wechat.digest', () => {
  it('输出分组摘要，人名默认脱敏', async () => {
    const result = (await byName('wechat.digest').execute({}, {} as never)) as {
      ok: boolean
      masked: boolean
      groups: { contact: string }[]
      summary: string
    }
    expect(result.ok).toBe(true)
    expect(result.masked).toBe(true)
    expect(result.groups[0]?.contact).toMatch(/^联系人-[0-9a-f]{4}$/)
    expect(result.groups[0]?.contact).not.toContain('妈妈')
    expect(result.summary).toContain('2 个会话')
  })

  it('关掉脱敏出真名', async () => {
    const result = (await byName('wechat.digest', { maskNames: false }).execute({}, {} as never)) as {
      groups: { contact: string }[]
    }
    expect(result.groups[0]?.contact).toBe('妈妈')
  })

  it('桥断了 → 优雅降级', async () => {
    await mock.close()
    const result = (await byName('wechat.digest').execute({}, {} as never)) as { ok: false; degraded: string }
    expect(result.ok).toBe(false)
    expect(result.degraded).toContain('不可达')
  })
})

describe('wechat.read', () => {
  it('代读最近 N 条并脱敏', async () => {
    const result = (await byName('wechat.read').execute({ contactId: 'wxid_mom', limit: 2 }, {} as never)) as {
      ok: boolean
      messages: { sender: string; text: string }[]
      summary: string
    }
    expect(result.ok).toBe(true)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]?.text).toContain('这周末回来吗')
    expect(result.messages[0]?.sender).not.toContain('妈妈')
  })

  it('红线：验证码/转账类只提示不代读全文', async () => {
    const result = (await byName('wechat.read').execute({ contactId: 'wxid_bank', limit: 5 }, {} as never)) as {
      messages: { text: string; hidden?: boolean }[]
      summary: string
    }
    expect(result.messages[0]?.hidden).toBe(true)
    expect(result.messages[0]?.text).toContain('已隐藏全文')
    expect(result.messages[0]?.text).not.toContain('482913')
    expect(result.messages[1]?.text).toContain('已隐藏全文')
    expect(result.summary).toContain('2 条涉验证码/转账')
  })
})

describe('wechat.send', () => {
  it('总闸默认关：直接拒绝', async () => {
    const result = (await byName('wechat.send').execute(
      { contactId: 'wxid_mom', contactName: '妈妈', text: '晚饭回家吃' },
      {} as never,
    )) as { ok: false; degraded: string }
    expect(result.ok).toBe(false)
    expect(result.degraded).toContain('默认只读不发')
    expect(mock.sent).toHaveLength(0)
  })

  it('白名单外硬拒', async () => {
    const result = (await byName('wechat.send', { sendEnabled: true, sendWhitelist: ['妈妈'] }).execute(
      { contactId: 'wxid_stranger', contactName: '路人甲', text: '你好' },
      {} as never,
    )) as { ok: false; degraded: string }
    expect(result.degraded).toContain('不在白名单')
    expect(mock.sent).toHaveLength(0)
  })

  it('白名单内 + 总闸开 → 桥收到', async () => {
    const result = (await byName('wechat.send', { sendEnabled: true, sendWhitelist: ['妈妈'] }).execute(
      { contactId: 'wxid_mom', contactName: '妈妈', text: '晚饭回家吃' },
      {} as never,
    )) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(mock.sent).toEqual([{ contactId: 'wxid_mom', text: '晚饭回家吃' }])
  })

  it('拟发内容触发红线 → 不代发', async () => {
    const result = (await byName('wechat.send', { sendEnabled: true, sendWhitelist: ['妈妈'] }).execute(
      { contactId: 'wxid_mom', contactName: '妈妈', text: '给你转账 500' },
      {} as never,
    )) as { ok: false; degraded: string }
    expect(result.degraded).toContain('红线')
    expect(mock.sent).toHaveLength(0)
  })
})
