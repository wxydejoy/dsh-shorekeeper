/** dsh-shorekeeper-k20 —— k20 安卓屏驱动。
 *
 * 插件族规范（仓库根 README.md）：TS 模块、入口 apply(ctx)、注册工具前 inject ['tools']。
 * 配置按 Schemastery（src/config.ts），工具面见 src/tools.ts 与插件 README。
 */

import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createDeskVoice, type VoiceSessions } from './companion-voice.ts'
import { HubClient } from './hub-client.ts'
import { BackgroundClient, BackgroundRequestError } from './background-client.ts'
import { createPosterStore, type PosterStore } from './poster.ts'
import {
  UploadRejected,
  admitUpload,
  assertContent,
  describeLimits,
  extensionsOf,
  guardStream,
  normalizeLimits,
  peekHead,
  type BackgroundKind,
  type UploadLimits,
} from './upload-guard.ts'
import { GatewayClient } from './gateway.ts'
import { createK20Tools } from './tools.ts'
import { Config, hubBaseUrl, backgroundBaseUrl, type K20Config } from './config.ts'
import { K20Gateway, registerK20Server } from './server.ts'
import type { LocalScreen } from './tools.ts'
import { loadLayout, writeLayoutFile, layoutFilePath } from './layout-store.ts'
import type { PhoneModulePatch } from './types.ts'

// tools 必需；webServer 必需（cordis 4.0.5 只认 string[] 形式，obmc-web 同款先例）
// connection：主屏布局页面 /k20-layout
export const inject = ['tools', 'webServer', 'connection', 'sessionController']

export { Config }

export function apply(ctx: Context, config: K20Config): void {
  const hub = new HubClient({ baseUrl: hubBaseUrl(config), token: config.token })
  const background = new BackgroundClient({ baseUrl: backgroundBaseUrl(config), token: config.token })
  const gateway = new GatewayClient({ baseUrl: hubBaseUrl(config), token: config.token })
  const layoutFile = layoutFilePath()
  const savedLayout = loadLayout(layoutFile)
  const layoutBridge: { apply: ((modules: Record<string, PhoneModulePatch>) => ReturnType<K20Gateway['applyLayoutPatch']>) | null } = {
    apply: null,
  }
  const screen: LocalScreen = {
    snapshot: null,
    pushCaption: null,
    clearCaption: null,
    lock: null,
    media: null,
  }

  for (const tool of createK20Tools({ hub, background, gateway, config, localLayout: layoutBridge, screen })) {
    ctx.tools.register(tool)
  }

  // pc.online 只看 POST /v1/desk。不再长轮询旧 hub。
  // 小软件还没装上时，屏保持离线（压黑），避免再把 :17890 当成在线位的来源。

  // —— T7 直链：宿主有 webServer 且 serve 开启时，把 lan-protocol 服务化 ——
  // 客户端三面不自动改指向：部署时把插件 config 的 hubHost/port 指到本实例即可
  // （如 http://10.14.14.117:3090），工具与网关路由同源。
  if (!config.serve) return
  const webServer = getWebServer(ctx)
  if (webServer === undefined) {
    ctx.logger('k20').warn('serve=true 但宿主没有 webServer 服务，网关路由未注册')
    return
  }
  const faceState = new K20Gateway(config.serverName ?? 'study')
  if (savedLayout) faceState.adoptLayout(savedLayout)
  faceState.setLayoutListener((layout) => {
    try {
      writeLayoutFile(layoutFile, layout)
    } catch (error) {
      ctx.logger('k20').warn('布局落盘失败：%s', error instanceof Error ? error.message : String(error))
    }
  })
  layoutBridge.apply = (modules) => faceState.applyLayoutPatch(modules)
  screen.snapshot = () => faceState.snapshot()
  screen.pushCaption = (text, scale) => {
    faceState.setCaption({ text, at: new Date().toISOString(), scale })
  }
  screen.clearCaption = () => faceState.setCaption(null)
  screen.lock = () => faceState.setLock()
  screen.media = (action) => faceState.applyMediaCommand(action)
  const sessions = readVoiceSessions(ctx)
  const voice = sessions === undefined
    ? undefined
    : createDeskVoice({
        events: ctx as unknown as Parameters<typeof createDeskVoice>[0]['events'],
        sessions,
        sessionFile: join(homedir(), '.dsh', 'k20-voice-session.json'),
        cwd: join(homedir(), 'dsh-shorekeeper'),
        log: (message) => ctx.logger('k20').warn(message),
      })
  if (voice === undefined) ctx.logger('k20').warn('没有 sessionController，手机对话未接上')
  // 网关必须先挂。布局页走 connection.rpc 时会在 connection 自己的 fiber 上取 webServer，
  // 那边没注入就会抛，若抛在 registerK20Server 之前，手机的 /health 和快照一起没了。
  registerK20Server({
    ctx,
    webServer,
    config: {
      token: config.token,
      serverName: config.serverName ?? 'study',
      companionUpstream: config.companionUpstream?.trim() ?? '',
      hubUpstream: '',
      ttsBaseUrl: config.ttsBaseUrl ?? 'http://127.0.0.1:18100',
      ttsToken: config.ttsToken ?? '',
    },
    gateway: faceState,
    ...(voice !== undefined ? { voice } : {}),
  })
  // 微信灯控快路径把同一句短句推上屏。走本进程的模拟面，长轮询会把字幕带给 k20。
  ;(globalThis as { __shorekeeperPushCaption?: (text: string) => void }).__shorekeeperPushCaption = (text: string) => {
    const line = text.trim()
    if (line === '') {
      faceState.setCaption(null)
      return
    }
    faceState.setCaption({ text: line, at: new Date().toISOString(), scale: config.captionScale })
  }
  ctx.logger('k20').info('k20 网关已挂上宿主 webServer（/health /v1/snapshot /v1/desk /v1/caption /v1/phone/layout /v1/lock /v1/devices/* /v1/companion/announce|stop|chat）')
  try {
    registerLayoutPanel(ctx, {
      background,
      gateway: faceState,
      limits: normalizeLimits({
        imageMB: config.backgroundImageMaxMB,
        videoMB: config.backgroundVideoMaxMB,
      }),
    })
  } catch (error) {
    ctx.logger('k20').warn('主屏布局页没挂上：%s', error instanceof Error ? error.message : String(error))
  }
}

interface WebServerLike {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => unknown }): () => unknown
}

/** optional 注入 + 软取双保险：cordis 把注入服务挂 ctx 属性，缺失时不抛 */
interface LayoutPanelDeps {
  background: BackgroundClient
  gateway: K20Gateway
  limits: UploadLimits
}

/** 主屏布局页。读手机上的画布/槽位/默认值，保存写进本网关并落盘。 */
function registerLayoutPanel(ctx: Context, deps: LayoutPanelDeps): void {
  const channel = '/k20-layout'
  const handle = async (action: string, raw: unknown): Promise<unknown> => {
    const payload = raw && typeof raw === 'object' ? (raw as { modules?: Record<string, PhoneModulePatch>; id?: unknown }) : {}
    try {
      if (action === 'backgrounds') {
        return { ok: true, value: await deps.background.backgrounds() }
      }
      if (action === 'limits') {
        return {
          ok: true,
          value: {
            imageMB: deps.limits.imageMB,
            videoMB: deps.limits.videoMB,
            imageExts: extensionsOf('image'),
            videoExts: extensionsOf('video'),
            hint: describeLimits(deps.limits),
          },
        }
      }
      if (action === 'select') {
        if (typeof payload.id !== 'string' || payload.id === '') {
          throw Object.assign(new Error('select 需要 id'), { code: 'bad_request' })
        }
        return { ok: true, value: await deps.background.select(payload.id) }
      }
      if (action === 'remove') {
        if (typeof payload.id !== 'string' || payload.id === '') {
          throw Object.assign(new Error('remove 需要 id'), { code: 'bad_request' })
        }
        return { ok: true, value: await deps.background.remove(payload.id) }
      }
      if (action === 'clear') {
        return { ok: true, value: await deps.background.clear() }
      }
      if (action === 'snapshot') {
        let phone: unknown = null
        let phoneError: string | null = null
        try {
          phone = await deps.background.layout()
        } catch (error) {
          phoneError = error instanceof Error ? error.message : String(error)
        }
        return { ok: true, value: { phone, phoneError, saved: deps.gateway.getLayout() } }
      }
      if (action === 'save') {
        const modules = payload.modules
        if (typeof modules !== 'object' || modules === null) {
          throw Object.assign(new Error('modules 必须是对象'), { code: 'bad_request' })
        }
        const next = deps.gateway.replaceLayout(modules)
        return { ok: true, value: { rev: next.rev, modules: next.modules } }
      }
      throw Object.assign(new Error(`unknown action: ${action}`), { code: 'bad_action' })
    } catch (rawError) {
      const error = rawError as { code?: unknown; message?: unknown; details?: unknown }
      return {
        ok: false,
        error: {
          code: String(error.code || 'k20-layout/error'),
          message: String(error.message || rawError),
          details: error.details && typeof error.details === 'object' ? error.details : {},
        },
      }
    }
  }

  // 不用 connection.rpc.handle。那条通道在 connection 自己的 fiber 上取 webServer，
  // 那边没注入，一调就把整个插件激活失败，手机的 /health 和快照一起消失
  // （2026-11-06：屏上因此报连不上 Hub）。布局页改由本插件已注入的 webServer 直挂。
  const webServer = getWebServer(ctx)
  if (webServer === undefined) {
    ctx.logger('k20').warn('没有 connection 也没有 webServer，主屏布局页未挂')
    return
  }
  registerLayoutChannel(ctx, webServer, channel, handle)
  registerBackgroundRoutes(ctx, webServer, deps.background, deps.limits, createPosterStore({
    background: deps.background,
    log: (message) => ctx.logger('k20').warn(message),
  }))
}

/** 壁纸/背景的二进制通道：缩略图与预览流、上传流。
 *
 * 浏览器不直连手机 :17920（跨源 + cookie 在别人手里），这里由插件代持会话转发。
 * RPC 只传元数据（列表/切换/删除/清空），字节走这两条 HTTP 路由。
 *
 * 上传闸门（2026-11-15）：手机端不限大小也不验格式，所以扩展名白名单、魔数嗅探、
 * 图片/视频分开的大小上限都在这里做——超限直接 413/415，不往手机传半截。
 */
function registerBackgroundRoutes(
  ctx: Context,
  webServer: WebServerLike,
  background: BackgroundClient,
  limits: UploadLimits,
  posters: PosterStore,
): void {
  const prefix = '/k20-bg'
  type Res = import('node:http').ServerResponse
  type Req = import('node:http').IncomingMessage
  const fail = (res: Res, status: number, message: string): void => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: false, error: message }))
  }
  const json = (res: Res, value: unknown): void => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: true, value }))
  }
  const route = {
    kind: 'prefix' as const,
    path: prefix,
    handler: (req: Req, res: Res) => {
      void (async () => {
        const url = new URL(req.url ?? prefix, 'http://localhost')
        const rest = url.pathname.slice(prefix.length)
        try {
          if (req.method === 'GET' && rest === '/limits') {
            json(res, {
              imageMB: limits.imageMB,
              videoMB: limits.videoMB,
              imageExts: extensionsOf('image'),
              videoExts: extensionsOf('video'),
              hint: describeLimits(limits),
            })
            return
          }
          if (req.method === 'GET' && rest.startsWith('/media/')) {
            const id = decodeURIComponent(rest.slice('/media/'.length))
            if (id === '') {
              fail(res, 400, '缺少背景 id')
              return
            }
            const upstream = await background.mediaResponse(id)
            const headers: Record<string, string> = {
              'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
              'cache-control': 'private, max-age=120',
            }
            const length = upstream.headers.get('content-length')
            if (length !== null) headers['content-length'] = length
            res.writeHead(200, headers)
            if (upstream.body === null) {
              res.end()
              return
            }
            Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream<Uint8Array>).pipe(res)
            return
          }
          if (req.method === 'GET' && rest.startsWith('/poster/')) {
            const id = decodeURIComponent(rest.slice('/poster/'.length))
            if (id === '') {
              fail(res, 400, '缺少背景 id')
              return
            }
            const width = posterWidth(url.searchParams.get('w'))
            const index = await background.backgrounds()
            const item = index.items.find((entry) => entry.id === id)
            if (item === undefined) {
              fail(res, 404, '没有这个背景')
              return
            }
            const data = await readFile(await posters.get(item, width))
            res.writeHead(200, {
              'content-type': 'image/jpeg',
              'content-length': String(data.byteLength),
              'cache-control': 'private, max-age=3600',
            })
            res.end(data)
            return
          }
          if (req.method === 'POST' && rest === '/upload') {
            const filename = (url.searchParams.get('name') ?? '').trim()
            const realName = (url.searchParams.get('realname') ?? '').trim()
            if (filename === '') {
              fail(res, 400, '缺少文件名：/k20-bg/upload?name=海边.jpg&realname=守岸人')
              return
            }
            const rawKind = url.searchParams.get('kind')
            const kindHint: BackgroundKind | null =
              rawKind === 'image' || rawKind === 'video' ? rawKind : null
            const declared = Number(req.headers['content-length'])
            const declaredLength = Number.isFinite(declared) && declared > 0 ? declared : undefined
            const admission = admitUpload({ filename, declaredLength, kindHint, limits })
            // 先验头再连手机：内容不对要当场拒，不给手机留半截文件
            const peeked = await peekHead(req as unknown as AsyncIterable<Uint8Array>)
            assertContent(peeked.head, admission)
            const body = guardStream(peeked.head, peeked.rest, admission)
            const index = admission.declared === undefined
              // 没有 Content-Length（chunked）时先收齐：手机端按长度读，空长度会被当成没文件
              ? await background.upload(
                  filename,
                  new Uint8Array(await collect(body)),
                  realName === '' ? undefined : realName,
                )
              : await background.uploadStream(
                  filename,
                  body,
                  realName === '' ? undefined : realName,
                  admission.declared,
                )
            json(res, index)
            return
          }
          fail(res, 404, 'not found')
        } catch (error) {
          if (error instanceof UploadRejected) {
            fail(res, error.status, error.message)
            return
          }
          const status = error instanceof BackgroundRequestError ? (error.status === 503 ? 503 : 400) : 500
          fail(res, status, error instanceof Error ? error.message : String(error))
        }
      })()
      return undefined
    },
  }
  try {
    ctx.effect(() => webServer.register(route), 'k20: 背景壁纸通道')
    ctx.logger('k20').info(
      '背景壁纸通道已挂：%s/media/* %s/poster/* %s/upload %s/limits（%s）',
      prefix, prefix, prefix, prefix, describeLimits(limits),
    )
  } catch (error) {
    ctx.logger('k20').warn('背景壁纸通道挂载失败：%s', error instanceof Error ? error.message : String(error))
  }
}

/** 收齐请求体（只在拿不到 Content-Length 的 chunked 上传时用）。 */
async function collect(req: import('node:http').IncomingMessage | AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks)
}

/** 缩略图宽度：面板列表 320，布局预览板铺满要 960；其他值夹到 160–1600 */
function posterWidth(raw: string | null): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 320
  return Math.min(Math.max(Math.round(n), 160), 1600)
}

/** 按 connection rpc 的信封格式直挂前缀路由（wire 见 dsh-client-connection 的 rpcFetchHandler）。 */
function registerLayoutChannel(
  ctx: Context,
  webServer: WebServerLike,
  channel: string,
  handle: (action: string, payload: unknown) => Promise<unknown>,
): void {
  type Res = import('node:http').ServerResponse
  type Req = import('node:http').IncomingMessage
  const reply = (res: Res, status: number, result: unknown, rpcId: string): void => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ type: 'server-response', rpcId, result }))
  }
  const failure = (code: string, message: string): { ok: false; error: { code: string; message: string; details: Record<string, never> } } => ({
    ok: false,
    error: { code, message, details: {} },
  })
  const route = {
    kind: 'prefix' as const,
    path: channel,
    handler: (req: Req, res: Res) => {
      void (async () => {
        const url = new URL(req.url ?? channel, 'http://localhost')
        const endpoint = url.pathname.startsWith(`${channel}/`) ? url.pathname.slice(channel.length + 1) : ''
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
        let body: { rpcId?: unknown; method?: unknown; payload?: unknown }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body
        } catch {
          reply(res, 400, failure('gateway/bad-request', 'body is not JSON'), 'invalid')
          return
        }
        const rpcId = typeof body.rpcId === 'string' ? body.rpcId : 'invalid'
        if (req.method !== 'POST' || endpoint === '') {
          reply(res, 404, failure('gateway/not-found', 'not found'), rpcId)
          return
        }
        if (body.method !== endpoint) {
          reply(res, 200, failure('gateway/bad-request', `method ${JSON.stringify(body.method)} 与端点 ${JSON.stringify(endpoint)} 不一致`), rpcId)
          return
        }
        try {
          reply(res, 200, await handle(endpoint, body.payload), rpcId)
        } catch (error) {
          reply(res, 200, failure('k20-layout/error', String(error)), rpcId)
        }
      })()
      return undefined
    },
  }
  try {
    ctx.effect(() => webServer.register(route), 'k20: 主屏布局通道')
    ctx.logger('k20').info('主屏布局页已挂（webServer 直挂）：%s', channel)
  } catch (error) {
    ctx.logger('k20').warn('主屏布局页挂载失败：%s', error instanceof Error ? error.message : String(error))
  }
}

function readVoiceSessions(ctx: Context): VoiceSessions | undefined {
  const getter = (ctx as unknown as { get?: (name: string) => unknown }).get
  let ctl: SessionControlLike | undefined
  try {
    ctl = typeof getter === 'function' ? getter.call(ctx, 'sessionController') as SessionControlLike | undefined : undefined
  } catch {
    ctl = undefined
  }
  if (ctl === undefined || typeof ctl.create !== 'function' || typeof ctl.prompt !== 'function') return undefined
  const control = ctl
  return {
    async create(cwd: string): Promise<string> {
      const raw = await control.create({ cwd })
      const value = typeof raw === 'string' ? JSON.parse(raw) as { sessionId?: unknown; id?: unknown } : raw
      const id = value?.sessionId ?? value?.id
      if (typeof id !== 'string' || id === '') throw new Error('session not-found')
      return id
    },
    async prompt(sessionId: string, text: string): Promise<void> {
      await control.prompt({
        requestId: randomUUID(),
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      }, AbortSignal.timeout(20_000))
    },
    async cancel(sessionId: string): Promise<void> {
      if (typeof control.cancel !== 'function') return
      await control.cancel({ sessionId })
    },
  }
}

interface SessionControlLike {
  create: (request: { cwd: string }) => Promise<{ sessionId?: string; id?: string } | string>
  prompt: (request: { requestId: string; sessionId: string; mode: string; content: { type: string; text: string }[] }, signal: AbortSignal) => Promise<unknown>
  cancel?: (request: { sessionId: string }) => Promise<unknown>
}

function getWebServer(ctx: Context): WebServerLike | undefined {
  const candidates = [
    (ctx as unknown as { webServer?: unknown }).webServer,
    (ctx as { get?: (name: string) => unknown }).get?.('webServer'),
  ]
  for (const value of candidates) {
    if (value !== null && value !== undefined && typeof (value as { register?: unknown }).register === 'function') {
      return value as WebServerLike
    }
  }
  return undefined
}
