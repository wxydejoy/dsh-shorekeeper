import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackgroundClient, LayoutNotReadyError } from '../src/background-client.ts'
import { createMockBackground } from './mock-background.ts'

let mock: Awaited<ReturnType<typeof createMockBackground>>

beforeEach(async () => {
  mock = await createMockBackground()
})

afterEach(async () => {
  await mock.close()
})

function client(token = 'test-token-1234') {
  return new BackgroundClient({ baseUrl: mock.url, token })
}

describe('BackgroundClient', () => {
  it('登录后列出背景（初始为空）', async () => {
    const index = await client().backgrounds()
    expect(index).toEqual({ current: null, items: [] })
  })

  it('token 错误 → 401 提示口令不对', async () => {
    await expect(client('bad').backgrounds()).rejects.toMatchObject({ status: 401 })
  })

  it('上传即生效，中文文件名走 filename* 编码', async () => {
    const c = client()
    const png = new TextEncoder().encode('png-bytes-测试')
    const index = await c.upload('海边黄昏.png', png, '守岸人')
    expect(index.current).not.toBeNull()
    expect(mock.items[0]?.name).toBe('海边黄昏.png')
    expect(mock.items[0]?.kind).toBe('image')
    expect(mock.items[0]?.owner).toBe('守岸人')
    const raw = await c.backgrounds()
    expect(raw.items[0]?.bytes).toBe(png.byteLength)
  })

  it('视频按扩展名识别 kind', async () => {
    const c = client()
    await c.upload('雨夜.mp4', new TextEncoder().encode('mp4-bytes'))
    expect(mock.items[0]?.kind).toBe('video')
  })

  it('select / clear / remove 全链路', async () => {
    const c = client()
    const first = await c.upload('a.png', new TextEncoder().encode('a'))
    const second = await c.upload('b.png', new TextEncoder().encode('b'))
    expect(second.current).not.toBe(first.current)

    const selected = await c.select(first.current as string)
    expect(selected.current).toBe(first.current)

    const cleared = await c.clear()
    expect(cleared.current).toBeNull()

    const removed = await c.remove(second.current as string)
    expect(removed.items).toHaveLength(1)
    await expect(c.select('nope')).rejects.toMatchObject({ status: 404 })
  })

  it('会话过期自动重登一次', async () => {
    const c = client()
    await c.backgrounds()
    // 模拟服务端清空会话：客户端手里的 session 变成废票
    ;(c as unknown as { session: string | null }).session = 'stale-session'
    const index = await c.backgrounds()
    expect(index.items).toHaveLength(0)
    expect((c as unknown as { session: string | null }).session).not.toBe('stale-session')
  })

  it('layout 就绪时返回现状，未就绪抛 LayoutNotReadyError', async () => {
    const c = client()
    const layout = (await c.layout()) as { canvas?: { width: number } }
    expect(layout.canvas?.width).toBe(1920)

    await mock.close()
    mock = await createMockBackground({ layoutReady: false })
    const offline = new BackgroundClient({ baseUrl: mock.url, token: 'test-token-1234' })
    await expect(offline.layout()).rejects.toBeInstanceOf(LayoutNotReadyError)
  })
})
