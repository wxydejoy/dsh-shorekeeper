import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HubClient, HubRequestError } from '../src/hub-client.ts'
import { createMockHub, MOCK_TOKEN, type MockHub } from './mock-hub.ts'

let hub: MockHub

beforeEach(async () => {
  hub = await createMockHub()
})

afterEach(async () => {
  await hub.close()
})

describe('HubClient', () => {
  it('health 免鉴权，返回 dock-hub 标识', async () => {
    const client = new HubClient({ baseUrl: hub.url, token: 'wrong' })
    const health = await client.health()
    expect(health).toMatchObject({ ok: true, service: 'dock-hub', protocol: 1 })
  })

  it('snapshot 带 Bearer 鉴权，返回 seq 与状态', async () => {
    const client = new HubClient({ baseUrl: hub.url, token: MOCK_TOKEN })
    const snap = await client.snapshot()
    expect(snap.seq).toBe(41)
    expect(snap.temperature?.celsius).toBe(26.4)
  })

  it('token 错误 → 401 归一化为 HubRequestError', async () => {
    const client = new HubClient({ baseUrl: hub.url, token: 'nope' })
    await expect(client.snapshot()).rejects.toMatchObject({
      name: 'HubRequestError',
      status: 401,
      code: 'unauthorized',
    })
  })

  it('media 命令往返并更新 snapshot.media', async () => {
    const client = new HubClient({ baseUrl: hub.url, token: MOCK_TOKEN })
    const media = await client.media('toggle')
    expect(media.playing).toBe(true)
    expect(hub.state.commands[0]).toEqual({ id: 'media', body: { media: 'toggle' } })
    const after = await client.snapshot()
    expect(after.media?.playing).toBe(true)
  })

  it('announce 空文本 → 400 bad_request', async () => {
    const client = new HubClient({ baseUrl: hub.url, token: MOCK_TOKEN })
    await expect(client.announce('  ')).rejects.toMatchObject({ status: 400, code: 'bad_request' })
  })

  it('Hub 不可达 → network 错误', async () => {
    const client = new HubClient({ baseUrl: 'http://127.0.0.1:1', token: MOCK_TOKEN })
    await expect(client.snapshot()).rejects.toMatchObject({ code: 'network' })
  })

  it('长轮询：seq 变化立刻返回', async () => {
    const client = new HubClient({ baseUrl: hub.url, token: MOCK_TOKEN })
    const pending = client.snapshot({ since: 41, wait: 25 })
    setTimeout(() => hub.touch(), 150)
    const snap = await pending
    expect(snap.seq).toBeGreaterThan(41)
  })

  it('长轮询：无变化时按 wait 超时返回（正常情况）', async () => {
    const client = new HubClient({ baseUrl: hub.url, token: MOCK_TOKEN })
    const started = Date.now()
    const snap = await client.snapshot({ since: 41, wait: 1 })
    expect(Date.now() - started).toBeGreaterThanOrEqual(900)
    expect(snap.seq).toBe(41)
  })
})
