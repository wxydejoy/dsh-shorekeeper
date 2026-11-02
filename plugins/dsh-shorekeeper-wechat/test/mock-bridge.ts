/** mock 微信桥（Windows 挂机侧）。契约见 src 旁 docs/bridge-contract.md。 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { BridgeMessage, DigestGroup } from '../src/types.ts'

export interface MockBridge {
  server: Server
  url: string
  groups: DigestGroup[]
  inbox: Map<string, BridgeMessage[]>
  sent: { contactId: string; text: string }[]
  wechatOnline: boolean
  close(): Promise<void>
}

const TOKEN = 'bridge-token-1'

export function createMockBridge(): Promise<MockBridge> {
  const groups: DigestGroup[] = [
    { contactId: 'wxid_mom', contactName: '妈妈', unread: 2, lastMessage: '吃饭了吗', lastAt: '2026-11-03T12:00:00+08:00' },
    { contactId: 'wxid_bank', contactName: '某银行', unread: 1, lastMessage: '您的验证码是 482913', lastAt: '2026-11-03T11:58:00+08:00' },
  ]
  const inbox = new Map<string, BridgeMessage[]>([
    [
      'wxid_mom',
      [
        { senderName: '妈妈', text: '这周末回来吗', at: '2026-11-03T11:57:00+08:00', kind: 'text' },
        { senderName: '妈妈', text: '吃饭了吗', at: '2026-11-03T12:00:00+08:00', kind: 'text' },
      ],
    ],
    [
      'wxid_bank',
      [
        { senderName: '某银行', text: '您的验证码是 482913，请勿泄露', at: '2026-11-03T11:58:00+08:00', kind: 'text' },
        { senderName: '某银行', text: '您的账户到账 500.00 元', at: '2026-11-03T11:59:00+08:00', kind: 'text' },
      ],
    ],
  ])
  const sent: { contactId: string; text: string }[] = []
  const state = { wechatOnline: true }

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      respond(response, 500, { error: { code: 'internal', message: 'mock 崩了' } })
    })
  })

  function respond(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(body))
  }

  function authorized(request: IncomingMessage): boolean {
    return (request.headers.authorization ?? '') === `Bearer ${TOKEN}`
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? '/').split('?')[0] ?? '/'
    const body = await readBody(request)
    if (path === '/api/health' && request.method === 'GET') {
      respond(response, 200, { ok: true, service: 'shorekeeper-wechat-bridge', wechatOnline: state.wechatOnline, account: '尾号 8888' })
      return
    }
    if (!authorized(request)) {
      respond(response, 401, { error: { code: 'unauthorized', message: '口令不对' } })
      return
    }
    if (path === '/api/digest' && request.method === 'GET') {
      if (!state.wechatOnline) {
        respond(response, 409, { error: { code: 'wechat_offline', message: '微信已掉线' } })
        return
      }
      respond(response, 200, { groups })
      return
    }
    if (path === '/api/read' && request.method === 'POST') {
      const contactId = typeof body.contactId === 'string' ? body.contactId : ''
      const limit = typeof body.limit === 'number' ? body.limit : 10
      const messages = (inbox.get(contactId) ?? []).slice(-Math.min(50, Math.max(1, limit)))
      respond(response, 200, { messages })
      return
    }
    if (path === '/api/send' && request.method === 'POST') {
      const contactId = typeof body.contactId === 'string' ? body.contactId : ''
      const text = typeof body.text === 'string' ? body.text : ''
      if (!contactId || !text) {
        respond(response, 400, { error: { code: 'bad_request', message: 'contactId 与 text 必填' } })
        return
      }
      sent.push({ contactId, text })
      respond(response, 200, { ok: true, at: new Date().toISOString() })
      return
    }
    respond(response, 404, { error: { code: 'not_found', message: '没有这个地址' } })
  }

  function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        if (!raw) return resolve({})
        try {
          resolve(JSON.parse(raw) as Record<string, unknown>)
        } catch {
          resolve({})
        }
      })
    })
  }

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        groups,
        inbox,
        sent,
        get wechatOnline() {
          return state.wechatOnline
        },
        set wechatOnline(value: boolean) {
          state.wechatOnline = value
        },
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

export const BRIDGE_TOKEN = TOKEN
