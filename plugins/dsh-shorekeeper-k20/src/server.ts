/** k20 屏网关服务端（T7 直链第一步）。
 *
 * 在 DSH 宿主的 webServer 上把 lan-protocol v1 服务化，让 k20 app 可以直连 dsh：
 * 现役面六张——/health（免鉴权）、/v1/snapshot（Bearer + 长轮询）、/v1/caption、
 * /v1/phone/layout、/v1/lock、/v1/devices/{id}/command（media 乐观应答，其余 404）。
 * companion 面代理到 companionUpstream（默认旧 hub：她的语音链 T3/T4 前还长在那边），
 * 置空则按协议「可关」语义整面 404。
 *
 * 注册方式对齐 dsh-obmc-web 的先例：`inject ['webServer']` 的宿主里
 * `webServer.register({kind: 'exact'|'prefix', path, handler})`，handler 是
 * Node 原生 (req, res)。宿主没有 webServer（tui profile 等）时安静跳过。
 *
 * 设计取舍（真机校准点 ⏸）：
 * - snapshot 只发协议要求的最小集：未接的面（temperature/companion/photos…）整个省略；
 *   pc 是唯一例外——app 的熄屏判定靠 pc.online，缺字段会被读成「还没数据=保持醒着」
 *   （2026-11-05 熄屏回归实证），所以 pc 永远给出，订阅断/过期时退 online:false；
 * - `phone` 只在写过 /v1/phone/layout 后才带上（phone.rev 恒 0；带默认外观有把
 *   真机本地设置打回出厂的风险，等 W6 真机确认 app 的 rev 语义后再放开）；
 * - media 没有真实源，只做命令乐观应答（协议明文允许「可用上次命令的乐观值」）；
 * - 鉴权用插件 config.token（与安卓共享那枚），宿主浏览器登录门不拦插件路由，
 *   所以每条路由自带 Bearer 检查。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { request as httpRequest } from 'node:http'
import type { Context, Disposable } from '@deepseek-ai/cordis'
import type { CaptionState, CompanionState, LockState, MediaState, PcState, PhoneLayout, PhoneModulePatch, PhotoIds, Snapshot } from './types.ts'

/** pc 样本的有效期：真 hub 的探针 stale_ms 是 12s，这里放宽到 60s——
 *  长轮询本身 25s 一轮，太紧会把正常的轮询间隔误判成探针断线。 */
const PC_STALE_MS = 60_000

/** 协议错误形状：4xx/5xx 一律 {error: {code, message}}（lan-protocol §7） */
interface HubErrorBody {
  error: { code: string; message: string }
}

const WAIT_CAP_SEC = 30
const SCALE_MIN = 60
const SCALE_MAX = 140
const RECT_MIN = 0
const RECT_MAX = 1

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } } satisfies HubErrorBody)
}

function readJsonBody(req: IncomingMessage, maxBytes = 256 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

/** Bearer 检查。token 至少 8 字符（config 层已管），这里只比对 */
function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization
  if (typeof header !== 'string') return false
  const match = /^Bearer (.+)$/.exec(header)
  return match !== null && match[1] === token
}

function nowIso(): string {
  return new Date().toISOString()
}

/** 长轮询挂起者：seq 变化时放行 */
interface Waiter {
  since: number
  resolve: () => void
}

/** 网关状态机：内存态，重启归零（app 用 rev/seq 增量语义消化，不丢功能） */
export class K20Gateway {
  private seq = 0
  private waiters: Waiter[] = []
  private caption: CaptionState | null = null
  private lock: LockState | null = null
  private media: MediaState | null = null
  private layout: PhoneLayout | null = null
  private companion: CompanionState | null = null
  private pc: PcState | null = null
  private pcAt = 0
  private photos: PhotoIds | null = null

  private readonly hubName: string

  constructor(hubName: string) {
    this.hubName = hubName
  }

  get currentSeq(): number {
    return this.seq
  }

  /** 任何变更后调用：递增 seq 并放行全部长轮询 */
  bump(): number {
    this.seq += 1
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) waiter.resolve()
    return this.seq
  }

  setCaption(state: CaptionState | null): void {
    this.caption = state
    this.bump()
  }

  getCaption(): CaptionState | null {
    return this.caption
  }

  setLock(): LockState {
    this.lock = { requested_at: nowIso() }
    this.bump()
    return this.lock
  }

  /** media 命令乐观应答：toggle 翻转播放态，next/previous 维持 */
  applyMediaCommand(action: 'toggle' | 'next' | 'previous'): MediaState {
    const playing = this.media?.playing ?? false
    const next: MediaState = {
      online: true,
      playing: action === 'toggle' ? !playing : playing,
      updated_at: nowIso(),
    }
    this.media = next
    this.bump()
    return next
  }

  getMedia(): MediaState | null {
    return this.media
  }

  /**
   * 布局写入：服务端递增 layout.rev，槽位矩形合并（部分给，缺省保留现值）。
   * 非法矩形（出画布 0–1）抛 RangeError，由路由层转 400。
   */
  applyLayoutPatch(patch: Record<string, PhoneModulePatch>): PhoneLayout {
    for (const [id, rect] of Object.entries(patch)) {
      if (typeof rect !== 'object' || rect === null) {
        throw new RangeError(`layout.modules.${id} 必须是对象`)
      }
      for (const key of ['x', 'y', 'w', 'h'] as const) {
        const value = rect[key]
        if (value !== undefined && (typeof value !== 'number' || value < RECT_MIN || value > RECT_MAX)) {
          throw new RangeError(`layout.modules.${id}.${key} 必须在 ${RECT_MIN}–${RECT_MAX}`)
        }
      }
      if (rect.visible !== undefined && typeof rect.visible !== 'boolean') {
        throw new RangeError(`layout.modules.${id}.visible 必须是布尔`)
      }
    }
    const modules: PhoneLayout['modules'] = {}
    for (const [id, rect] of Object.entries(this.layout?.modules ?? {})) {
      modules[id] = { ...rect }
    }
    for (const [id, rect] of Object.entries(patch)) {
      const prev = modules[id] ?? { x: 0, y: 0, w: 0.2, h: 0.2, visible: true }
      modules[id] = {
        x: rect.x ?? prev.x,
        y: rect.y ?? prev.y,
        w: rect.w ?? prev.w,
        h: rect.h ?? prev.h,
        visible: rect.visible ?? prev.visible,
        ...(rect.chrome !== undefined || prev.chrome !== undefined
          ? { chrome: rect.chrome ?? prev.chrome }
          : {}),
      }
    }
    this.layout = { rev: (this.layout?.rev ?? 0) + 1, modules }
    this.bump()
    return this.layout
  }

  getLayout(): PhoneLayout | null {
    return this.layout
  }

  /** 等待 seq 越过 since；最多 waitSec 秒（上限 30）。返回是否真有变化 */
  async waitForChange(since: number, waitSec: number): Promise<boolean> {
    if (this.seq > since) return true
    const capped = Math.min(Math.max(0, waitSec), WAIT_CAP_SEC)
    if (capped <= 0) return this.seq > since
    return new Promise((resolve) => {
      const waiter: Waiter = {
        since,
        resolve: () => {
          clearTimeout(timer)
          resolve(true)
        },
      }
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        resolve(this.seq > since)
      }, capped * 1000)
      this.waiters.push(waiter)
    })
  }

  /** companion 面可用性（app 的语音门：snapshot.companion.ready 才把话送进 chat） */
  setCompanion(state: CompanionState | null): void {
    this.companion = state
  }

  /** 喂 pc（来自真 hub 的 snapshot 订阅，index.ts 接线）。内容变了才 bump，
   *  免得每个轮询周期都惊动一遍长轮询等待者。 */
  setPc(state: PcState | null): void {
    this.pcAt = state === null ? 0 : Date.now()
    const prev = this.pc
    this.pc = state
    if (JSON.stringify(prev) !== JSON.stringify(state)) this.bump()
  }

  /** 喂相框名单（F37，来自真 hub 的 snapshot.photos）。名单变了才 bump，
   *  长轮询立刻叫醒 app 刷新相框。没图/相册没开传 null。 */
  setPhotos(state: PhotoIds | null): void {
    const prev = this.photos
    this.photos = state !== null && state.ids.length > 0 ? state : null
    if (JSON.stringify(prev) !== JSON.stringify(this.photos)) this.bump()
  }

  /** 相框名单（/v1/photos 名单面）。相册没开是空列表，不算错（同 hub）。 */
  photoIds(): string[] {
    return this.photos?.ids ?? []
  }

  /** pc 对 app 的语义必须完整：缺 pc = 「还没数据 = 保持醒着」（DockViewModel
   *  noteDeskPc 的分支），熄屏链路会断——所以这里永远给出 pc。
   *  真样本过期（PC_STALE_MS）或从未有过 → online:false，对齐真 hub 的
   *  「探针过期即离线」语义（hub 侧 stale_ms 12s）。 */
  private pcState(): PcState {
    if (this.pc !== null && Date.now() - this.pcAt <= PC_STALE_MS) return this.pc
    return { online: false, updated_at: this.pc?.updated_at ?? '' }
  }

  /** 组 snapshot：协议最小集（未接的面整个省略；phone 只在写过布局后带）。
   *  pc 是例外：永远给出（缺了 app 读成醒着，见 pcState 注释）。 */
  snapshot(): Snapshot {
    const snap: Snapshot = {
      protocol: 1,
      seq: this.seq,
      hub: { name: this.hubName, mijia: 'ok', message: null },
      temperature: null,
      pc: this.pcState(),
      devices: [],
      media: this.media,
    }
    if (this.layout !== null) {
      snap.phone = {
        rev: 0,
        tile: { style: 'ink', opacity: 42, corner: 20 },
        type: { font: 'system', clock: 88, stats: 20, tile: 15, chip: 15 },
        screen: { keep_on: true, sleep_sec: 60 },
        weather: { enabled: true, city: '上海' },
        layout: { rev: this.layout.rev, modules: this.layout.modules },
      }
    }
    if (this.caption !== null) snap.caption = this.caption
    if (this.lock !== null) snap.lock = this.lock
    if (this.companion !== null) snap.companion = this.companion
    if (this.photos !== null) snap.photos = this.photos
    return snap
  }
}

export interface K20ServerDeps {
  ctx: Context
  /** 宿主 webServer（register 返回注销句柄，宿主契约见 dsh-obmc-web 先例） */
  webServer: {
    register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }): Disposable
  }
  config: { token: string; serverName: string; companionUpstream: string; hubUpstream: string }
  gateway: K20Gateway
}

/** 把全部路由挂上宿主 webServer。handler 全部自带错误兜底（异常转 500 JSON） */
export function registerK20Server(deps: K20ServerDeps): void {
  const { ctx, webServer, config, gateway } = deps
  const token = config.token

  // companion 面可用（代理在位）→ 快照带 ready=true，app 的语音门才开；
  // 置空 upstream 时保持 404 语义，快照不带 companion，语音照旧被 app 拦下。
  if (config.companionUpstream.trim() !== '') {
    gateway.setCompanion({ ready: true, voice: true, speaking: false, timer: null })
  }

  const register = (route: Parameters<typeof webServer.register>[0], label: string): void => {
    try {
      ctx.effect(() => webServer.register(route), label)
    } catch (error) {
      ctx.logger?.('k20')?.warn?.(`注册 ${label} 失败：%s`, error instanceof Error ? error.message : String(error))
    }
  }

  /** 包一层：鉴权 + 异常兜底。GET /health 不走这层 */
  const guarded = (
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  ): ((req: IncomingMessage, res: ServerResponse) => Promise<void>) => {
    return async (req, res) => {
      try {
        if (!authorized(req, token)) {
          sendError(res, 401, 'unauthorized', '缺 Authorization 或 token 不对')
          return
        }
        await handler(req, res)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message === 'invalid json') {
          sendError(res, 400, 'bad_request', '请求体不是合法 JSON')
          return
        }
        if (message === 'body too large') {
          sendError(res, 413, 'too_large', '请求体过大')
          return
        }
        if (error instanceof RangeError) {
          sendError(res, 400, 'bad_request', message)
          return
        }
        ctx.logger?.('k20')?.warn?.('[k20 网关] 处理异常：%s', message)
        sendError(res, 500, 'internal', '网关内部错误')
      }
    }
  }

  // —— /health：免鉴权，安卓探活与设置页确认（lan-protocol §6.1）——
  register(
    {
      kind: 'exact',
      path: '/health',
      handler: (_req, res) => {
        sendJson(res, 200, { ok: true, service: 'dock-hub', protocol: 1, name: config.serverName })
      },
    },
    'k20 网关 /health',
  )

  // —— /v1/snapshot：Bearer + 长轮询 since/wait ——
  register(
    {
      kind: 'exact',
      path: '/v1/snapshot',
      handler: guarded(async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const sinceRaw = url.searchParams.get('since')
        const waitRaw = url.searchParams.get('wait')
        if (sinceRaw !== null) {
          const since = Number.parseInt(sinceRaw, 10)
          if (!Number.isFinite(since)) {
            sendError(res, 400, 'bad_request', 'since 必须是整数')
            return
          }
          const wait = waitRaw !== null ? Number.parseInt(waitRaw, 10) || 0 : 0
          await gateway.waitForChange(since, Number.isFinite(wait) ? wait : 0)
        }
        sendJson(res, 200, gateway.snapshot())
      }),
    },
    'k20 网关 /v1/snapshot',
  )

  // —— /v1/caption：推/清字幕（协议增补提案契约）——
  register(
    {
      kind: 'exact',
      path: '/v1/caption',
      handler: guarded(async (req, res) => {
        if (req.method !== 'POST') {
          sendError(res, 405, 'method_not_allowed', '字幕只收 POST')
          return
        }
        const body = (await readJsonBody(req)) as { text?: unknown; clear?: unknown; scale?: unknown }
        if (body.clear === true) {
          gateway.setCaption(null)
          sendJson(res, 200, { ok: true })
          return
        }
        if (typeof body.text !== 'string' || !body.text.trim()) {
          sendError(res, 400, 'bad_request', 'text 与 clear 至少给一个')
          return
        }
        let scale: number | undefined
        if (body.scale !== undefined) {
          if (typeof body.scale !== 'number' || body.scale < SCALE_MIN || body.scale > SCALE_MAX) {
            sendError(res, 400, 'bad_request', `scale 必须在 ${SCALE_MIN}–${SCALE_MAX}`)
            return
          }
          scale = body.scale
        }
        gateway.setCaption({ text: body.text.trim(), at: nowIso(), ...(scale !== undefined ? { scale } : {}) })
        sendJson(res, 200, { ok: true })
      }),
    },
    'k20 网关 /v1/caption',
  )

  // —— /v1/phone/layout：布局补丁写入，服务端递增 layout.rev ——
  register(
    {
      kind: 'exact',
      path: '/v1/phone/layout',
      handler: guarded(async (req, res) => {
        if (req.method !== 'POST') {
          sendError(res, 405, 'method_not_allowed', '布局只收 POST')
          return
        }
        const body = (await readJsonBody(req)) as { layout?: { modules?: Record<string, PhoneModulePatch> } }
        const modules = body.layout?.modules
        if (typeof modules !== 'object' || modules === null) {
          sendError(res, 400, 'bad_request', 'layout.modules 必须是对象')
          return
        }
        gateway.applyLayoutPatch(modules)
        sendJson(res, 200, { ok: true })
      }),
    },
    'k20 网关 /v1/phone/layout',
  )

  // —— /v1/lock：熄屏请求（高危闸门在工具层；安卓侧消费点真机校准 ⏸）——
  register(
    {
      kind: 'exact',
      path: '/v1/lock',
      handler: guarded(async (req, res) => {
        if (req.method !== 'POST') {
          sendError(res, 405, 'method_not_allowed', '熄屏只收 POST')
          return
        }
        await readJsonBody(req)
        gateway.setLock()
        sendJson(res, 200, { ok: true })
      }),
    },
    'k20 网关 /v1/lock',
  )

  // —— /v1/devices/{id}/command：media 乐观应答；其余设备 id 未接 → 404 ——
  // ⚠️ prefix path 不带尾斜杠（宿主按段匹配，带 '/' 时子路径匹配不上，obmc 先例亦如此）
  register(
    {
      kind: 'prefix',
      path: '/v1/devices',
      handler: guarded(async (req, res) => {
        const path = (req.url ?? '').split('?')[0] ?? ''
        const match = /^\/v1\/devices\/([^/]+)\/command\/?$/.exec(path)
        if (!match || req.method !== 'POST') {
          sendError(res, 404, 'not_found', '未知接口')
          return
        }
        const id = decodeURIComponent(match[1] ?? '')
        if (id === '' || id !== 'media') {
          sendError(res, 404, 'not_found', `未知设备 id：${id}`)
          return
        }
        const body = (await readJsonBody(req)) as { media?: unknown }
        const action = body.media
        if (action !== 'toggle' && action !== 'next' && action !== 'previous') {
          sendError(res, 400, 'bad_request', 'media 只收 toggle / next / previous')
          return
        }
        sendJson(res, 200, gateway.applyMediaCommand(action))
      }),
    },
    'k20 网关 /v1/devices/*',
  )

  // —— /v1/companion/*：代理到伴侣大脑（默认旧 hub）——
  // 她的语音链（chat/stop/announce/memory/audio）T3/T4 之前还长在 hub 上：
  // 网关把整个 companion 面原样转发（Authorization 同一枚 token），流式回传
  // （audio 是 wav 字节流）。companionUpstream 置空则回到「可关」404 语义。
  // ⚠️ prefix path 不带尾斜杠（同 devices）。
  register(
    {
      kind: 'prefix',
      path: '/v1/companion',
      handler: guarded(async (req, res) => {
        const upstream = config.companionUpstream.trim()
        if (upstream === '') {
          sendError(res, 404, 'companion_disabled', '伴侣面未接入网关（companionUpstream 未配置）')
          return
        }
        proxyRequest(req, res, upstream, ctx, 'companion')
      }),
    },
    'k20 网关 /v1/companion/*（代理伴侣面）',
  )

  // —— F37 回忆相框：名单本地答，字节代理真 hub ——
  // 名单来自 watcher 喂进来的 snapshot.photos（≤25s 新鲜度，对相框足够）；
  // 字节走真 hub /v1/photos/:id（原样透传状态码/ETag/Content-Type，304 直通）。
  register(
    {
      kind: 'exact',
      path: '/v1/photos',
      handler: guarded(async (_req, res) => {
        sendJson(res, 200, { ids: gateway.photoIds() })
      }),
    },
    'k20 网关 /v1/photos（F37 名单）',
  )

  register(
    {
      kind: 'prefix',
      path: '/v1/photos/',
      handler: guarded(async (req, res) => {
        const upstream = config.hubUpstream.trim()
        if (upstream === '') {
          sendError(res, 404, 'photos_disabled', '真 hub 未接入（hubUpstream 未配置）')
          return
        }
        proxyRequest(req, res, upstream + (req.url ?? ''), ctx, 'photos')
      }),
    },
    'k20 网关 /v1/photos/*（代理真 hub 照片字节）',
  )
}

/** 把请求原样转发到 upstream（保留 method/Authorization/content-type，流式回传响应） */
function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  upstream: string,
  ctx: Context,
  label: string,
): void {
  let target: URL
  try {
    target = new URL(upstream)
  } catch {
    sendError(res, 500, 'bad_upstream', `companionUpstream 不是合法 URL：${upstream}`)
    return
  }
  const headers: Record<string, string> = {}
  for (const name of ['authorization', 'content-type', 'content-length', 'accept'] as const) {
    // content-length 必须带上：丢了会变 chunked，hub 的 BaseHTTPRequestHandler 不认，读到 0 字节
    const value = req.headers[name]
    if (typeof value === 'string') headers[name] = value
  }
  const upstreamReq = httpRequest(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: req.url ?? '/',
      headers,
    },
    (upstreamRes) => {
      if (res.headersSent) {
        upstreamRes.destroy()
        return
      }
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
      upstreamRes.pipe(res)
    },
  )
  upstreamReq.on('error', (error) => {
    ctx.logger?.('k20')?.warn?.(`[k20 网关] ${label} upstream 失败：%s`, error instanceof Error ? error.message : String(error))
    if (!res.headersSent) sendError(res, 502, 'upstream_error', `${label} 上游不可达（${target.host}）`)
    else res.destroy()
  })
  req.pipe(upstreamReq)
}
