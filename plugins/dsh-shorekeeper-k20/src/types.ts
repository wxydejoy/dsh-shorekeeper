/** k20 协议共享类型。字段定义以 reference/lan-protocol.md 与 reference/openapi.yaml 为准。 */

export interface HubHealth {
  ok: boolean
  service: string
  protocol: number
  name: string
}

export interface HubInfo {
  name: string
  mijia: 'ok' | 'login_required' | 'error'
  message: string | null
}

export interface TemperatureState {
  id: string
  name: string
  celsius: number
  humidity?: number
  updated_at: string
  online: boolean
}

export interface PcState {
  online: boolean
  updated_at: string
  cpu?: { percent: number; temp_celsius?: number }
  memory?: { percent: number; used_gb?: number; total_gb?: number }
  gpu?: { percent?: number; temp_celsius?: number; name?: string; vram_percent?: number }
  fps?: number
}

export interface MediaState {
  online: boolean
  playing: boolean
  updated_at: string
  title?: string
  artist?: string
  app?: string
}

export interface CompanionState {
  ready: boolean
  voice: boolean
  speaking: boolean
  speaking_left_ms?: number
  reading?: boolean
  timer: TimerState | null
}

export interface TimerState {
  mode: 'timer' | 'stopwatch'
  label: string
  total_sec?: number
  seconds_left?: number
  seconds?: number
}

export interface DeviceState {
  id: string
  name: string
  type: 'switch' | 'light' | 'action'
  online: boolean
  on?: boolean
  brightness?: number
  icon?: string
  last_run_at?: string
}

export interface SceneInfo {
  id: string
  name: string
}

export interface Snapshot {
  protocol: number
  seq?: number
  hub: HubInfo
  temperature: TemperatureState | null
  pc?: PcState | null
  media?: MediaState | null
  companion?: CompanionState | null
  devices: DeviceState[]
  scenes?: SceneInfo[]
  phone?: PhoneState
  /** 协议增补提案（docs/protocol-addendum.md）：k20 屏网关提供的字幕状态 */
  caption?: CaptionState | null
  /** 协议增补提案：/v1/lock 请求后的熄屏状态 */
  lock?: LockState | null
  [key: string]: unknown
}

export interface PhoneState {
  rev: number
  tile: { style: string; opacity: number; corner: number }
  type: { font: string; clock: number; stats: number; tile: number; chip: number }
  screen: { keep_on: boolean; sleep_sec: number }
  weather: { enabled: boolean; city: string }
  layout?: PhoneLayout
}

/** 布局槽位矩形（snapshot 回读侧：服务端合并后的全量字段） */
export interface PhoneModuleRect {
  x: number
  y: number
  w: number
  h: number
  visible: boolean
  chrome?: boolean
}

export interface PhoneLayout {
  rev: number
  modules: Record<string, PhoneModuleRect>
}

/** /v1/phone/layout 写入体：rev 可省（服务端只增不减），槽位矩形可部分给，缺省字段服务端保留现值（docs/protocol-addendum.md） */
export type PhoneModulePatch = Partial<PhoneModuleRect>

export interface PhoneLayoutPatch {
  rev?: number
  modules: Record<string, PhoneModulePatch>
}

export interface CaptionState {
  text: string
  /** 字幕上屏时间（UTC ISO-8601），安卓用于去重 */
  at: string
  /** 下发时应用的字号缩放（60–140），网关回读；缺省为屏上当前值 */
  scale?: number
}

/** 熄屏请求状态（协议增补提案：POST /v1/lock 后并入 snapshot） */
export interface LockState {
  requested_at: string
}

export interface DeviceCommandResult {
  id: string
  name: string
  type: DeviceState['type']
  online: boolean
  on?: boolean
  brightness?: number
  icon?: string
  last_run_at?: string
  [key: string]: unknown
}

export interface MediaCommandResult extends MediaState {}

export interface SceneResult {
  id: string
  name: string
  ok: boolean
  actions: { id: string; ok: boolean; code?: string; message?: string }[]
  said: boolean
}

export interface BackgroundItem {
  id: string
  name: string
  kind: 'image' | 'video'
  bytes: number
  modified: number
  owner: string | null
}

export interface BackgroundIndex {
  current: string | null
  items: BackgroundItem[]
}

/** Hub 统一错误格式（lan-protocol.md §7） */
export interface HubErrorBody {
  error: { code: string; message: string }
}
