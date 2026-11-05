import { describe, expect, it, vi } from 'vitest'
import { TokenBucketLimiter } from '../src/limiter.ts'
import { createDeskMiTools } from '../src/tools.ts'
import type { MiBridge } from '../src/bridge.ts'
import type { DeskMiConfig } from '../src/config.ts'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

/** execute 的第二参（ToolRunContext）在本插件实现里不使用，测试传 null 即可。 */
const exec = null as unknown as ToolRunContext

function must(tools: ToolDefinition[], name: string): ToolDefinition {
  const found = tools.find((t) => t.name === name)
  if (!found) throw new Error(`tool not found: ${name}`)
  return found
}

describe('TokenBucketLimiter（对齐 hub ratelimit.Limiter）', () => {
  it('满桶可连发 perMinute 次，随后要等', () => {
    const l = new TokenBucketLimiter(3)
    const t0 = 0
    expect(l.take('k', t0)).toBe(0)
    expect(l.take('k', t0 + 1)).toBe(0)
    expect(l.take('k', t0 + 2)).toBe(0)
    expect(l.take('k', t0 + 3)).toBeGreaterThan(0)
  })

  it('随时间回水：等够 60/perMinute 秒能再扣一次', () => {
    const l = new TokenBucketLimiter(6) // rate = 0.1/s
    l.take('k', 0)
    l.take('k', 0)
    l.take('k', 0)
    l.take('k', 0)
    l.take('k', 0)
    l.take('k', 0) // 桶空
    expect(l.take('k', 1_000)).toBeGreaterThan(0)
    expect(l.take('k', 11_000)).toBe(0) // 攒够一枚
  })

  it('不同 key 各自独立', () => {
    const l = new TokenBucketLimiter(1)
    expect(l.take('台灯', 0)).toBe(0)
    expect(l.take('挂灯', 0)).toBe(0)
    expect(l.take('台灯', 1)).toBeGreaterThan(0)
  })

  it('空桶回满（长时间空闲恢复满额）', () => {
    const l = new TokenBucketLimiter(2)
    l.take('k', 0)
    l.take('k', 0)
    expect(l.take('k', 1_000)).toBeGreaterThan(0)
    expect(l.take('k', 120_000)).toBe(0) // 两分钟后回满
  })
})

describe('desk_mi_light 限流闸', () => {
  function fakeBridge(): MiBridge {
    return {
      list: vi.fn(async () => ({ ok: true as const, data: { devices: [] } })),
      state: vi.fn(async () => ({ ok: true as const, data: { did: 'd1', states: {} } })),
      lightSet: vi.fn(async () => ({ ok: true as const, data: { did: 'd1', prop: 'on-2', value: true } })),
    } as unknown as MiBridge
  }

  function makeConfig(perMinute: number): DeskMiConfig {
    return {
      pythonBin: 'python3',
      sensors: [],
      defaultSensor: '卧室',
      controlEnabled: true,
      controlPerMinute: perMinute,
    }
  }

  async function fireLight(times: number, perMinute = 2): Promise<unknown[]> {
    const tools = createDeskMiTools({ bridge: fakeBridge(), config: makeConfig(perMinute) })
    const light = must(tools, 'desk_mi_light')
    const results: unknown[] = []
    for (let i = 0; i < times; i++) {
      results.push(await light.execute({ name: '台灯', action: 'off' }, exec))
    }
    return results
  }

  it('连发超过配额：后面的被拦下', async () => {
    const results = await fireLight(4, 2)
    expect((results[0] as { ok: boolean }).ok).toBe(true)
    expect((results[1] as { ok: boolean }).ok).toBe(true)
    expect((results[2] as { ok: boolean }).ok).toBe(false)
    expect((results[3] as { ok: boolean }).ok).toBe(false)
    expect((results[2] as { degraded: string }).degraded).toContain('每分钟限 2 次')
  })

  it('配额 0 = 不限', async () => {
    const results = await fireLight(6, 0)
    expect(results.every((r) => (r as { ok: boolean }).ok)).toBe(true)
  })
})
