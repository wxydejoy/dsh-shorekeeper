import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createDeskMiTools } from '../src/tools.ts'
import type { MiBridge } from '../src/bridge.ts'
import type { DeskMiConfig } from '../src/config.ts'

/** execute 的第二参（ToolRunContext）在本插件实现里不使用，测试传 null 即可。 */
const exec = null as unknown as ToolRunContext

function must(tools: ToolDefinition[], name: string): ToolDefinition {
  const found = tools.find((t) => t.name === name)
  if (!found) throw new Error(`tool not found: ${name}`)
  return found
}

function fakeBridge(overrides: Partial<Record<keyof MiBridge, unknown>> = {}): MiBridge {
  const base = {
    list: vi.fn(async () => ({
      ok: true as const,
      data: {
        devices: [
          { did: 'd1', name: '台灯', model: 'xiaomi.light.lamp31', online: true },
          { did: 'd2', name: '挂灯', model: 'yeelink.light.lamp22', online: false },
        ],
      },
    })),
    state: vi.fn(async () => ({
      ok: true as const,
      data: { did: 'd1', states: { 'Switch Status': true, Brightness: 50, Temperature: 25.4 } },
    })),
    set: vi.fn(async () => ({ ok: true as const, data: { did: 'd1' } })),
    lightSet: vi.fn(async (_name: string, action: 'on' | 'off' | 'brightness') => ({
      ok: true as const,
      data: { did: 'd1', name: _name, prop: action === 'brightness' ? 'brightness' : 'Switch Status', value: action === 'on' ? true : action === 'off' ? false : 50 },
    })),
  }
  return { ...base, ...overrides } as unknown as MiBridge
}

const config: DeskMiConfig = {
  pythonBin: 'python3',
  sensors: [{ name: '卧室', did: 'blt.x' }],
  defaultSensor: '卧室',
  controlEnabled: false,
}

function getTools(bridge = fakeBridge(), cfg = config): ToolDefinition[] {
  return createDeskMiTools({ bridge, config: cfg, now: () => new Date('2026-11-03T14:05:00') })
}

describe('desk_now', () => {
  it('报 ISO/星期/时段，不猜时间', async () => {
    const value = (await must(getTools(), 'desk_now').execute({}, exec)) as Record<string, unknown>
    expect(value.iso).toBe('2026-11-03')
    expect(value.weekday).toBe('星期二')
    expect(value.period).toBe('午后')
    expect(value.late_night).toBe(false)
    expect(String(value.summary)).toContain('2026-11-03')
  })
})

describe('desk_mi_sensor', () => {
  it('读默认传感器并出中文摘要', async () => {
    const bridge = fakeBridge({
      state: vi.fn(async () => ({
        ok: true as const,
        data: { did: 'blt.x', states: { temperature: 25.4, 'relative-humidity': 58 } },
      })),
    })
    const value = (await must(getTools(bridge), 'desk_mi_sensor').execute({}, exec)) as Record<string, unknown>
    expect(value.temperature).toBe(25.4)
    expect(value.humidity).toBe(58)
    expect(String(value.summary)).toContain('卧室25.4度')
  })

  it('未知传感器名：优雅降级并列出已配置项', async () => {
    const value = (await must(getTools(), 'desk_mi_sensor').execute({ name: '客厅' }, exec)) as Record<string, unknown>
    expect(value.ok).toBe(false)
    expect(String(value.degraded)).toContain('客厅')
    expect(String(value.degraded)).toContain('卧室')
  })

  it('桥失败：降级不抛', async () => {
    const bridge = fakeBridge({
      state: vi.fn(async () => ({ ok: false as const, code: 'auth-expired', message: '米家登录已过期' })),
    })
    const value = (await must(getTools(bridge), 'desk_mi_sensor').execute({}, exec)) as Record<string, unknown>
    expect(value.ok).toBe(false)
    expect(String(value.degraded)).toContain('过期')
  })
})

describe('desk_mi_light 闸门（红线）', () => {
  it('controlEnabled=false：一律拒绝且不动桥', async () => {
    const bridge = fakeBridge()
    const value = (await must(getTools(bridge), 'desk_mi_light').execute({ name: '台灯', action: 'on' }, exec)) as Record<string, unknown>
    expect(value.ok).toBe(false)
    expect(String(value.summary)).toContain('没开闸')
    expect(bridge.list).not.toHaveBeenCalled()
  })

  it('controlEnabled=true：开灯走 lightSet（单进程）', async () => {
    const bridge = fakeBridge()
    const value = (await must(getTools(bridge, { ...config, controlEnabled: true }), 'desk_mi_light').execute({ name: '台灯', action: 'on' }, exec)) as Record<string, unknown>
    expect(value.ok).toBe(true)
    expect(value.prop).toBe('Switch Status')
    expect(value.value).toBe(true)
    expect((bridge.lightSet as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(['台灯', 'on', undefined])
    expect(bridge.state).not.toHaveBeenCalled() // 提速②：不再先读一遍状态
  })

  it('离线设备拒绝写入（python 侧判定，TS 透传降级）', async () => {
    // 提速②后在线检查在 python light_set 内做：桥报错 → TS 原样透传
    const bridge = fakeBridge({
      lightSet: vi.fn(async () => ({ ok: false as const, code: 'error', message: '挂灯 离线，动不了。' })),
    })
    const value = (await must(getTools(bridge, { ...config, controlEnabled: true }), 'desk_mi_light').execute({ name: '挂灯', action: 'on' }, exec)) as Record<string, unknown>
    expect(value.ok).toBe(false)
    expect(String(value.degraded)).toContain('离线')
  })

  it('brightness 越界拒绝', async () => {
    const value = (await must(getTools(fakeBridge(), { ...config, controlEnabled: true }), 'desk_mi_light').execute(
      { name: '台灯', action: 'brightness', brightness: 200 },
      exec,
    )) as Record<string, unknown>
    expect(value.ok).toBe(false)
    expect(String(value.degraded)).toContain('1-100')
  })
})

describe('desk_mi_list', () => {
  it('列出设备并标注离线', async () => {
    const value = (await must(getTools(), 'desk_mi_list').execute({}, exec)) as Record<string, unknown>
    expect(value.count).toBe(2)
    expect(String(value.summary)).toContain('挂灯（离线）')
  })
})
