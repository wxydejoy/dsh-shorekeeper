/** k20 网关服务端（src/server.ts）单测：mock webServer + mock req/res，六张路由全过。
 * 长轮询用短 wait 实测（50ms 内 bump），不依赖 fake timers。
 */

import { EventEmitter } from 'node:events'
import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { K20Gateway, registerK20Server } from '../src/server.ts'

const TOKEN = 'test-token-1234'

interface RecordedRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => unknown
}

/** mock webServer：只记录注册，dispatch 由测试挑路由调 handler */
function createMockWebServer() {
  const routes: RecordedRoute[] = []
  return {
    routes,
    register(route: RecordedRoute): () => void {
      routes.push(route)
      return () => {}
    },
    find(method: string, url: string): RecordedRoute | undefined {
      const path = url.split('?')[0] ?? url
      return (
        routes.find((r) => r.kind === 'exact' && r.path === path) ??
        routes.find((r) => r.kind === 'prefix' && (path === r.path || path.startsWith(r.path)))
      )
    },
    async dispatch(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<MockRes> {
      const path = url.split('?')[0] ?? url
      const route = routes.find((r) => r.kind === 'exact' && r.path === path) ??
        routes.find((r) => r.kind === 'prefix' && (path === r.path || path.startsWith(r.path)))
      if (!route) throw new Error(`no route for ${method} ${url}`)
      const req = createMockReq(method, url, body, headers)
      const res = createMockRes()
      await route.handler(req as unknown as IncomingMessage, res as unknown as ServerResponse)
      return res
    },
  }
}

function createMockReq(method: string, url: string, body: unknown, headers: Record<string, string>): EventEmitter & { method: string; url: string; headers: Record<string, string> } {
  const req = new EventEmitter() as EventEmitter & { method: string; url: string; headers: Record<string, string> }
  req.method = method
  req.url = url
  req.headers = headers
  queueMicrotask(() => {
    if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  return req
}

interface MockRes {
  status: number | undefined
  body: unknown
  headersSent: boolean
  writeHead(status: number): unknown
  end(payload?: string): void
}

function createMockRes(): MockRes {
  const res: MockRes = {
    status: undefined,
    body: undefined,
    headersSent: false,
    writeHead(status) {
      res.status = status
      res.headersSent = true
      return res
    },
    end(payload) {
      if (typeof payload === 'string') res.body = JSON.parse(payload)
    },
  }
  return res
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}` }
}

describe('k20 网关服务端', () => {
  let web: ReturnType<typeof createMockWebServer>
  let gateway: K20Gateway

  beforeEach(() => {
    web = createMockWebServer()
    gateway = new K20Gateway('study')
    registerK20Server({
      ctx: { effect: (fn: () => void) => fn() } as never,
      webServer: web,
      config: { token: TOKEN, serverName: 'study', companionUpstream: '', hubUpstream: '', ttsBaseUrl: '', ttsToken: '' },
      gateway,
    })
  })

  afterEach(() => {
    // 等待者都挂在 gateway 上，测试结束自然释放
  })

  it('/health：免鉴权，形状对齐 lan-protocol §6.1', async () => {
    const res = await web.dispatch('GET', '/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, service: 'dock-hub', protocol: 1, name: 'study' })
  })

  it('无 token → 401；错 token → 401', async () => {
    const noAuth = await web.dispatch('GET', '/v1/snapshot')
    expect(noAuth.status).toBe(401)
    const badAuth = await web.dispatch('GET', '/v1/snapshot', undefined, { authorization: 'Bearer wrong' })
    expect(badAuth.status).toBe(401)
  })

  it('/v1/snapshot：最小集形状，未接的面整个省略；pc 例外永远给出', async () => {
    const res = await web.dispatch('GET', '/v1/snapshot', undefined, authHeaders())
    expect(res.status).toBe(200)
    const snap = res.body as Record<string, unknown>
    expect(snap.protocol).toBe(1)
    expect(snap.seq).toBe(0)
    expect(snap.hub).toEqual({ name: 'study', mijia: 'ok', message: null })
    expect(snap.devices).toEqual([])
    expect(snap.media).toBeNull()
    expect(snap.temperature).toBeNull()
    // pc 永远给出：缺了 app 读成「还没数据=保持醒着」，熄屏链路断（2026-11-05 实证）
    expect(snap.pc).toEqual({ online: false, updated_at: '' })
    expect(snap).not.toHaveProperty('phone')
    expect(snap).not.toHaveProperty('companion')
    expect(snap).not.toHaveProperty('caption')
  })

  it('pc：喂入真样本 → snapshot 透传；同值不递增 seq；变值递增', async () => {
    const fresh = { online: true, updated_at: '2026-11-05T03:22:20Z', cpu: { percent: 15.4, temp_celsius: 32.1 } }
    gateway.setPc(fresh)
    const snap = (await web.dispatch('GET', '/v1/snapshot', undefined, authHeaders())).body as Record<string, unknown>
    expect(snap.pc).toEqual(fresh)
    const seqAfterFirst = snap.seq as number
    // 同值重喂（模拟每个轮询周期）：seq 不动，长轮询等待者不被惊动
    gateway.setPc({ ...fresh })
    const snap2 = (await web.dispatch('GET', '/v1/snapshot', undefined, authHeaders())).body as Record<string, unknown>
    expect(snap2.seq).toBe(seqAfterFirst)
    // 变值（Windows 关机）：seq 递增，长轮询能收到
    gateway.setPc({ online: false, updated_at: '' })
    const snap3 = (await web.dispatch('GET', '/v1/snapshot', undefined, authHeaders())).body as Record<string, unknown>
    expect((snap3.pc as { online: boolean }).online).toBe(false)
    expect((snap3.seq as number) > seqAfterFirst).toBe(true)
  })

  it('photos（F37）：喂名单 → snapshot.photos 透传；空相册不带字段；名单变化 bump seq', async () => {
    // 相册没开/没图：不带字段（同 hub 的「没图不带」语义）
    gateway.setPhotos(null)
    let snap = (await web.dispatch('GET', '/v1/snapshot', undefined, authHeaders())).body as Record<string, unknown>
    expect(snap).not.toHaveProperty('photos')
    // 名单进来 → 透传 + /v1/photos 名单面可取
    gateway.setPhotos({ ids: ['a.jpg', 'b.png'] })
    snap = (await web.dispatch('GET', '/v1/snapshot', undefined, authHeaders())).body as Record<string, unknown>
    expect(snap.photos).toEqual({ ids: ['a.jpg', 'b.png'] })
    const list = (await web.dispatch('GET', '/v1/photos', undefined, authHeaders())).body as { ids: string[] }
    expect(list.ids).toEqual(['a.jpg', 'b.png'])
    // 空列表等价于没图（防误配空目录）
    gateway.setPhotos({ ids: [] })
    snap = (await web.dispatch('GET', '/v1/snapshot', undefined, authHeaders())).body as Record<string, unknown>
    expect(snap).not.toHaveProperty('photos')
  })

  it('caption：推 → snapshot 带文本/at/scale；clear → 键消失；空体 → 400；scale 越界 → 400', async () => {
    const push = await web.dispatch('POST', '/v1/caption', { text: '漂泊者，晚上好。', scale: 110 }, authHeaders())
    expect(push.status).toBe(200)
    let snap = (await web.dispatch('GET', '/v1/snapshot', undefined, authHeaders())).body as Record<string, unknown>
    expect(snap.caption).toMatchObject({ text: '漂泊者，晚上好。', scale: 110 })
    expect(typeof (snap.caption as { at: string }).at).toBe('string')

    const clear = await web.dispatch('POST', '/v1/caption', { clear: true }, authHeaders())
    expect(clear.status).toBe(200)
    snap = (await web.dispatch('GET', '/v1/snapshot', undefined, authHeaders())).body as Record<string, unknown>
    expect(snap).not.toHaveProperty('caption')

    const empty = await web.dispatch('POST', '/v1/caption', {}, authHeaders())
    expect(empty.status).toBe(400)
    const badScale = await web.dispatch('POST', '/v1/caption', { text: 'x', scale: 300 }, authHeaders())
    expect(badScale.status).toBe(400)
  })

  it('phone/layout：rev 递增、槽位矩形部分合并；phone 只在写过布局后出现；非法矩形 → 400', async () => {
    await web.dispatch('POST', '/v1/phone/layout', { layout: { modules: { Weather: { x: 0.6, y: 0.1, w: 0.3, h: 0.3, visible: false } } } }, authHeaders())
    await web.dispatch('POST', '/v1/phone/layout', { layout: { modules: { Weather: { x: 0.55, visible: true }, Clock: { x: 0.05, y: 0.05, w: 0.4, h: 0.4, visible: true } } } }, authHeaders())
    const snap = (await web.dispatch('GET', '/v1/snapshot', undefined, authHeaders())).body as {
      phone?: { layout?: { rev: number; modules: Record<string, Record<string, unknown>> } }
    }
    expect(snap.phone?.layout?.rev).toBe(2)
    expect(snap.phone?.layout?.modules.Weather).toMatchObject({ x: 0.55, visible: true, w: 0.3 })
    expect(snap.phone?.layout?.modules.Clock?.visible).toBe(true)

    const bad = await web.dispatch('POST', '/v1/phone/layout', { layout: { modules: { Clock: { x: 5 } } } }, authHeaders())
    expect(bad.status).toBe(400)
  })

  it('lock：请求 → snapshot.lock.requested_at', async () => {
    const res = await web.dispatch('POST', '/v1/lock', {}, authHeaders())
    expect(res.status).toBe(200)
    const snap = (await web.dispatch('GET', '/v1/snapshot', undefined, authHeaders())).body as { lock?: { requested_at?: string } }
    expect(typeof snap.lock?.requested_at).toBe('string')
  })

  it('media：toggle 乐观翻转并进 snapshot；非法动作 → 400；未知设备 → 404', async () => {
    const first = await web.dispatch('POST', '/v1/devices/media/command', { media: 'toggle' }, authHeaders())
    expect(first.status).toBe(200)
    expect((first.body as { playing: boolean }).playing).toBe(true)
    const second = await web.dispatch('POST', '/v1/devices/media/command', { media: 'toggle' }, authHeaders())
    expect((second.body as { playing: boolean }).playing).toBe(false)
    const snap = (await web.dispatch('GET', '/v1/snapshot', undefined, authHeaders())).body as { media?: { playing: boolean } }
    expect(snap.media?.playing).toBe(false)

    const bad = await web.dispatch('POST', '/v1/devices/media/command', { media: 'pause' }, authHeaders())
    expect(bad.status).toBe(400)
    const unknown = await web.dispatch('POST', '/v1/devices/lamp/command', { on: true }, authHeaders())
    expect(unknown.status).toBe(404)
  })

  it('companion 面：upstream 为空时整面 404（companion_disabled）', async () => {
    const res = await web.dispatch('POST', '/v1/companion/chat', { text: '在吗' }, authHeaders())
    expect(res.status).toBe(404)
    expect((res.body as { error?: { code?: string } }).error?.code).toBe('companion_disabled')
  })

  it('companion 面：upstream 在位时原样代理（method/authorization/body/路径/响应流）', async () => {
    // 真上游：回显收到的东西
    const upstream = createHttpServer((ureq, ures) => {
      let body = ''
      ureq.on('data', (c: Buffer) => {
        body += c.toString()
      })
      ureq.on('end', () => {
        ures.writeHead(200, { 'content-type': 'application/json' })
        ures.end(JSON.stringify({ method: ureq.method, path: ureq.url, auth: ureq.headers.authorization ?? null, body }))
      })
    })
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
    const upPort = (upstream.address() as AddressInfo).port

    // 宿主壳：真实 http server，用 mock webServer 的路由表调 handler（真 req/res）
    const hostWeb = createMockWebServer()
    registerK20Server({
      ctx: { effect: (fn: () => void) => fn() } as never,
      webServer: hostWeb,
      config: { token: TOKEN, serverName: 'study', companionUpstream: `http://127.0.0.1:${upPort}`, hubUpstream: `http://127.0.0.1:${upPort}`, ttsBaseUrl: `http://127.0.0.1:${upPort}`, ttsToken: '' },
      gateway: new K20Gateway('study'),
    })
    const host = createHttpServer((hreq, hres) => {
      const route = hostWeb.find(hreq.method ?? 'GET', hreq.url ?? '/')
      if (!route) {
        hres.statusCode = 404
        hres.end()
        return
      }
      void route.handler(hreq as IncomingMessage, hres as ServerResponse)
    })
    await new Promise<void>((r) => host.listen(0, '127.0.0.1', r))
    const hPort = (host.address() as AddressInfo).port

    try {
      const res = await fetch(`http://127.0.0.1:${hPort}/v1/companion/chat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text: '在吗' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { method: string; path: string; auth: string | null; body: string }
      expect(body.method).toBe('POST')
      expect(body.path).toBe('/v1/companion/chat')
      expect(body.auth).toBe(`Bearer ${TOKEN}`)
      expect(JSON.parse(body.body)).toEqual({ text: '在吗' })
    } finally {
      upstream.close()
      host.close()
    }
  })

  it('语音直连：announce→TTS /v1/speak（play_only）、stop→TTS /v1/stop，全程不碰 hub；空 text 400；超长只留 3 句', async () => {
    const seen: { path: string; body: Record<string, unknown> }[] = []
    const tts = createHttpServer((treq, tres) => {
      let body = ''
      treq.on('data', (c: Buffer) => {
        body += c.toString()
      })
      treq.on('end', () => {
        seen.push({ path: treq.url ?? '', body: JSON.parse(body || '{}') as Record<string, unknown> })
        tres.writeHead(200, { 'content-type': 'application/json' })
        tres.end('{"ok":true}')
      })
    })
    const hub = createHttpServer((hreq, hres) => {
      hres.writeHead(500, { 'content-type': 'application/json' })
      hres.end(JSON.stringify({ error: { code: 'hub_should_not_be_called', message: `announce/stop 不该到 hub（${hreq.url}）` } }))
    })
    await new Promise<void>((r) => tts.listen(0, '127.0.0.1', r))
    await new Promise<void>((r) => hub.listen(0, '127.0.0.1', r))
    const ttsPort = (tts.address() as AddressInfo).port
    const hubPort = (hub.address() as AddressInfo).port

    const hostWeb = createMockWebServer()
    registerK20Server({
      ctx: { effect: (fn: () => void) => fn() } as never,
      webServer: hostWeb,
      config: { token: TOKEN, serverName: 'study', companionUpstream: `http://127.0.0.1:${hubPort}`, hubUpstream: `http://127.0.0.1:${hubPort}`, ttsBaseUrl: `http://127.0.0.1:${ttsPort}`, ttsToken: '' },
      gateway: new K20Gateway('study'),
    })

    try {
      const ann = await hostWeb.dispatch('POST', '/v1/companion/announce', { text: '回来啦。灯给你留着。今天很累。第四句不该出现。' }, authHeaders())
      expect(ann.status).toBe(200)
      expect(ann.body).toEqual({ text: '回来啦。灯给你留着。今天很累。', audio_id: null })
      expect(seen).toHaveLength(1)
      expect(seen[0]?.path).toBe('/v1/speak')
      expect(seen[0]?.body.voice).toBe('shorekeeper')
      expect(seen[0]?.body.play_only).toBe(true)
      expect(String(seen[0]?.body.turn_id)).toMatch(/^ann-/)

      const stop = await hostWeb.dispatch('POST', '/v1/companion/stop', {}, authHeaders())
      expect(stop.status).toBe(200)
      expect(stop.body).toEqual({ ok: true })
      expect(seen).toHaveLength(2)
      expect(seen[1]?.path).toBe('/v1/stop')

      const empty = await hostWeb.dispatch('POST', '/v1/companion/announce', { text: '   ' }, authHeaders())
      expect(empty.status).toBe(400)
      expect((empty.body as { error?: { code?: string } }).error?.code).toBe('bad_request')
    } finally {
      tts.close()
      hub.close()
    }
  })

  it('devices prefix 注册不带尾斜杠（宿主按段匹配的坑）', () => {
    const devices = web.routes.find((r) => r.path.startsWith('/v1/devices'))
    // companion 面里 announce/stop 已改 exact 直连（语音直连），大脑代理的 prefix 排在它们后面
    const companion = web.routes.find((r) => r.kind === 'prefix' && r.path.startsWith('/v1/companion'))
    expect(devices?.path).toBe('/v1/devices')
    expect(companion?.path).toBe('/v1/companion')
    expect(web.routes.find((r) => r.kind === 'exact' && r.path === '/v1/companion/announce')).toBeTruthy()
    expect(web.routes.find((r) => r.kind === 'exact' && r.path === '/v1/companion/stop')).toBeTruthy()
  })

  it('companion 代理在位时快照带 companion.ready=true（app 语音门）；置空时不带', async () => {
    // 默认注册 upstream 为空 → 不带
    let snap = (await web.dispatch('GET', '/v1/snapshot', undefined, authHeaders())).body as Record<string, unknown>
    expect(snap).not.toHaveProperty('companion')

    // upstream 在位 → ready
    const web2 = createMockWebServer()
    const gateway2 = new K20Gateway('study')
    registerK20Server({
      ctx: { effect: (fn: () => void) => fn() } as never,
      webServer: web2,
      config: { token: TOKEN, serverName: 'study', companionUpstream: 'http://127.0.0.1:17890', hubUpstream: 'http://127.0.0.1:17890', ttsBaseUrl: '', ttsToken: '' },
      gateway: gateway2,
    })
    snap = (await web2.dispatch('GET', '/v1/snapshot', undefined, authHeaders())).body as Record<string, unknown>
    expect(snap.companion).toMatchObject({ ready: true, voice: true })
  })

  it('长轮询：since=当前 seq 时挂住，bump 后立刻醒；不带 since 立即返回', async () => {
    const pending = web.dispatch('GET', '/v1/snapshot?since=0&wait=5', undefined, authHeaders())
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(settled).toBe(false)
    gateway.setCaption({ text: '醒', at: new Date().toISOString() })
    const res = await pending
    expect(res.status).toBe(200)
    expect((res.body as { seq: number }).seq).toBe(1)

    const immediate = await web.dispatch('GET', '/v1/snapshot', undefined, authHeaders())
    expect(immediate.status).toBe(200)
  })

  it('长轮询超时是正常情况：wait 到点返回当前 snapshot', async () => {
    const res = await web.dispatch('GET', '/v1/snapshot?since=999&wait=0', undefined, authHeaders())
    expect(res.status).toBe(200)
    expect((res.body as { seq: number }).seq).toBe(0)
  })
})
