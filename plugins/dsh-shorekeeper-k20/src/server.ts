/** k20 屏网关服务端（T7 直链第一步）。
 *
 * 在 DSH 宿主的 webServer 上把 lan-protocol v1 服务化，让 k20 app 可以直连 dsh：
 * 现役面六张——/health（免鉴权）、/v1/snapshot（Bearer + 长轮询）、/v1/caption、
 * /v1/phone/layout、/v1/lock、/v1/devices/{id}/command（media 乐观应答，其余 404）。
 * 语音直连：/v1/companion/announce|stop 本地实现，直接打 keeper-tts（:18100 /v1/speak|/v1/stop）。
 * /v1/companion/chat 在接上书桌会话时本地回答；没接上、且 companionUpstream 为空时 404。
 * memory/audio 仍只在 companionUpstream 非空时转发。
 * pc.online 由 POST /v1/desk 心跳决定。从未收到心跳时，才沿用 setPc 喂进来的样本。
 *
 * 注册方式对齐 dsh-obmc-web 的先例：`inject ['webServer']` 的宿主里
 * `webServer.register({kind: 'exact'|'prefix', path, handler})`，handler 是
 * Node 原生 (req, res)。宿主没有 webServer（tui profile 等）时安静跳过。
 *
 * 设计取舍（真机校准点 ⏸）：
 * - snapshot 只发协议要求的最小集：未接的面（temperature/companion/photos…）整个省略；
 *   pc 是唯一例外——app 的熄屏判定靠 pc.online，缺字段会被读成「还没数据=保持醒着」
 *   （2026-11-05 熄屏回归实证），所以 pc 永远给出，订阅断/过期时退 online:false；
 * - `phone` 来自真 hub 快照（控制台主屏布局在这里）。本面只在 POST /v1/phone/layout
 *   且 rev 更高时盖住 layout；从没收到 phone、也没写过布局时整段省略
 *   （带默认外观有把真机本地设置打回出厂的风险）；
 * - media 没有真实源，只做命令乐观应答（协议明文允许「可用上次命令的乐观值」）；
 * - 鉴权用插件 config.token（与安卓共享那枚），宿主浏览器登录门不拦插件路由，
 *   所以每条路由自带 Bearer 检查。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { request as httpRequest } from 'node:http'
import type { Context, Disposable } from '@deepseek-ai/cordis'
import type { DeskVoice } from './companion-voice.ts'
import type { CaptionState, CompanionState, LockState, MediaState, PcState, PhoneLayout, PhoneModulePatch, PhoneState, PhotoIds, Snapshot } from './types.ts'

/** pc 样本的有效期：真 hub 的探针 stale_ms 是 12s，这里放宽到 60s——
 *  长轮询本身 25s 一轮，太紧会把正常的轮询间隔误判成探针断线。 */
const PC_STALE_MS = 60_000
/** Windows 小软件心跳过期：超过这个时间没有新拍，pc.online 变 false。不进配置。 */
const DESK_STALE_MS = 20_000

interface DeskBeat {
  online?: boolean
  cpu?: PcState['cpu']
  memory?: PcState['memory']
  gpu?: PcState['gpu']
}

/** 整数百分比变了才算一拍新指标，避免 5 秒一拍把长轮询打醒。 */
function mergeCpu(prev: PcState['cpu'], next: PcState['cpu']): PcState['cpu'] {
  if (next === undefined) return prev
  if (prev === undefined) return next
  const merged: NonNullable<PcState['cpu']> = { percent: next.percent }
  const temp = next.temp_celsius ?? prev.temp_celsius
  if (temp !== undefined) merged.temp_celsius = temp
  return merged
}

function mergeMemory(prev: PcState['memory'], next: PcState['memory']): PcState['memory'] {
  if (next === undefined) return prev
  if (prev === undefined) return next
  const merged: NonNullable<PcState['memory']> = { percent: next.percent }
  const used = next.used_gb ?? prev.used_gb
  const total = next.total_gb ?? prev.total_gb
  if (used !== undefined) merged.used_gb = used
  if (total !== undefined) merged.total_gb = total
  return merged
}

function mergeGpu(prev: PcState['gpu'], next: PcState['gpu']): PcState['gpu'] {
  if (next === undefined) return prev
  if (prev === undefined) return next
  const merged: NonNullable<PcState['gpu']> = {}
  const percent = next.percent ?? prev.percent
  const temp = next.temp_celsius ?? prev.temp_celsius
  const vram = next.vram_percent ?? prev.vram_percent
  const name = next.name ?? prev.name
  if (percent !== undefined) merged.percent = percent
  if (temp !== undefined) merged.temp_celsius = temp
  if (vram !== undefined) merged.vram_percent = vram
  if (name !== undefined) merged.name = name
  return merged
}

function deskMetricKey(beat: DeskBeat): string {
  const n = (value: number | undefined): number | null => (value === undefined ? null : Math.round(value))
  return JSON.stringify({
    c: beat.cpu === undefined ? null : [n(beat.cpu.percent), n(beat.cpu.temp_celsius)],
    m: beat.memory === undefined ? null : n(beat.memory.percent),
    g: beat.gpu === undefined ? null : [n(beat.gpu.percent), n(beat.gpu.temp_celsius), beat.gpu.name ?? null],
  })
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readCpu(value: unknown): PcState['cpu'] | undefined | 'bad' {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'bad'
  const percent = finite((value as { percent?: unknown }).percent)
  if (percent === null) return 'bad'
  const cpu: NonNullable<PcState['cpu']> = { percent }
  const temp = (value as { temp_celsius?: unknown }).temp_celsius
  if (temp !== undefined) {
    const parsed = finite(temp)
    if (parsed === null) return 'bad'
    cpu.temp_celsius = parsed
  }
  return cpu
}

function readMemory(value: unknown): PcState['memory'] | undefined | 'bad' {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'bad'
  const percent = finite((value as { percent?: unknown }).percent)
  if (percent === null) return 'bad'
  const memory: NonNullable<PcState['memory']> = { percent }
  const used = (value as { used_gb?: unknown }).used_gb
  const total = (value as { total_gb?: unknown }).total_gb
  if (used !== undefined) {
    const parsed = finite(used)
    if (parsed === null) return 'bad'
    memory.used_gb = parsed
  }
  if (total !== undefined) {
    const parsed = finite(total)
    if (parsed === null) return 'bad'
    memory.total_gb = parsed
  }
  return memory
}

function readGpu(value: unknown): PcState['gpu'] | undefined | 'bad' {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'bad'
  const raw = value as { percent?: unknown; temp_celsius?: unknown; name?: unknown; vram_percent?: unknown }
  const gpu: NonNullable<PcState['gpu']> = {}
  if (raw.percent !== undefined) {
    const parsed = finite(raw.percent)
    if (parsed === null) return 'bad'
    gpu.percent = parsed
  }
  if (raw.temp_celsius !== undefined) {
    const parsed = finite(raw.temp_celsius)
    if (parsed === null) return 'bad'
    gpu.temp_celsius = parsed
  }
  if (raw.vram_percent !== undefined) {
    const parsed = finite(raw.vram_percent)
    if (parsed === null) return 'bad'
    gpu.vram_percent = parsed
  }
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || raw.name.trim() === '') return 'bad'
    gpu.name = raw.name.trim()
  }
  if (gpu.percent === undefined && gpu.temp_celsius === undefined && gpu.vram_percent === undefined && gpu.name === undefined) {
    return 'bad'
  }
  return gpu
}

/** 协议错误形状：4xx/5xx 一律 {error: {code, message}}（lan-protocol §7） */
interface HubErrorBody {
  error: { code: string; message: string }
}

const WAIT_CAP_SEC = 30
const SCALE_MIN = 60
const SCALE_MAX = 140
const RECT_MIN = 0
const RECT_MAX = 1

function copyModules(modules: PhoneLayout['modules']): PhoneLayout['modules'] {
  const copy: PhoneLayout['modules'] = {}
  for (const [id, rect] of Object.entries(modules)) copy[id] = { ...rect }
  return copy
}

/** 拖拽会把坐标算出 NaN / 略超 0–1。按错误打回的话 rev 不加，手机一直忽略这版。 */
function unitInterval(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const n = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(n)) return 0
  if (n < RECT_MIN) return RECT_MIN
  if (n > RECT_MAX) return RECT_MAX
  return n
}

function assertRect(id: string, rect: PhoneModulePatch): void {
  if (typeof rect !== 'object' || rect === null || Array.isArray(rect)) {
    throw new RangeError(`layout.modules.${id} 必须是对象`)
  }
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    const value = rect[key]
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < RECT_MIN || value > RECT_MAX)) {
      throw new RangeError(`layout.modules.${id}.${key} 必须在 ${RECT_MIN}–${RECT_MAX}`)
    }
  }
  if (rect.visible !== undefined && typeof rect.visible !== 'boolean') {
    throw new RangeError(`layout.modules.${id}.visible 必须是布尔`)
  }
  if (rect.chrome !== undefined && typeof rect.chrome !== 'boolean') {
    throw new RangeError(`layout.modules.${id}.chrome 必须是布尔`)
  }
}

function normalizeRect(id: string, rect: PhoneModulePatch): PhoneModulePatch {
  if (typeof rect !== 'object' || rect === null || Array.isArray(rect)) {
    throw new RangeError(`layout.modules.${id} 必须是对象`)
  }
  const next: PhoneModulePatch = {}
  const x = unitInterval(rect.x)
  const y = unitInterval(rect.y)
  const w = unitInterval(rect.w)
  const h = unitInterval(rect.h)
  if (x !== undefined) next.x = x
  if (y !== undefined) next.y = y
  if (w !== undefined) next.w = w
  if (h !== undefined) next.h = h
  if (typeof rect.visible === 'boolean') next.visible = rect.visible
  if (typeof rect.chrome === 'boolean') next.chrome = rect.chrome
  return next
}

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

/** 对齐 hub speech.clip_announce：announce 只说短的，最多 3 句，兜底 160 字。 */
function clipAnnounce(text: string, maxSentences = 3): string {
  const stripped = (text || '').trim()
  if (stripped === '') return ''
  const sentences = stripped.split(/(?<=[。！？!?…])/).map((s) => s.trim()).filter(Boolean)
  const head = sentences.slice(0, maxSentences).join('')
  if (head !== '') return head
  return stripped.length <= 160 ? stripped : stripped.slice(0, 159) + '…'
}

/** 免唤醒窗。问句多留一点时间。手机不认这个字段时会自己估。 */
function listenPolicy(text: string): { wait_ms: number; open_ms: number } {
  const wait = Math.min(text.length * 260 + 1500, 20_000)
  const open = /[？?]/.test(text) ? 20_000 : 8_000
  return { wait_ms: wait, open_ms: open }
}

/** 往 keeper-tts 发一个 JSON POST（语音直连）。永不 reject：连不上/超时/回包异常都 resolve null。 */
function postJsonToTts(
  base: string,
  path: string,
  body: unknown,
  token: string,
  timeoutMs: number,
): Promise<{ status: number } | null> {
  return new Promise((resolve) => {
    let url: URL
    try {
      url = new URL(path, base.endsWith('/') ? base : base + '/')
    } catch {
      resolve(null)
      return
    }
    const payload = Buffer.from(JSON.stringify(body), 'utf8')
    let settled = false
    const done = (value: { status: number } | null): void => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    const req = httpRequest(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(payload.length),
          ...(token !== '' ? { authorization: `Bearer ${token}` } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume()
        res.on('end', () => done({ status: res.statusCode ?? 0 }))
        res.on('close', () => done({ status: res.statusCode ?? 0 }))
      },
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => done(null))
    req.end(payload)
  })
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
  private layoutListener: ((layout: PhoneLayout) => void) | null = null
  /** 真 hub 快照里的 phone。本地已经有布局时只借用外观字段，layout 以本地为准。 */
  private hubPhone: PhoneState | null = null
  private companion: CompanionState | null = null
  private pc: PcState | null = null
  private pcAt = 0
  /** 从未收到 /v1/desk 时为 null，pc.online 沿用下面的 hub 样本。 */
  private desk: DeskBeat & { at: number } | null = null
  /** 在线位上次变化的时刻。心跳重复报同一结果时不刷新。 */
  private deskChangeIso = ''
  /** 键鼠空闲秒数。不进 seq：每秒都在涨，不值得把长轮询打醒。 */
  private idleSec: number | null = null
  private idleAt = 0
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

  /** 落盘回调。adoptLayout 不触发，避免启动时把刚读到的文件再写一遍。 */
  setLayoutListener(listener: (layout: PhoneLayout) => void): void {
    this.layoutListener = listener
  }

  /** 启动时灌入已保存的布局，rev 保持原值（不递增，免得手机把同一版再套一遍）。 */
  adoptLayout(layout: PhoneLayout): void {
    this.layout = {
      rev: layout.rev,
      modules: copyModules(layout.modules),
    }
    this.bump()
  }

  /**
   * 协议写入：服务端递增 layout.rev，槽位矩形合并（部分给，缺省保留现值）。
   * 出了 0–1 的坐标抛 RangeError，路由层转 400。面板保存走 replaceLayout，那边会收进画布。
   */
  applyLayoutPatch(patch: Record<string, PhoneModulePatch>): PhoneLayout {
    for (const [id, rect] of Object.entries(patch)) assertRect(id, rect)
    const baseModules = this.layout?.modules ?? this.hubPhone?.layout?.modules ?? {}
    const modules: PhoneLayout['modules'] = {}
    for (const [id, rect] of Object.entries(baseModules)) {
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
    const floor = Math.max(this.layout?.rev ?? 0, this.hubPhone?.layout?.rev ?? 0)
    this.layout = { rev: floor + 1, modules }
    this.bump()
    this.layoutListener?.(this.layout)
    return this.layout
  }

  /** 面板保存：整包替换要存的槽位（跟默认一样的槽位不在里面）。rev 只增。 */
  replaceLayout(modules: Record<string, PhoneModulePatch>): PhoneLayout {
    const cleaned: Record<string, PhoneModulePatch> = {}
    for (const [id, rect] of Object.entries(modules)) cleaned[id] = normalizeRect(id, rect)
    const stored: PhoneLayout['modules'] = {}
    for (const [id, rect] of Object.entries(cleaned)) {
      stored[id] = {
        x: rect.x ?? 0,
        y: rect.y ?? 0,
        w: rect.w ?? 0,
        h: rect.h ?? 0,
        visible: rect.visible ?? true,
        ...(rect.chrome !== undefined ? { chrome: rect.chrome } : {}),
      }
    }
    const floor = Math.max(this.layout?.rev ?? 0, this.hubPhone?.layout?.rev ?? 0)
    this.layout = { rev: floor + 1, modules: stored }
    this.bump()
    this.layoutListener?.(this.layout)
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

  /**
   * Windows 还醒着的心跳。空对象或没给 online 当成在线。
   * cpu / memory / gpu 可选，带上就写进快照给手机的 PC 模块。
   * at 是本进程收到的时刻；请求体里的时间不用。测试可以传入过去的 at。
   * 在线位没变、整数百分比也没变，不 bump。没带上的指标沿用上一拍。
   */
  noteDesk(input: DeskBeat, at = Date.now()): void {
    const reported = input.online !== false
    const beforeBit = this.deskBit(Date.now())
    const beforeKey = this.desk === null ? '' : deskMetricKey(this.desk)
    const next: DeskBeat & { at: number } = { online: reported, at }
    const cpu = mergeCpu(this.desk?.cpu, input.cpu)
    const memory = mergeMemory(this.desk?.memory, input.memory)
    const gpu = mergeGpu(this.desk?.gpu, input.gpu)
    if (cpu !== undefined) next.cpu = cpu
    if (memory !== undefined) next.memory = memory
    if (gpu !== undefined) next.gpu = gpu
    this.desk = next
    const afterBit = this.deskBit(Date.now())
    const afterKey = deskMetricKey(this.desk)
    if (beforeBit !== afterBit) {
      this.deskChangeIso = new Date(at).toISOString()
      this.bump()
    } else if (beforeKey !== afterKey) {
      this.bump()
    } else if (this.deskChangeIso === '') {
      this.deskChangeIso = new Date(at).toISOString()
    }
  }

  /** 键鼠空闲。null = 这一拍不知道，不当成在休息。不 bump。 */
  noteIdle(idle: number | null, at = Date.now()): void {
    this.idleSec = idle
    this.idleAt = at
  }

  /** 喂 pc 指标样本。心跳没来过时，online 也用这份样本。内容变了才 bump。 */
  setPc(state: PcState | null): void {
    this.pcAt = state === null ? 0 : Date.now()
    const prev = this.pc
    this.pc = state
    if (JSON.stringify(prev) !== JSON.stringify(state)) this.bump()
  }

  /** 喂 phone（来自真 hub 的 snapshot）。控制台主屏布局写在 hub，手机只连本模拟面，
   *  不转发这段的话保存布局到不了屏上。内容变了才 bump。 */
  setPhone(state: PhoneState | null): void {
    const prev = this.hubPhone
    this.hubPhone = state
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

  /** 心跳接管后的在线位。null = 还没有心跳。 */
  private deskBit(now: number): boolean | null {
    if (this.desk === null) return null
    return now - this.desk.at <= DESK_STALE_MS && this.desk.online === true
  }

  /** pc 对 app 的语义必须完整：缺 pc = 「还没数据 = 保持醒着」（DockViewModel
   *  noteDeskPc 的分支），熄屏链路会断——所以这里永远给出 pc。
   *  有心跳时 online 只看心跳（20 秒）。样本只贡献 cpu/memory/gpu/fps。
   *  从未心跳：60 秒内的样本原样透传，否则 online:false。 */
  private pcState(): PcState {
    const now = Date.now()
    if (this.desk === null) {
      if (this.pc !== null && now - this.pcAt <= PC_STALE_MS) return this.pc
      return { online: false, updated_at: this.pc?.updated_at ?? '' }
    }
    const online = this.deskBit(now) === true
    let updatedAt = this.deskChangeIso
    if (now - this.desk.at > DESK_STALE_MS && this.desk.online) {
      updatedAt = new Date(this.desk.at + DESK_STALE_MS).toISOString()
    }
    const result: PcState = { online, updated_at: updatedAt }
    if (online && this.desk !== null) {
      if (this.desk.cpu !== undefined) result.cpu = this.desk.cpu
      if (this.desk.memory !== undefined) result.memory = this.desk.memory
      if (this.desk.gpu !== undefined) result.gpu = this.desk.gpu
    }
    if (this.pc !== null && now - this.pcAt <= PC_STALE_MS) {
      if (result.cpu === undefined && this.pc.cpu !== undefined) result.cpu = this.pc.cpu
      if (result.memory === undefined && this.pc.memory !== undefined) result.memory = this.pc.memory
      if (result.gpu === undefined && this.pc.gpu !== undefined) result.gpu = this.pc.gpu
      if (this.pc.fps !== undefined) result.fps = this.pc.fps
    }
    return result
  }

  /** 只在 Windows 仍被判定为在线、且这一拍还新鲜时交出空闲秒数。 */
  private idleState(): number | null {
    if (this.idleSec === null) return null
    if (Date.now() - this.idleAt > DESK_STALE_MS) return null
    if (this.deskBit(Date.now()) !== true) return null
    return this.idleSec
  }

  /** phone 下发：本地布局（dsh 落盘）在就不让 hub 的 layout 盖过来。
   *  没有本地布局时才原样转发 hub 的 phone。两边都没有则省略
   *  ——带一份 rev=0 的默认外观会把手机手改打回出厂。 */
  private phoneState(): PhoneState | null {
    const hub = this.hubPhone
    const local = this.layout
    if (hub === null && local === null) return null
    if (local !== null && hub !== null) return { ...hub, layout: local }
    if (local === null) return hub
    const layout = local
    return {
      rev: 0,
      tile: { style: 'ink', opacity: 42, corner: 20 },
      type: { font: 'system', clock: 88, stats: 20, tile: 15, chip: 15 },
      screen: { keep_on: true, sleep_sec: 60 },
      weather: { enabled: true, city: '上海' },
      layout,
    }
  }

  /** 组 snapshot：协议最小集（未接的面整个省略）。
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
    const idle = this.idleState()
    if (idle !== null) snap.idle_sec = idle
    const phone = this.phoneState()
    if (phone !== null) snap.phone = phone
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
  config: { token: string; serverName: string; companionUpstream: string; hubUpstream: string; ttsBaseUrl: string; ttsToken: string }
  gateway: K20Gateway
  /** 书桌手机对话。在则 chat 走本机会话，快照带 companion.ready。 */
  voice?: DeskVoice
}

/** 把全部路由挂上宿主 webServer。handler 全部自带错误兜底（异常转 500 JSON） */
export function registerK20Server(deps: K20ServerDeps): void {
  const { ctx, webServer, config, gateway, voice } = deps
  const token = config.token

  // app 的语音门看 snapshot.companion.ready。会话接上了，或还留着上游，才开门。
  if (voice !== undefined || config.companionUpstream.trim() !== '') {
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

  // —— POST /v1/desk：Windows 还醒着，顺便带 CPU / 内存 / GPU。没装上之前，pc 仍走 setPc 样本。——
  register(
    {
      kind: 'exact',
      path: '/v1/desk',
      handler: guarded(async (req, res) => {
        if (req.method !== 'POST') {
          sendError(res, 404, 'not_found', '未知接口')
          return
        }
        const body = await readJsonBody(req)
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          sendError(res, 400, 'bad_request', 'online 必须是布尔')
          return
        }
        const raw = body as { online?: unknown; cpu?: unknown; memory?: unknown; gpu?: unknown }
        if (raw.online !== undefined && typeof raw.online !== 'boolean') {
          sendError(res, 400, 'bad_request', 'online 必须是布尔')
          return
        }
        const cpu = readCpu(raw.cpu)
        const memory = readMemory(raw.memory)
        const gpu = readGpu(raw.gpu)
        if (cpu === 'bad' || memory === 'bad' || gpu === 'bad') {
          sendError(res, 400, 'bad_request', 'cpu / memory / gpu 字段不合法')
          return
        }
        const beat: DeskBeat = {}
        if (typeof raw.online === 'boolean') beat.online = raw.online
        if (cpu !== undefined) beat.cpu = cpu
        if (memory !== undefined) beat.memory = memory
        if (gpu !== undefined) beat.gpu = gpu
        gateway.noteDesk(beat)
        sendJson(res, 200, { ok: true })
      }),
    },
    'k20 网关 /v1/desk（Windows 在线心跳，带 CPU / 内存 / GPU）',
  )

  // 旧探针仍 POST {pc, running, idle_sec} 到 /v1/telemetry。只取 pc，其余丢掉。
  register(
    {
      kind: 'exact',
      path: '/v1/telemetry',
      handler: guarded(async (req, res) => {
        if (req.method !== 'POST') {
          sendError(res, 404, 'not_found', '未知接口')
          return
        }
        const body = await readJsonBody(req)
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          sendError(res, 400, 'bad_request', 'pc 字段不合法')
          return
        }
        const pc = (body as { pc?: unknown }).pc
        if (pc !== undefined && (typeof pc !== 'object' || pc === null || Array.isArray(pc))) {
          sendError(res, 400, 'bad_request', 'pc 字段不合法')
          return
        }
        const raw = (pc ?? {}) as { online?: unknown; cpu?: unknown; memory?: unknown; gpu?: unknown }
        if (raw.online !== undefined && typeof raw.online !== 'boolean') {
          sendError(res, 400, 'bad_request', 'online 必须是布尔')
          return
        }
        const cpu = readCpu(raw.cpu)
        const memory = readMemory(raw.memory)
        const gpu = readGpu(raw.gpu)
        if (cpu === 'bad' || memory === 'bad' || gpu === 'bad') {
          sendError(res, 400, 'bad_request', 'cpu / memory / gpu 字段不合法')
          return
        }
        const beat: DeskBeat = {}
        if (typeof raw.online === 'boolean') beat.online = raw.online
        else beat.online = true
        if (cpu !== undefined) beat.cpu = cpu
        if (memory !== undefined) beat.memory = memory
        if (gpu !== undefined) beat.gpu = gpu
        const idleRaw = (body as { idle_sec?: unknown }).idle_sec
        if (idleRaw !== undefined && (typeof idleRaw !== 'number' || !Number.isFinite(idleRaw) || idleRaw < 0)) {
          sendError(res, 400, 'bad_request', 'idle_sec 必须是非负数字')
          return
        }
        gateway.noteDesk(beat)
        gateway.noteIdle(typeof idleRaw === 'number' ? idleRaw : null)
        sendJson(res, 200, { ok: true })
      }),
    },
    'k20 网关 /v1/telemetry（旧 Windows 探针的 pc 样本）',
  )

  // —— /v1/companion/announce|stop：语音直连 keeper-tts ——
  // 出声 = POST :18100/v1/speak（play_only=true，TTS 自己占本机喇叭，3s 超时只等收执）；
  // 闭嘴 = POST /v1/stop（0.8s）。与 hub tts.py 的合同逐字段对齐（voice/language/turn_id/speed）。
  // 大脑（chat/memory/audio）还在旧 hub，继续走下方 prefix 代理；TTS 没应答也照常 200
  // （app 只吃 {text, audio_id} 形状，语音缺席仅记日志——hub 的熔断语义这里不搬，直连链路短得多）。
  const ttsBase = config.ttsBaseUrl.trim().replace(/\/+$/, '')
  const ttsToken = config.ttsToken.trim()

  register(
    {
      kind: 'exact',
      path: '/v1/companion/announce',
      handler: guarded(async (req, res) => {
        const body = (await readJsonBody(req)) as { text?: unknown; turn_id?: unknown }
        const text = clipAnnounce(typeof body.text === 'string' ? body.text : '')
        if (text === '') {
          sendError(res, 400, 'bad_request', 'text 不能为空')
          return
        }
        const turn = typeof body.turn_id === 'string' && body.turn_id !== '' ? body.turn_id : `ann-${Date.now()}`
        if (ttsBase !== '') {
          const spoken = await postJsonToTts(
            ttsBase,
            '/v1/speak',
            { text, voice: 'shorekeeper', language: 'chinese', turn_id: turn, speed: 1.0, play_only: true },
            ttsToken,
            3000,
          )
          if (spoken === null || spoken.status < 200 || spoken.status >= 300) {
            ctx.logger?.('k20')?.warn?.('announce 直连 TTS 未应答（status=%s），本轮只出字幕', spoken?.status ?? 'n/a')
          }
        }
        sendJson(res, 200, { text, audio_id: null })
      }),
    },
    'k20 网关 /v1/companion/announce（直连 keeper-tts /v1/speak）',
  )

  register(
    {
      kind: 'exact',
      path: '/v1/companion/stop',
      handler: guarded(async (req, res) => {
        await readJsonBody(req)
        voice?.cancel()
        if (ttsBase !== '') {
          await postJsonToTts(ttsBase, '/v1/stop', {}, ttsToken, 800)
        }
        sendJson(res, 200, { ok: true })
      }),
    },
    'k20 网关 /v1/companion/stop（直连 keeper-tts /v1/stop）',
  )

  if (voice !== undefined) {
    register(
      {
        kind: 'exact',
        path: '/v1/companion/chat',
        handler: guarded(async (req, res) => {
          if (req.method !== 'POST') {
            sendError(res, 404, 'not_found', '未知接口')
            return
          }
          const body = (await readJsonBody(req)) as { text?: unknown; turn_id?: unknown }
          const heard = typeof body.text === 'string' ? body.text.trim() : ''
          if (heard === '') {
            sendError(res, 400, 'bad_request', 'text 不能为空')
            return
          }
          const turn = typeof body.turn_id === 'string' && body.turn_id !== '' ? body.turn_id : `k20-${Date.now()}`
          const ac = new AbortController()
          const onClose = (): void => {
            if (!res.writableEnded) ac.abort()
          }
          req.on('aborted', onClose)
          let spoken = ''
          try {
            spoken = clipAnnounce(await voice.reply(heard, ac.signal))
            if (spoken === '') spoken = '我在。'
          } catch (error) {
            if (ac.signal.aborted || res.writableEnded) return
            ctx.logger?.('k20')?.warn?.('书桌对话失败：%s', error instanceof Error ? error.message : String(error))
            sendError(res, 502, 'companion_failed', '这一句没接住')
            return
          } finally {
            req.off('aborted', onClose)
          }
          if (res.writableEnded) return
          if (ttsBase !== '') {
            const said = await postJsonToTts(
              ttsBase,
              '/v1/speak',
              { text: spoken, voice: 'shorekeeper', language: 'chinese', turn_id: turn, speed: 1.0, play_only: true },
              ttsToken,
              3000,
            )
            if (said === null || said.status < 200 || said.status >= 300) {
              ctx.logger?.('k20')?.warn?.('对话直连 TTS 未应答（status=%s），本轮只出字幕', said?.status ?? 'n/a')
            }
          }
          sendJson(res, 200, { text: spoken, audio_id: null, listen: listenPolicy(spoken) })
        }),
      },
      'k20 网关 /v1/companion/chat（书桌会话）',
    )
  }

  // —— /v1/companion/*：memory/audio 仍可转发；chat 在接上会话时由上面的 exact 接走 ——
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
