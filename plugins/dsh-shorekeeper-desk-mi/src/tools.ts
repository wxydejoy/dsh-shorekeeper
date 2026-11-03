/** desk-mi 工具面：now/列表/温湿度只读；控灯写闸门（红线：默认关）。 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { MiBridge } from './bridge.ts'
import type { DeskMiConfig } from './config.ts'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export interface DeskMiToolDeps {
  bridge: MiBridge
  config: DeskMiConfig
  now?: () => Date
}

function summaryOf(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'summary' in value) {
    const summary = (value as { summary?: unknown }).summary
    if (typeof summary === 'string') return summary
  }
  return 'desk-mi 工具已完成'
}

const _WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const

function cnClock(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes()
  const minute = m === 0 ? '整' : m < 10 ? `零${m}` : String(m)
  return `${h}点${minute}`
}

export function createDeskMiTools(deps: DeskMiToolDeps): ToolDefinition[] {
  const { bridge, config } = deps
  const now = deps.now ?? (() => new Date())

  const deskNow = defineTool({
    name: 'desk_now',
    description:
      '读当前本地日期与时间（含星期、时钟、时段）。凡「现在几点」「今天星期几/几号」都必须走这里，不要凭上下文猜时间。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute() {
      const d = now()
      const hour = d.getHours()
      const period = hour >= 5 && hour < 11 ? '清晨' : hour < 17 ? '午后' : hour < 23 ? '夜里' : '深夜'
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const clock = `${String(hour).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      return {
        iso,
        weekday: `星期${_WEEKDAYS[d.getDay() === 0 ? 6 : d.getDay() - 1]}`,
        clock,
        clock_cn: cnClock(d),
        period,
        late_night: hour >= 23 || hour < 5,
        summary: `${iso} ${clock}（${period}）`,
      } satisfies Json
    },
  })

  const deskMiList = defineTool({
    name: 'desk_mi_list',
    description: '列出米家设备（did/名称/型号/在线态）。找设备 did、确认某个设备在不在线时用。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute() {
      const result = await bridge.list()
      if (!result.ok) return { ok: false, degraded: result.message, summary: result.message } satisfies Json
      const devices = (result.data.devices as Array<Record<string, unknown>>) ?? []
      return {
        ok: true,
        count: devices.length,
        devices: devices.map((d) => ({ did: String(d.did), name: String(d.name ?? ''), model: String(d.model ?? ''), online: d.online === true })),
        summary: `米家 ${devices.length} 台：${devices.map((d) => `${d.name}${d.online ? '' : '（离线）'}`).join('、')}`,
      } satisfies Json
    },
  })

  const deskMiSensor = defineTool({
    name: 'desk_mi_sensor',
    description:
      '读室内温湿度实时读数。凡问「屋里/室内/房间多少度、几度、潮不潮、干不干燥、湿度」，或提到冷热体感想看实况，必须走这里，不要用室外天气估算替代。不传 name 时读默认传感器（配置 defaultSensor）。',
    parameters: {
      name: { type: 'string', description: '传感器名（配置里的映射名，例如「卧室」）；缺省用默认' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute(args) {
      const wanted = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : config.defaultSensor
      const sensor = config.sensors.find((s) => s.name === wanted)
      if (!sensor) {
        const known = config.sensors.map((s) => s.name).join('、') || '（未配置）'
        const message = `没有叫「${wanted}」的温湿度计，已配置的：${known}`
        return { ok: false, degraded: message, summary: message } satisfies Json
      }
      const result = await bridge.state(sensor.did)
      if (!result.ok) return { ok: false, degraded: result.message, summary: result.message } satisfies Json
      const states = (result.data.states as Record<string, unknown>) ?? {}
      const temperature = pickNumber(states, ['temperature', '温度'])
      const humidity = pickNumber(states, ['relative-humidity', 'humidity', '湿度'])
      if (temperature === null && humidity === null) {
        const message = `${sensor.name} 读不到温湿度（设备可能离线）`
        return { ok: false, degraded: message, summary: message } satisfies Json
      }
      const parts = [
        temperature !== null ? `${sensor.name}${temperature}度` : `${sensor.name}温度读不到`,
        humidity !== null ? `湿度${humidity}%` : null,
      ].filter((p): p is string => p !== null)
      return {
        ok: true,
        sensor: sensor.name,
        temperature,
        humidity,
        summary: parts.join('，') + '。',
      } satisfies Json
    },
  })

  const deskMiLight = defineTool({
    name: 'desk_mi_light',
    description:
      '开/关/调亮度的米家灯控制（台灯/挂灯/灯带等）。高危写操作：插件配置 controlEnabled=false 时一律拒绝。动作前先 desk_mi_list 确认设备在线。',
    parameters: {
      name: { type: 'string', description: '设备名（米家里的名字，例如「台灯」）' },
      action: { type: 'string', description: 'on | off | brightness' },
      brightness: { type: 'number', description: '亮度 1-100（action=brightness 时必填）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute(args) {
      if (!config.controlEnabled) {
        const message = '米家写入未开闸（配置 controlEnabled=false）：按安全红线默认拒绝，需要在插件设置里明确开启'
        return { ok: false, degraded: message, summary: '这次没动成。米家写入没开闸。' } satisfies Json
      }
      const name = typeof args.name === 'string' ? args.name.trim() : ''
      const action = typeof args.action === 'string' ? args.action.trim().toLowerCase() : ''
      if (!name || !['on', 'off', 'brightness'].includes(action)) {
        return { ok: false, degraded: 'name 与 action（on/off/brightness）必填', summary: '参数不对' } satisfies Json
      }
      const list = await bridge.list()
      if (!list.ok) return { ok: false, degraded: list.message, summary: list.message } satisfies Json
      const devices = (list.data.devices as Array<Record<string, unknown>>) ?? []
      const device = devices.find((d) => String(d.name ?? '') === name)
      if (!device) {
        const message = `米家里没有叫「${name}」的设备`
        return { ok: false, degraded: message, summary: message } satisfies Json
      }
      if (device.online !== true) {
        const message = `${name} 离线`
        return { ok: false, degraded: message, summary: `${name} 离线，动不了。` } satisfies Json
      }
      const did = String(device.did)
      const state = await bridge.state(did)
      if (!state.ok) return { ok: false, degraded: state.message, summary: state.message } satisfies Json
      const states = (state.data.states as Record<string, unknown>) ?? {}
      const switchProp = pickKey(states, ['switch', 'on', '开关'])
      if (!switchProp) {
        const message = `${name} 上没找到开关属性`
        return { ok: false, degraded: message, summary: message } satisfies Json
      }
      let write: { prop: string; value: unknown } | null = null
      if (action === 'on') write = { prop: switchProp, value: true }
      if (action === 'off') write = { prop: switchProp, value: false }
      if (action === 'brightness') {
        const bri = args.brightness
        if (typeof bri !== 'number' || bri < 1 || bri > 100) {
          return { ok: false, degraded: 'brightness 需要 1-100', summary: '亮度要 1 到 100' } satisfies Json
        }
        const briProp = pickKey(states, ['brightness', '亮度'])
        if (!briProp) {
          const message = `${name} 不支持调亮度`
          return { ok: false, degraded: message, summary: message } satisfies Json
        }
        write = { prop: briProp, value: Math.round(bri) }
      }
      if (!write) return { ok: false, degraded: '未知动作', summary: '未知动作' } satisfies Json
      const result = await bridge.set(did, write.prop, write.value)
      if (!result.ok) return { ok: false, degraded: result.message, summary: result.message } satisfies Json
      return {
        ok: true,
        did,
        prop: write.prop,
        value: JSON.parse(JSON.stringify(write.value ?? null)) as Json,
        summary:
          action === 'brightness'
            ? `${name} 亮度调到 ${Math.round(args.brightness as number)}`
            : `${name} 已${action === 'on' ? '打开' : '关闭'}`,
      } satisfies Json
    },
  })

  return [deskNow, deskMiList, deskMiSensor, deskMiLight]
}

function pickNumber(states: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    for (const [name, value] of Object.entries(states)) {
      const norm = name.toLowerCase().replace(/-/g, '_')
      if ((norm === key.toLowerCase() || norm === key.toLowerCase().replace(/-/g, '_')) && typeof value === 'number') {
        return value
      }
    }
  }
  return null
}

function pickKey(states: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    for (const name of Object.keys(states)) {
      if (name.toLowerCase().replace(/-/g, '_').includes(key.toLowerCase())) return name
    }
  }
  return null
}
