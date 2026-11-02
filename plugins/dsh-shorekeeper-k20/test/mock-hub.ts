/** mock k20 Hub（屏网关）。响应形状按 reference/lan-protocol.md §6；长轮询按 §2.3。
 * 另实现协议增补提案的三条路由（/v1/caption、/v1/phone/layout、/v1/lock），供单测。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export interface MockHubState {
  seq: number
  snapshot: Record<string, unknown>
  caption: { text: string; at: string } | null
  layout: Record<string, unknown> | null
  locked: boolean
  commands: { id: string; body: Record<string, unknown> }[]
  announced: string[]
}

export interface MockHub {
  server: Server
  url: string
  state: MockHubState
  /** 改状态并递增 seq，长轮询会立刻醒 */
  touch(patch?: Record<string, unknown>): void
  close(): Promise<void>
}

const TOKEN = 'test-token-1234'

export function createMockHub(options: { snapshot?: Record<string, unknown>; port?: number } = {}): Promise<MockHub> {
  const state: MockHubState = {
    seq: 41,
    snapshot: options.snapshot ?? {
      protocol: 1,
      hub: { name: 'study', mijia: 'ok', message: null },
      temperature: {
        id: 'desk',
        name: '书桌',
        celsius: 26.4,
        humidity: 53,
        updated_at: '2026-11-03T00:00:00Z',
        online: true,
      },
      pc: null,
      media: null,
      companion: { ready: true, voice: true, speaking: false, timer: null },
      devices: [
        { id: 'lamp', name: '台灯', type: 'light', online: true, on: true, brightness: 60 },
        { id: 'media-hidden', name: '占位', type: 'action', online: true, icon: 'music' },
      ],
      scenes: [{ id: 'bedtime', name: '晚安' }],
    },
    caption: null,
    layout: null,
    locked: false,
    commands: [],
    announced: [],
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      respond(response, 500, { error: { code: 'internal', message: 'mock 崩了' } })
    })
  })

  function authorize(request: IncomingMessage): boolean {
    const header = request.headers.authorization ?? ''
    return header === `Bearer ${TOKEN}`
  }

  function respond(response: ServerResponse, status: number, body: unknown) {
    const payload = JSON.stringify(body)
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    response.end(payload)
  }

  function error(response: ServerResponse, status: number, code: string, message: string) {
    respond(response, status, { error: { code, message } })
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://mock')
    const path = url.pathname
    const body = await readBody(request)

    if (path === '/health' && request.method === 'GET') {
      respond(response, 200, { ok: true, service: 'dock-hub', protocol: 1, name: 'study' })
      return
    }
    if (!authorize(request)) {
      error(response, 401, 'unauthorized', 'token 错或缺失')
      return
    }

    if (path === '/v1/snapshot' && request.method === 'GET') {
      const since = url.searchParams.get('since')
      const wait = Math.min(30, Math.max(0, Number(url.searchParams.get('wait') ?? 0) || 0))
      if (since !== null && wait > 0 && state.seq === Number(since)) {
        const changed = await waitForChange(Number(since), wait * 1000)
        if (!changed && !state.locked) {
          // 超时返回是正常情况：照常返回当前 snapshot
        }
      }
      respond(response, 200, {
        ...state.snapshot,
        protocol: 1,
        seq: state.seq,
        ...(state.caption ? { caption: state.caption } : {}),
      })
      return
    }
    if (path === '/v1/caption' && request.method === 'POST') {
      if (typeof body.clear === 'boolean' && body.clear) {
        state.caption = null
      } else if (typeof body.text === 'string' && body.text.length > 0) {
        state.caption = { text: body.text, at: new Date().toISOString() }
      } else {
        error(response, 400, 'bad_request', 'text 与 clear 必须给一个')
        return
      }
      touch()
      respond(response, 200, { ok: true })
      return
    }
    if (path === '/v1/phone/layout' && request.method === 'POST') {
      const layout = body.layout
      if (layout === null || typeof layout !== 'object') {
        error(response, 400, 'bad_request', 'layout 必须是对象')
        return
      }
      const phone = (state.snapshot.phone ?? {}) as Record<string, unknown>
      const current = (phone.layout ?? {}) as Record<string, unknown>
      state.snapshot.phone = {
        ...phone,
        layout: { ...current, ...layout, rev: Number(current.rev ?? 0) + 1 },
      }
      state.layout = layout as Record<string, unknown>
      touch()
      respond(response, 200, { ok: true })
      return
    }
    if (path === '/v1/lock' && request.method === 'POST') {
      state.locked = true
      touch()
      respond(response, 200, { ok: true })
      return
    }
    if (path === '/v1/devices/media/command' && request.method === 'POST') {
      const action = body.media
      if (action !== 'toggle' && action !== 'next' && action !== 'previous') {
        error(response, 400, 'unsupported', 'media 只收 toggle/next/previous')
        return
      }
      state.commands.push({ id: 'media', body })
      const media = {
        online: true,
        playing: action !== 'previous' ? true : false,
        updated_at: new Date().toISOString(),
        title: 'Night Drive',
        app: 'Music',
      }
      state.snapshot.media = media
      touch()
      respond(response, 200, media)
      return
    }
    if (path.startsWith('/v1/devices/') && path.endsWith('/command') && request.method === 'POST') {
      const id = decodeURIComponent(path.slice('/v1/devices/'.length, -'/command'.length))
      state.commands.push({ id, body })
      error(response, 404, 'not_found', `设备 id 不在白名单：${id}`)
      return
    }
    if (path === '/v1/companion/announce' && request.method === 'POST') {
      const text = typeof body.text === 'string' ? body.text : ''
      if (!text.trim()) {
        error(response, 400, 'bad_request', 'text 不能为空')
        return
      }
      state.announced.push(text)
      respond(response, 200, { text, audio_id: null })
      return
    }
    if (path === '/v1/companion/stop' && request.method === 'POST') {
      respond(response, 200, { ok: true })
      return
    }
    if (path === '/v1/notify/phone' && request.method === 'POST') {
      respond(response, 200, { id: 7, text: body.text, source: body.from ?? 'script', at: new Date().toISOString() })
      return
    }
    error(response, 404, 'not_found', '没有这个地址')
  }

  function touch(patch?: Record<string, unknown>) {
    if (patch) state.snapshot = { ...state.snapshot, ...patch }
    state.seq += 1
  }

  function waitForChange(since: number, waitMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (state.seq !== since || Date.now() - started >= waitMs) {
          clearInterval(timer)
          resolve(state.seq !== since)
        }
      }, 100)
    })
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
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        state,
        touch,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

export const MOCK_TOKEN = TOKEN
