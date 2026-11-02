/** 微信工具面：digest（摘要）/ read（代读）/ send（审批代发）。
 *
 * 安全红线落地：脱敏默认开；验证码/转账类只提示不代读全文；发送总闸默认关 +
 * 白名单硬拒；host 侧审批接线 ⏸ T1（先以 sendEnabled 闸门兜底）。
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { BridgeClient, BridgeRequestError } from './bridge-client.ts'
import { isWhitelisted, maskName, scanSensitive } from './safety.ts'
import type { WechatConfig } from './config.ts'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export interface WechatToolDeps {
  bridge: BridgeClient
  config: WechatConfig
}

function degrade(error: unknown): { ok: false; degraded: string } {
  if (error instanceof BridgeRequestError) {
    if (error.status === 0) return { ok: false, degraded: `微信桥不可达（${error.code}）：Windows 挂机侧没起或地址不对` }
    if (error.status === 401) return { ok: false, degraded: '微信桥拒绝了口令：检查插件设置里的 bridgeToken' }
    if (error.status === 409) return { ok: false, degraded: '微信桥与微信已断连：挂机侧需要重新登录' }
    return { ok: false, degraded: `微信桥返回 ${error.status}：${error.message}` }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, degraded: `wechat 工具失败：${message}` }
}

function summaryOf(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'summary' in value) {
    const summary = (value as { summary?: unknown }).summary
    if (typeof summary === 'string') return summary
  }
  return 'wechat 工具完成'
}

export function createWechatTools(deps: WechatToolDeps): ToolDefinition[] {
  const { bridge, config } = deps

  const digest = defineTool({
    name: 'wechat.digest',
    description:
      '查看微信未读摘要：按会话分组、最近一条、未读数。人名默认脱敏（稳定别名），可在插件设置里关掉。守岸人主动提「微信有什么」走这里。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute() {
      try {
        const { groups } = await bridge.digest()
        const display = groups.map((group) => ({
          contact: config.maskNames ? maskName(group.contactName) : group.contactName,
          unread: group.unread,
          lastMessage: group.lastMessage,
          lastAt: group.lastAt,
        }))
        const lines = display.map(
          (group) => `${group.contact}（未读 ${group.unread}）：${group.lastMessage}`,
        )
        return {
          ok: true,
          masked: config.maskNames,
          groups: display satisfies Json,
          summary: lines.length > 0 ? `微信未读 ${display.length} 个会话：${lines.join('；')}` : '微信没有未读消息。',
        } satisfies Json
      } catch (error) {
        return degrade(error) satisfies Json
      }
    },
  })

  const read = defineTool({
    name: 'wechat.read',
    description: '代读指定会话的最近 N 条消息。验证码/转账类消息只提示、不代读全文（红线）。',
    parameters: {
      contactId: { type: 'string', description: '会话 id（wechat.digest 里拿；脱敏开着时用摘要原文里的 id 字段）', required: true },
      limit: { type: 'number', description: '最近 N 条，1–50，缺省 10' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute(args) {
      try {
        const contactId = typeof args.contactId === 'string' ? args.contactId.trim() : ''
        if (!contactId) return { ok: false, degraded: 'contactId 必填' } satisfies Json
        const limit = typeof args.limit === 'number' ? args.limit : 10
        const { messages } = await bridge.read(contactId, limit)
        // 红线：逐条扫，敏感消息整条只出提示
        const display = messages.map((message) => {
          const verdict = scanSensitive(message.text)
          const sender = config.maskNames ? maskName(message.senderName) : message.senderName
          if (verdict.kind === 'normal') {
            return { sender, at: message.at, text: message.text, kind: message.kind }
          }
          return {
            sender,
            at: message.at,
            text: `〔${verdict.reason}，已隐藏全文〕`,
            kind: message.kind,
            hidden: true,
          }
        })
        const hiddenCount = display.filter((item) => 'hidden' in item).length
        return {
          ok: true,
          messages: display satisfies Json,
          summary:
            `代读 ${display.length} 条${config.maskNames ? '（人名已脱敏）' : ''}` +
            (hiddenCount > 0 ? `；${hiddenCount} 条涉验证码/转账，只提示未代读全文` : ''),
        } satisfies Json
      } catch (error) {
        return degrade(error) satisfies Json
      }
    },
  })

  const send = defineTool({
    name: 'wechat.send',
    description:
      '给白名单联系人代发消息。三重闸门：插件总闸 sendEnabled（默认关）→ 白名单精确匹配（外硬拒）→ host 审批（⏸ T1 接线）。默认只读不发。',
    parameters: {
      contactId: { type: 'string', description: '目标联系人 id', required: true },
      contactName: { type: 'string', description: '目标联系人显示名（白名单可按名匹配）' },
      text: { type: 'string', description: '要发的正文', required: true },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute(args) {
      if (!config.sendEnabled) {
        return {
          ok: false,
          degraded: '代发未启用：默认只读不发；确需代发请在插件设置开启 sendEnabled 并配白名单',
        } satisfies Json
      }
      const contactId = typeof args.contactId === 'string' ? args.contactId.trim() : ''
      const contactName = typeof args.contactName === 'string' ? args.contactName.trim() : ''
      const text = typeof args.text === 'string' ? args.text.trim() : ''
      if (!contactId || !text) return { ok: false, degraded: 'contactId 与 text 必填' } satisfies Json
      if (!isWhitelisted(contactId, contactName, config.sendWhitelist)) {
        return { ok: false, degraded: `联系人不在白名单（${contactName || contactId}）：硬拒` } satisfies Json
      }
      const verdict = scanSensitive(text)
      if (verdict.kind !== 'normal') {
        return { ok: false, degraded: `拟发内容触发红线（${verdict.reason}）：不代发` } satisfies Json
      }
      try {
        await bridge.send(contactId, text)
        return { ok: true, summary: `已代发给 ${contactName || contactId}（走 host 审批后生效）` } satisfies Json
      } catch (error) {
        return degrade(error) satisfies Json
      }
    },
  })

  return [digest, read, send]
}
