/** k20 工具面。权限分级（README 规范）：snapshot 读 read-only；
 * caption/wallpaper/layout/media 写控类；lock 高危（另受 config.lockEnabled 闸门）。
 * Host 侧审批接线（sandbox_permissions）在 T1 真机校准时对齐；此前高危动作由闸门兜底。
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { HubRequestError, type HubClient } from './hub-client.ts'
import { BackgroundClient, BackgroundRequestError, LayoutNotReadyError } from './background-client.ts'
import { GatewayClient } from './gateway.ts'
import type { K20Config } from './config.ts'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export interface K20ToolDeps {
  hub: HubClient
  background: BackgroundClient
  gateway: GatewayClient
  config: K20Config
}

/** 把底层错误翻译成优雅降级结果（不刷屏报错） */
function degrade(error: unknown): { ok: false; degraded: string } {
  if (error instanceof HubRequestError) {
    if (error.status === 0) return { ok: false, degraded: `k20 不可达（${error.code}）：Hub 离线或地址不对，工具保持降级` }
    if (error.status === 401) return { ok: false, degraded: 'k20 拒绝了 token：检查插件设置里的共享口令' }
    if (error.status === 404) {
      return { ok: false, degraded: '网关还没有这条路由（协议增补提案未落地，见插件 docs/protocol-addendum.md）' }
    }
    return { ok: false, degraded: `k20 返回 ${error.status}：${error.message}` }
  }
  if (error instanceof LayoutNotReadyError) return { ok: false, degraded: 'k20 布局还没就绪，稍后再试' }
  if (error instanceof BackgroundRequestError) {
    if (error.status === 0) return { ok: false, degraded: 'k20 BackgroundServer 不可达：屏可能离线' }
    if (error.status === 401) return { ok: false, degraded: 'k20 背景服务拒绝了 token：检查插件设置里的共享口令' }
    return { ok: false, degraded: `k20 背景服务返回 ${error.status}：${error.message}` }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, degraded: `k20 工具失败：${message}` }
}

/** toSummary：给 render 用的稳定取值 */
function summaryOf(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'summary' in value) {
    const summary = (value as { summary?: unknown }).summary
    if (typeof summary === 'string') return summary
  }
  return 'k20 工具已完成'
}

export function createK20Tools(deps: K20ToolDeps): ToolDefinition[] {
  const { hub, background, gateway, config } = deps

  const snapshot = defineTool({
    name: 'k20_snapshot',
    description:
      '读取 k20 屏的当前状态：在线态、室内温湿度（米家温度源）、正在播放、伴侣就绪度、设备列表。查「现在屋里多少度」走这里。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute() {
      try {
        const snap = await hub.snapshot()
        const lines = [
          `k20 在线（${snap.hub.name}，seq ${snap.seq ?? '?'}）`,
          snap.temperature
            ? `室内 ${snap.temperature.celsius}°C${snap.temperature.humidity !== undefined ? ` / 湿度 ${snap.temperature.humidity}%` : ''}（${snap.temperature.name}）`
            : '室内温度：无数据',
          snap.media?.playing
            ? `正在播放：${snap.media.title ?? '未知曲目'}${snap.media.artist ? ` - ${snap.media.artist}` : ''}`
            : null,
          snap.companion ? `伴侣 ready=${snap.companion.ready} speaking=${snap.companion.speaking}` : null,
          `设备 ${snap.devices.length} 台：${snap.devices.map((d) => d.name).join('、')}`,
        ].filter((line): line is string => line !== null)
        return {
          k20_online: true,
          seq: snap.seq ?? null,
          summary: lines.join('；'),
          temperature: snap.temperature
            ? {
                name: snap.temperature.name,
                celsius: snap.temperature.celsius,
                humidity: snap.temperature.humidity ?? null,
                online: snap.temperature.online,
              }
            : null,
          media: snap.media ? { playing: snap.media.playing, title: snap.media.title ?? null } : null,
          devices: snap.devices.map((d) => ({ id: d.id, name: d.name, type: d.type, online: d.online })),
        } satisfies Json
      } catch (error) {
        return { ...degrade(error), k20_online: false } satisfies Json
      }
    },
  })

  const caption = defineTool({
    name: 'k20_caption',
    description:
      '在 k20 屏上推送或清除字幕。守岸人说话同步的字幕钩子由 T4（keeper-voice）调用；也可手动推一句话上屏。传 clear=true 清屏。',
    parameters: {
      text: { type: 'string', description: '要上屏的字幕文本；clear=true 时忽略' },
      clear: { type: 'boolean', description: '清掉当前字幕' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute(args) {
      try {
        if (args.clear === true) {
          await gateway.clearCaption()
          return { ok: true, summary: '字幕已清除' } satisfies Json
        }
        if (typeof args.text === 'string' && args.text.trim()) {
          await gateway.caption(args.text.trim(), { scale: config.captionScale })
          return { ok: true, summary: '字幕已推送到 k20' } satisfies Json
        }
        return { ok: false, degraded: 'text 与 clear 至少给一个' } satisfies Json
      } catch (error) {
        return degrade(error) satisfies Json
      }
    },
  })

  const wallpaper = defineTool({
    name: 'k20_wallpaper',
    description:
      '管理 k20 背景：list 列出全部背景与当前选中；upload 上传图片/视频并立即生效（dataBase64 为文件内容）；select 按 id 切换；clear 恢复默认；remove 删除。',
    parameters: {
      action: { type: 'string', enum: ['list', 'upload', 'select', 'clear', 'remove'], description: '动作', required: true },
      id: { type: 'string', description: 'select/remove 的背景 id（list 里可见）' },
      filename: { type: 'string', description: 'upload 的文件名（按扩展名判别 image/video）' },
      dataBase64: { type: 'string', description: 'upload 的文件内容（base64）' },
      realName: { type: 'string', description: 'upload 可选的署名' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute(args) {
      try {
        switch (args.action) {
          case 'list': {
            const index = await background.backgrounds()
            return {
              ok: true,
              current: index.current,
              items: index.items.map((item) => ({ id: item.id, name: item.name, kind: item.kind, bytes: item.bytes })),
              summary: `当前背景：${index.current ?? '默认'}；库存 ${index.items.length} 项`,
            } satisfies Json
          }
          case 'upload': {
            if (typeof args.filename !== 'string' || typeof args.dataBase64 !== 'string') {
              return { ok: false, degraded: 'upload 需要 filename 与 dataBase64' } satisfies Json
            }
            const data = Uint8Array.from(Buffer.from(args.dataBase64, 'base64'))
            const index = await background.upload(args.filename, data, typeof args.realName === 'string' ? args.realName : undefined)
            return { ok: true, current: index.current, summary: `背景已上传并生效：${args.filename}` } satisfies Json
          }
          case 'select': {
            if (typeof args.id !== 'string') return { ok: false, degraded: 'select 需要 id' } satisfies Json
            const index = await background.select(args.id)
            return { ok: true, current: index.current, summary: `背景已切换：${index.current}` } satisfies Json
          }
          case 'clear': {
            await background.clear()
            return { ok: true, current: null, summary: '背景已清掉，恢复默认' } satisfies Json
          }
          case 'remove': {
            if (typeof args.id !== 'string') return { ok: false, degraded: 'remove 需要 id' } satisfies Json
            const index = await background.remove(args.id)
            return { ok: true, current: index.current, summary: `背景已删除（现库存 ${index.items.length} 项）` } satisfies Json
          }
          default:
            return { ok: false, degraded: `不认识的 action：${String(args.action)}` } satisfies Json
        }
      } catch (error) {
        return degrade(error) satisfies Json
      }
    },
  })

  const layout = defineTool({
    name: 'k20_layout',
    description:
      '读取或调整 k20 主屏模块布局（槽位显隐/位置/尺寸）。read 返回手机现状；apply 提交一份布局（服务端递增 layout.rev，安卓按 rev 变大才套用）。',
    parameters: {
      action: { type: 'string', enum: ['read', 'apply'], description: '动作', required: true },
      layout: {
        type: 'json',
        description: 'apply 的布局对象，如 { modules: { Weather: { visible: false } } }；rev 由服务端递增，不用填',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute(args) {
      try {
        if (args.action === 'read') {
          const current = await background.layout()
          return {
            ok: true,
            layout: JSON.parse(JSON.stringify(current)) as Json,
            summary: '已取回 k20 布局现状',
          } satisfies Json
        }
        if (args.layout === undefined || args.layout === null || typeof args.layout !== 'object') {
          return { ok: false, degraded: 'apply 需要 layout 对象' } satisfies Json
        }
        await gateway.setPhoneLayout(JSON.parse(JSON.stringify(args.layout)))
        return { ok: true, summary: '布局已提交（安卓会在下一轮轮询按 rev 套用）' } satisfies Json
      } catch (error) {
        return degrade(error) satisfies Json
      }
    },
  })

  const media = defineTool({
    name: 'k20_media',
    description: '控制电脑正在播放的媒体会话：toggle 播放/暂停、next 下一首、previous 上一首。',
    parameters: {
      action: { type: 'string', enum: ['toggle', 'next', 'previous'], description: '媒体键', required: true },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute(args) {
      try {
        const result = await hub.media(args.action)
        return {
          ok: true,
          playing: result.playing,
          title: result.title ?? null,
          summary: `媒体键 ${args.action} 已执行${result.playing ? '，正在播放' : '，已暂停'}`,
        } satisfies Json
      } catch (error) {
        return degrade(error) satisfies Json
      }
    },
  })

  const lock = defineTool({
    name: 'k20_lock',
    description: '熄灭 k20 屏（设备管理员锁屏）。高危操作：未在插件设置里开启 lockEnabled 时一律拒绝。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute() {
      if (!config.lockEnabled) {
        return { ok: false, degraded: '熄屏未启用：这是高危操作，需在插件设置里明确开启 lockEnabled' } satisfies Json
      }
      try {
        await gateway.lock()
        return { ok: true, summary: 'k20 已熄屏' } satisfies Json
      } catch (error) {
        return degrade(error) satisfies Json
      }
    },
  })

  return [snapshot, caption, wallpaper, layout, media, lock]
}
