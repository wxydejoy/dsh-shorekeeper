/** 天气 / 空气 —— Open-Meteo 直连（免费、无需 key），口径对齐 dock-hub weather.py。
 *
 * 只推「变化」不推「状态」：现在已经在下雨就不再说有雨，免得天天都开口。
 * 一次最多挑一条，按 雨 > 雪 > 降温 > 大风 排——出门最怕的排前面。
 */

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'

export const WEATHER_WINDOW_HOURS = 2
export const WEATHER_TEMP_DROP_C = 5.0
export const WEATHER_WIND_KMH = 40.0

const PRECIP_CONDITIONS = new Set(['雨', '毛毛雨', '阵雨', '雷阵雨', '雷暴冰雹'])
const SNOW_CONDITIONS = new Set(['雪', '阵雪'])

/** WMO weather code → 中文（对齐 hub weather.py）。 */
export function wmoCondition(code: number): string {
  if (code === 0) return '晴'
  if (code === 1 || code === 2) return '少云'
  if (code === 3) return '多云'
  if (code === 45 || code === 48) return '雾'
  if (code >= 51 && code <= 57) return '毛毛雨'
  if (code >= 61 && code <= 67) return '雨'
  if (code >= 71 && code <= 77) return '雪'
  if (code >= 80 && code <= 82) return '阵雨'
  if (code === 85 || code === 86) return '阵雪'
  if (code === 95) return '雷阵雨'
  if (code === 96 || code === 99) return '雷暴冰雹'
  return '阴'
}

/** PM2.5 分档（μg/m³，GB 3095-2012 日均标准）。 */
export function pm25Grade(pm25: number): string {
  if (pm25 < 35) return '优'
  if (pm25 < 75) return '良'
  if (pm25 < 115) return '轻度污染'
  if (pm25 < 150) return '中度污染'
  if (pm25 < 250) return '重度污染'
  return '严重污染'
}

export interface HourlyEntry {
  code: number
  celsius: number
  windKmh: number
}

/** 未来两小时的条目；时间串按无时区本地时间面值比对（同 hub 的口径：差一两个整点不值得较真）。 */
export function upcomingHours(now: Date, hourly: {
  time?: string[]
  celsius?: number[]
  code?: number[]
  windKmh?: number[]
}): HourlyEntry[] {
  const times = hourly.time ?? []
  const temps = hourly.celsius ?? []
  const codes = hourly.code ?? []
  const winds = hourly.windKmh ?? []
  const nowMs = Date.UTC(
    now.getFullYear(), now.getMonth(), now.getDate(),
    now.getHours(), now.getMinutes(),
  )
  const horizonMs = nowMs + WEATHER_WINDOW_HOURS * 3600_000
  const out: HourlyEntry[] = []
  for (let i = 0; i < times.length; i++) {
    const raw = times[i]
    if (!raw) continue
    const when = Date.parse(raw.endsWith('Z') ? raw : `${raw}Z`)
    if (Number.isNaN(when)) continue
    if (!(when > nowMs && when <= horizonMs)) continue
    const c = temps[i]
    if (c === undefined) continue
    out.push({
      code: codes[i] ?? 3,
      celsius: c,
      windKmh: winds[i] ?? 0,
    })
  }
  return out
}

/** 看未来两小时有什么值得提前说一句的变化；没有就 null。 */
export function weatherChangeText(
  now: Date,
  currentCelsius: number,
  currentCondition: string,
  entries: HourlyEntry[],
): string | null {
  if (entries.length === 0) return null
  const wetNow = PRECIP_CONDITIONS.has(currentCondition) || SNOW_CONDITIONS.has(currentCondition)
  if (!wetNow) {
    for (const e of entries) {
      const cond = wmoCondition(e.code)
      if (SNOW_CONDITIONS.has(cond)) return '接下来两小时要下雪了，路上慢点。'
      if (PRECIP_CONDITIONS.has(cond)) return '接下来两小时有雨，出门带伞。'
    }
  }
  const minTemp = Math.min(...entries.map((e) => e.celsius))
  const drop = currentCelsius - minTemp
  if (drop >= WEATHER_TEMP_DROP_C) return `过两个钟头要降 ${Math.round(drop)} 度，多穿点。`
  for (const e of entries) {
    if (e.windKmh >= WEATHER_WIND_KMH) return '等会儿风要大了，窗户关严实点。'
  }
  return null
}

export function airAlertText(pm25: number): string {
  if (pm25 >= 150) return `外面空气很差了，PM2.5 到 ${Math.round(pm25)} 了。别开窗，出门戴口罩。`
  return `外面空气不好了，PM2.5 到 ${Math.round(pm25)} 了，${pm25Grade(pm25)}，别开窗。`
}

async function getJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const resp = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return (await resp.json()) as unknown
}

const cityCache = new Map<string, { lat: number; lon: number }>()

async function resolveCity(city: string): Promise<{ lat: number; lon: number }> {
  const cached = cityCache.get(city)
  if (cached) return cached
  const q = new URLSearchParams({ name: city, count: '1', language: 'zh', format: 'json' })
  const body = (await getJson(`${GEOCODE_URL}?${q}`)) as {
    results?: { latitude: number; longitude: number }[]
  }
  const hit = body.results?.[0]
  if (!hit) throw new Error(`找不到城市：${city}`)
  const resolved = { lat: hit.latitude, lon: hit.longitude }
  cityCache.set(city, resolved)
  return resolved
}

/** 未来逐小时（含当前整点的温度/天气码/风），供 weatherChangeText 与「现在什么天」用。 */
export async function fetchHourly(city: string): Promise<{
  currentCelsius: number
  currentCode: number
  hourly: { time: string[]; celsius: number[]; code: number[]; windKmh: number[] }
}> {
  const { lat, lon } = await resolveCity(city)
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,weather_code',
    hourly: 'temperature_2m,weather_code,wind_speed_10m',
    wind_speed_unit: 'kmh',
    timezone: 'auto',
    forecast_hours: '6',
  })
  const body = (await getJson(`${FORECAST_URL}?${q}`)) as {
    current?: { temperature_2m?: number; weather_code?: number }
    hourly?: Record<string, unknown[]>
  }
  const current = body.current ?? {}
  const hourly = body.hourly ?? {}
  return {
    currentCelsius: Number(current.temperature_2m ?? 0),
    currentCode: Number(current.weather_code ?? 3),
    hourly: {
      time: (hourly.time as string[] | undefined) ?? [],
      celsius: (hourly.temperature_2m as number[] | undefined) ?? [],
      code: (hourly.weather_code as number[] | undefined) ?? [],
      windKmh: (hourly.wind_speed_10m as number[] | undefined) ?? [],
    },
  }
}

export async function fetchPm25(city: string): Promise<number> {
  const { lat, lon } = await resolveCity(city)
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'pm2_5',
    timezone: 'auto',
  })
  const body = (await getJson(`${AIR_URL}?${q}`)) as { current?: { pm2_5?: number } }
  const pm25 = body.current?.pm2_5
  if (pm25 === undefined || pm25 === null) throw new Error('空气源没有返回 PM2.5')
  return Number(pm25)
}
