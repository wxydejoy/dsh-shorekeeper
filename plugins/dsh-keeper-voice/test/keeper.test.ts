import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KeeperClient, KeeperRequestError } from '../src/keeper-client.ts'
import { createKeeperTools } from '../src/tools.ts'
import { createMockKeeper, type MockKeeper } from './mock-keeper.ts'

let mock: MockKeeper

beforeEach(async () => {
  mock = await createMockKeeper()
})

afterEach(async () => {
  await mock.close()
})

function client() {
  return new KeeperClient({ baseUrl: mock.url })
}

function tools() {
  return createKeeperTools({ client: client(), config: { speed: 1.0, sampleText: '岸边的灯给你留着。' } })
}

function byName(name: string) {
  const tool = tools().find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`工具不存在：${name}`)
  return tool
}

describe('KeeperClient', () => {
  it('health 返回就绪状态', async () => {
    const health = await client().health()
    expect(health).toMatchObject({ ok: true, service: 'helm-companion-tts', ready: true, clone: true })
  })

  it('speech 拿到 wav 字节与首包延迟', async () => {
    const result = await client().speech({ input: '晚上好。', speed: 0.9 })
    expect(result.audio.byteLength).toBe(244) // 44 头 + 200 数据
    expect(result.contentType).toBe('audio/wav')
    expect(result.firstAudioMs).toBe(123)
    expect(mock.speechRequests[0]).toMatchObject({ input: '晚上好。', speed: 0.9, format: 'wav' })
  })

  it('speech 空文本 → 400 归一化', async () => {
    await expect(client().speech({ input: '  ' })).rejects.toMatchObject({
      name: 'KeeperRequestError',
      status: 400,
      code: 'bad_request',
    })
  })

  it('stop 幂等可达', async () => {
    await client().stop()
    expect(mock.stopped).toBe(1)
  })

  it('服务不在 → network 错误', async () => {
    const dead = new KeeperClient({ baseUrl: 'http://127.0.0.1:1' })
    await expect(dead.health()).rejects.toMatchObject({ code: 'network' })
  })
})

describe('keeper 工具面', () => {
  it('keeper.status 报告就绪与克隆态', async () => {
    const result = (await byName('keeper.status').execute({}, {} as never)) as { summary: string; ready: boolean }
    expect(result.ready).toBe(true)
    expect(result.summary).toContain('克隆=开')
  })

  it('keeper.voice_test 缺省文本走插件设置', async () => {
    const result = (await byName('keeper.voice_test').execute({}, {} as never)) as { ok: boolean; summary: string }
    expect(result.ok).toBe(true)
    expect(mock.speechRequests[0]?.input).toBe('岸边的灯给你留着。')
    expect(result.summary).toContain('首包 123ms')
  })

  it('keeper.voice_test 未就绪 → 优雅降级', async () => {
    mock.ready = false
    const result = (await byName('keeper.voice_test').execute({ text: '在吗' }, {} as never)) as {
      ok: false
      degraded: string
    }
    expect(result.ok).toBe(false)
    expect(result.degraded).toContain('还没就绪')
  })

  it('keeper.voice_test 被打断 → 降级说明', async () => {
    mock.interrupt = true
    const result = (await byName('keeper.voice_test').execute({ text: '在吗' }, {} as never)) as {
      ok: false
      degraded: string
    }
    expect(result.degraded).toContain('打断')
  })

  it('keeper.stop 打通打断', async () => {
    const result = (await byName('keeper.stop').execute({}, {} as never)) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(mock.stopped).toBe(1)
  })

  it('服务不在 → 工具层降级不抛错', async () => {
    await mock.close()
    const dead = createKeeperTools({
      client: new KeeperClient({ baseUrl: mock.url }),
      config: { speed: 1.0, sampleText: 'x' },
    })
    const result = (await dead.find((t) => t.name === 'keeper.status')?.execute({}, {} as never)) as {
      ok: false
      degraded: string
    }
    expect(result.ok).toBe(false)
    expect(result.degraded).toContain('不可达')
  })
})

void KeeperRequestError
