/** mock k20 安卓端 BackgroundServer（:17920）。路由与语义按 dock/android BackgroundServer.kt 实测：
 * cookie 会话、列表/上传即生效/select/clear/delete、layout 只读（503 = 未就绪）。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'

export interface MockBackgroundItem {
  id: string
  name: string
  kind: 'image' | 'video'
  bytes: number
  modified: number
  owner: string | null
  data: Uint8Array
}

export interface MockBackground {
  server: Server
  url: string
  items: MockBackgroundItem[]
  current: string | null
  layoutServed: number
  layoutReady: boolean
  close(): Promise<void>
}

const TOKEN = 'test-token-1234'

export function createMockBackground(options: { port?: number; layoutReady?: boolean } = {}): Promise<MockBackground> {
  const items: MockBackgroundItem[] = []
  const sessions = new Set<string>()
  let current: string | null = null
  let layoutServed = 0
  const layoutReady = options.layoutReady ?? true

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      respond(response, 500, { error: 'mock 崩了' })
    })
  })

  function respond(response: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
    const payload = JSON.stringify(body)
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    })
    response.end(payload)
  }

  function index() {
    return { current, items: items.map(({ data, ...item }) => item) }
  }

  function authorized(request: IncomingMessage): boolean {
    const cookie = request.headers.cookie ?? ''
    const session = cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('dock_bg='))
      ?.slice('dock_bg='.length)
    return session !== undefined && sessions.has(session)
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? '/').split('?')[0] ?? '/'
    const parts = path.split('/')
    const body = await readBody(request)

    if (request.method === 'POST' && path === '/api/login') {
      let token = ''
      try {
        token = (JSON.parse(body.toString('utf-8')) as { token?: string }).token ?? ''
      } catch {
        token = ''
      }
      if (token !== TOKEN) {
        respond(response, 401, { error: '口令不对' }, { 'Set-Cookie': 'dock_bg=; HttpOnly; Path=/; Max-Age=0' })
        return
      }
      const session = randomUUID()
      sessions.add(session)
      respond(response, 200, { ok: true }, { 'Set-Cookie': `dock_bg=${session}; HttpOnly; Path=/` })
      return
    }
    if (!authorized(request)) {
      respond(response, 401, { error: '口令不对' })
      return
    }

    if (request.method === 'GET' && path === '/api/backgrounds') {
      respond(response, 200, index())
      return
    }
    if (request.method === 'POST' && path === '/api/backgrounds') {
      const contentType = request.headers['content-type'] ?? ''
      const boundary = /boundary=([^;\s]+)/.exec(contentType)?.[1]
      if (!boundary) {
        respond(response, 400, { error: '没有文件' })
        return
      }
      const parsed = parseMultipart(body, boundary)
      const file = parsed.file
      if (!file || !parsed.filename) {
        respond(response, 400, { error: '没有文件' })
        return
      }
      const id = randomUUID().slice(0, 8)
      const kind: MockBackgroundItem['kind'] = /\.(mp4|webm|mkv|mov)$/i.test(parsed.filename) ? 'video' : 'image'
      items.push({
        id,
        name: parsed.filename,
        kind,
        bytes: file.byteLength,
        modified: Date.now(),
        owner: parsed.fields.realname ?? null,
        data: file,
      })
      current = id
      respond(response, 201, index())
      return
    }
    if (request.method === 'POST' && path === '/api/backgrounds/clear') {
      current = null
      respond(response, 200, index())
      return
    }
    if (request.method === 'POST' && parts.length === 5 && parts[1] === 'api' && parts[2] === 'backgrounds' && parts[4] === 'select') {
      const id = decodeURIComponent(parts[3] ?? '')
      if (!items.some((item) => item.id === id)) {
        respond(response, 404, { error: '找不到文件' })
        return
      }
      current = id
      respond(response, 200, index())
      return
    }
    if (request.method === 'DELETE' && parts.length === 4 && parts[1] === 'api' && parts[2] === 'backgrounds') {
      const id = decodeURIComponent(parts[3] ?? '')
      const at = items.findIndex((item) => item.id === id)
      if (at < 0) {
        respond(response, 404, { error: '找不到文件' })
        return
      }
      items.splice(at, 1)
      if (current === id) current = null
      respond(response, 200, index())
      return
    }
    if (request.method === 'GET' && path === '/api/layout') {
      layoutServed += 1
      if (!layoutReady) {
        respond(response, 503, { error: '布局还没就绪，稍后再试' })
        return
      }
      respond(response, 200, {
        canvas: { width: 1920, height: 720 },
        catalog: ['Clock', 'Pc', 'Media', 'Weather'],
        default: {},
        saved: { rev: 3, modules: {} },
      })
      return
    }
    if (request.method === 'GET' && parts.length === 5 && parts[1] === 'api' && parts[2] === 'backgrounds' && parts[4] === 'media') {
      const item = items.find((candidate) => candidate.id === decodeURIComponent(parts[3] ?? ''))
      if (!item) {
        respond(response, 404, { error: '找不到文件' })
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': item.data.byteLength })
      response.end(Buffer.from(item.data))
      return
    }
    respond(response, 404, { error: '没有这个地址' })
  }

  function parseMultipart(body: Buffer, boundary: string): { filename: string; file: Uint8Array | null; fields: Record<string, string> } {
    const marker = Buffer.from(`--${boundary}`)
    const fields: Record<string, string> = {}
    let filename = ''
    let file: Uint8Array | null = null
    let cursor = body.indexOf(marker)
    while (cursor >= 0) {
      const next = body.indexOf(marker, cursor + marker.byteLength)
      if (next < 0) break
      let start = cursor + marker.byteLength
      if (body[start] === 0x0d && body[start + 1] === 0x0a) start += 2
      const segment = body.subarray(start, next)
      const headerEnd = segment.indexOf('\r\n\r\n')
      if (headerEnd >= 0) {
        const headers = segment.subarray(0, headerEnd).toString('utf-8')
        // 与 Kotlin 端 copyUntil(\r\n--boundary) 对齐：内容不含结尾的 \r\n
        let end = segment.byteLength
        if (segment[end - 2] === 0x0d && segment[end - 1] === 0x0a) end -= 2
        const content = segment.subarray(headerEnd + 4, end)
        const name = /\bname="([^"]*)"/.exec(headers)?.[1] ?? ''
        const fileHeader = /filename\*=(?:UTF-8|utf-8)''([^;\s]+)/.exec(headers)
        const fileNameQuoted = /filename="([^"]*)"/.exec(headers)?.[1]
        const rawEncoded = fileHeader?.[1]
        const rawName = rawEncoded !== undefined ? decodeURIComponent(rawEncoded) : (fileNameQuoted ?? '')
        if (rawName) {
          filename = rawName
          file = content
        } else if (name) {
          fields[name] = content.toString('utf-8').trim()
        }
      }
      cursor = next
    }
    return { filename, file, fields }
  }

  function readBody(request: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => resolve(Buffer.concat(chunks)))
    })
  }

  return new Promise((resolve) => {
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        items,
        get current() {
          return current
        },
        get layoutServed() {
          return layoutServed
        },
        layoutReady,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}
