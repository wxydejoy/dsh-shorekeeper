import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GatewayClient } from '../src/gateway.ts'
import { createMockHub, MOCK_TOKEN, type MockHub } from './mock-hub.ts'

let hub: MockHub

beforeEach(async () => {
  hub = await createMockHub()
})

afterEach(async () => {
  await hub.close()
})

function gateway() {
  return new GatewayClient({ baseUrl: hub.url, token: MOCK_TOKEN })
}

describe('GatewayClient（协议增补提案）', () => {
  it('推字幕后 snapshot 带出 caption（含去重时间戳），并递增 seq', async () => {
    await gateway().caption('漂泊者，晚上好。')
    expect(hub.state.caption?.text).toBe('漂泊者，晚上好。')
    expect(hub.state.seq).toBeGreaterThan(41)
  })

  it('清字幕', async () => {
    const g = gateway()
    await g.caption('一句话')
    await g.clearCaption()
    expect(hub.state.caption).toBeNull()
  })

  it('caption 空请求 → 400', async () => {
    await expect(gateway().caption('')).rejects.toMatchObject({ status: 400 })
  })

  it('写入布局：rev 由服务端递增', async () => {
    await gateway().setPhoneLayout({ rev: 0, modules: { Weather: { x: 0.6, y: 0.1, w: 0.3, h: 0.3, visible: false } } })
    const phone = hub.state.snapshot.phone as { layout?: { rev?: number } } | undefined
    expect(phone?.layout?.rev).toBe(1)
  })

  it('熄屏路由就位', async () => {
    expect(await gateway().lock()).toEqual({ ok: true })
    expect(hub.state.locked).toBe(true)
  })

  it('网关没实现提案路由时 → 404（工具层据此优雅降级）', async () => {
    await hub.close()
    const { createServer } = await import('node:http')
    const bare = createServer((_request, response) => {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'not_found', message: '未知接口' } }))
    })
    await new Promise<void>((done) => bare.listen(0, '127.0.0.1', done))
    const address = bare.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const client = new GatewayClient({ baseUrl: `http://127.0.0.1:${port}`, token: MOCK_TOKEN })
    await expect(client.caption('hi')).rejects.toMatchObject({ status: 404, code: 'not_found' })
    await new Promise<void>((done) => bare.close(() => done()))
  })
})
