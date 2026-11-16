/** dsh-keeper-watch —— 异动提醒：天气突变 / PM2.5 超标 / PC 过热 / 内存压力 /
 *  设备离线 → notify 桥直推微信（不过模型、不烧微信配额）。
 *
 * 移植自 dock-hub proactive.py 的判断骨架：三重闸（免打扰/每日配额/同一件事
 * 一天一次）+ Sustained（持续坏才开口）。数据源：
 * - hubBaseUrl 非空时才拉 /v1/snapshot（pc 温度/内存、设备离线）。空地址跳过，不访问旧 hub
 * - Open-Meteo：天气与 PM2.5（免费、无需 key）
 * - k20 屏：TCP 探活 phoneHost:phonePort
 * - dsh err log：插件激活失败自检（只看本次启动段，面板 405 一类事故的哨兵）
 *
 * 出口两条：notify 桥推微信（文字，必达）+ keeper-tts 出声（可选加强）。
 * 文字发成功才出声；出声失败不回滚文字。
 *
 * 久坐：优先用快照里的 idle_sec；**hub 现在不报这个字段**，所以默认走本机
 * ioreg 取键鼠空闲（localIdleProbe）。拿不到就当不知道，既不当成已休息，
 * 也不当成一直在用。空闲满 5 分钟清零。0 分钟 = 不提醒。
 *
 * 2026-11-16 实测 hub /v1/snapshot：pc.cpu 只有 percent（**没有 temp_celsius**），
 * devices 恒空。所以 CPU 过热走「温度优先、没温度按占用率」双轨，设备离线靠
 * watchDeviceIds 点名（空 = 不启用，启动日志会明说）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { open } from 'node:fs/promises'
import { connect as netConnect, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  activationAlertText,
  AlertGate,
  inQuietHours,
  scanActivationFailures,
  SedentaryWatch,
  Sustained,
  type ActivationScan,
  type GateStore,
} from './gates.ts'
import { createFileGateStore } from './state.ts'
import { createNotifyClient, type NotifyClient } from './notify.ts'
import { createVoiceClient, type VoiceClient } from './voice.ts'
import { readLocalIdleSec } from './idle.ts'
import { Config, type KeeperWatchConfig } from './config.ts'
import { applyWatchOverrides, readWatchOverridesSync } from './overrides.ts'
import {
  airAlertText,
  fetchHourly,
  fetchPm25,
  upcomingHours,
  weatherChangeText,
  wmoCondition,
} from './weather.ts'

export const inject = ['tools']

export { Config }

interface HubSnapshot {
  pc?: {
    online?: boolean
    /** hub 实测只给 percent，没有 temp_celsius（2026-11-16 核对 /v1/snapshot） */
    cpu?: { temp_celsius?: number; percent?: number }
    memory?: { percent?: number }
  }
  devices?: { id?: string; online?: boolean }[]
  /** 键鼠空闲秒数。缺省 = 这一拍不知道（可用 localIdleSec 兜底）。 */
  idle_sec?: number
}

export interface Fetchers {
  fetchHourly(city: string): Promise<{
    currentCelsius: number
    currentCode: number
    hourly: { time: string[]; celsius: number[]; code: number[]; windKmh: number[] }
  }>
  fetchPm25(city: string): Promise<number>
}

interface WatcherDeps extends Fetchers {
  fetchSnapshot(): Promise<HubSnapshot | null>
  phoneAlive(): Promise<boolean>
  notify: NotifyClient
  /** 出声（可选）。微信那条发成功之后才调用；失败只记 warn */
  voice?: VoiceClient | undefined
  /** 快照缺 idle_sec 时的本机兜底（可选） */
  localIdleSec?: (() => Promise<number | null>) | undefined
  /** err log 本次启动段的激活失败扫描；null = 读不到（没配/文件没了），跳过 */
  readActivationFailures(): Promise<ActivationScan | null>
  /** 闸门状态的落盘（可选）：给了就重启不丢「今天说过没有」 */
  gateStore?: GateStore | undefined
}

export interface Watcher {
  tickOnce(now?: Date): Promise<void>
}

const WEATHER_CHECK_MS = 30 * 60_000
// 采样必须密于持续窗口，否则「坏满 10 分钟」要等下一次小时级轮询才可能成立。
const AIR_CHECK_MS = 5 * 60_000
const AIR_SUSTAINED_SEC = 600
// 桥发送失败的重试冷静期：别每个 tick 都往挂掉的桥上撞
const SEND_RETRY_MS = 10 * 60_000
// 激活自检只读 err log 尾部（本次启动段足够），防日志涨了之后每拍全量读
const ACTIVATION_TAIL_BYTES = 256 * 1024

/** 判定核心（纯逻辑，测试可直接驱动）。
 *
 * config 传可变对象（apply 侧每个 tick 先刷新覆盖文件），闸门参数在 tick 头
 * 热更新——面板改免打扰/配额即刻生效，当日配额和「今天说过」保留。
 */
export function createWatcher(config: KeeperWatchConfig, deps: WatcherDeps, log?: {
  info(fmt: string, ...args: unknown[]): void
  warn(fmt: string, ...args: unknown[]): void
}): Watcher {
  const gate = new AlertGate({ quietHours: config.quietHours, dailyLimit: config.dailyLimit }, deps.gateStore)
  const sedentary = new SedentaryWatch()
  let gateKey = JSON.stringify([config.quietHours, config.dailyLimit])
  const sustained = new Sustained()
  const send = (text: string) => deps.notify.send(text)
  let lastWeatherCheck = 0
  let lastAirCheck = 0
  const sendFailAt = new Map<string, number>()
  // 激活自检：bootCount 变了（重启）就允许重报；签名只在真的说出去之后记账，
  // 被免打扰/配额拦下的下一拍还会再试。
  let lastBootCount = -1
  let lastActivationReported = ''

  function say(key: string, text: string, now: Date): void {
    const at = now.getTime()
    if ((sendFailAt.get(key) ?? 0) > at - SEND_RETRY_MS) return
    void gate
      .alert(key, now, () => send(text))
      .then((d) => {
        if (d.said) {
          log?.info('已提醒 [%s]：%s', key, text)
          sendFailAt.delete(key)
          // 出声放在文字之后：微信那条已经落地（人在外面也收得到），语音只是加强。
          // 不 await——合成+播放可能要几秒，别拖住这个 tick。
          if (deps.voice) {
            void deps.voice
              .speak(text)
              .then((ok) => {
                if (!ok) log?.warn('出声失败 [%s]（文字已发）', key)
              })
              .catch(() => {})
          }
        } else if (d.reason === 'off') {
          sendFailAt.set(key, at) // 桥没通：冷静期后重试（配额/免打扰不走这条）
        }
      })
      .catch(() => {})
  }

  return {
    async tickOnce(now: Date = new Date()): Promise<void> {
      // 总开关（面板可关）：关着就闭嘴，坏状态清零，重开后从零计时
      if (!config.enabled) {
        sustained.clearAll()
        sedentary.reset()
        return
      }
      // 闸门参数热更新。configure 保留当日计数和「今天说过」，改配额不会把同一件事再说一遍。
      const key = JSON.stringify([config.quietHours, config.dailyLimit])
      if (key !== gateKey) {
        gate.configure({ quietHours: config.quietHours, dailyLimit: config.dailyLimit })
        gateKey = key
      }
      // —— PC（温度 / 内存 / 离线）——
      try {
        const snap = await deps.fetchSnapshot()
        if (snap) {
          const pc = snap.pc
          // CPU 双轨：hub 报温度就按温度判；只报 percent（本机 hub 现状）就按占用率判。
          // 两条互斥——有温度时不看占用率，免得同一件事说两遍。
          const cpuTemp = pc?.cpu?.temp_celsius
          const cpuLoad = pc?.cpu?.percent
          if (pc?.online && typeof cpuTemp === 'number') {
            if (sustained.check('cpu_temp', cpuTemp >= config.cpuTempThresholdC, now.getTime(), config.cpuTempSustainedSec)) {
              say('cpu_temp', `电脑 CPU 到 ${Math.round(cpuTemp)}° 了，跑了一会儿还没降。风扇狂转的话注意一下散热。`, now)
            }
            sustained.clear('cpu_load')
          } else {
            sustained.clear('cpu_temp')
            const loadOn = config.cpuPercentThreshold > 0 && typeof cpuLoad === 'number'
            if (pc?.online && loadOn) {
              if (sustained.check('cpu_load', cpuLoad >= config.cpuPercentThreshold, now.getTime(), config.cpuPercentSustainedSec)) {
                say('cpu_load', `电脑 CPU 一直吃到 ${Math.round(cpuLoad)}% 了，跑了好几分钟没下来。看看是不是有什么在死循环。`, now)
              }
            } else {
              sustained.clear('cpu_load')
            }
          }
          if (pc?.online && pc.memory?.percent !== undefined) {
            const mem = pc.memory.percent
            if (sustained.check('memory', mem >= config.memoryPercentThreshold, now.getTime(), config.memorySustainedSec)) {
              say('memory', `电脑内存吃到 ${Math.round(mem)}% 了，卡的话把不用的先关掉几个。`, now)
            }
          } else {
            sustained.clear('memory')
          }
          if (pc?.online) {
            // 快照有 idle_sec 就用它；没有就本机取（hub 现在不报这个字段）
            let idle: number | null = typeof snap.idle_sec === 'number' ? snap.idle_sec : null
            if (idle === null && deps.localIdleSec) {
              try {
                idle = await deps.localIdleSec()
              } catch {
                idle = null
              }
            }
            if (sedentary.tick(idle, now.getTime(), config.sedentaryMinutes) && !inQuietHours(config.quietHours, now)) {
              say('sedentary', '坐了一阵了，起来走走。', now)
              sedentary.reset()
            }
          } else {
            sedentary.reset()
          }
          if (config.pcOfflineAlert && pc) {
            if (sustained.check('pc_offline', pc.online === false, now.getTime(), config.pcOfflineSustainedSec)) {
              say('pc_offline', '电脑下线有一阵子了。要是没打算关它，看一眼是不是断电断网了。', now)
            }
          }
          // 设备离线盯梢（id 由配置点名）
          for (const id of config.watchDeviceIds) {
            const dev = snap.devices?.find((d) => d.id === id)
            const bad = dev ? dev.online === false : false
            if (sustained.check(`offline:${id}`, bad, now.getTime(), config.deviceOfflineSustainedSec)) {
              say(`offline:${id}`, `「${id}」下线有一阵子了，去看一眼吧。`, now)
            }
          }
        }
      } catch (err) {
        log?.warn('hub 快照取数失败：%s', err instanceof Error ? err.message : String(err))
      }

      // —— 手机（k20）离线 ——
      try {
        const alive = await deps.phoneAlive()
        if (sustained.check('phone_offline', !alive, now.getTime(), config.phoneOfflineSustainedSec)) {
          say('phone_offline', '屏那边联系不上了。要是一直没回来，看一眼是不是断网断电了。', now)
        }
      } catch {
        sustained.clear('phone_offline')
      }

      // —— 插件激活自检（扫 err log 本次启动段；面板 405 一类事故的哨兵）——
      try {
        const scan = await deps.readActivationFailures()
        if (scan && scan.bootCount > 0) {
          if (scan.bootCount !== lastBootCount) {
            lastBootCount = scan.bootCount
            lastActivationReported = ''
          }
          const signature = scan.plugins.join(',')
          if (scan.plugins.length > 0 && signature !== lastActivationReported) {
            const text = activationAlertText(scan.plugins)
            void gate
              .alert('activation', now, () => send(text))
              .then((d) => {
                if (d.said) {
                  lastActivationReported = signature
                  log?.info('已提醒 [activation]：%s', text)
                }
              })
              .catch(() => {})
          }
        }
      } catch {
        // 日志读不到/扫描出错不碍事，别的闸照走
      }

      // —— 天气突变（半小时看一眼）。间隔跟 tick 时钟走，测试注入的 now 才管得住。
      const tickAt = now.getTime()
      if (config.weatherEnabled && tickAt - lastWeatherCheck >= WEATHER_CHECK_MS) {
        lastWeatherCheck = tickAt
        try {
          const w = await deps.fetchHourly(config.weatherCity)
          const cond = wmoCondition(w.currentCode)
          const entries = upcomingHours(now, w.hourly)
          const text = weatherChangeText(now, w.currentCelsius, cond, entries)
          if (text) say('weather', text, now)
        } catch (err) {
          log?.warn('天气取数失败：%s', err instanceof Error ? err.message : String(err))
        }
      }

      // —— PM2.5 超标（5 分钟看一眼，连续坏满 10 分钟才说）——
      if (config.weatherEnabled && tickAt - lastAirCheck >= AIR_CHECK_MS) {
        lastAirCheck = tickAt
        try {
          const pm25 = await deps.fetchPm25(config.weatherCity)
          if (sustained.check('pm25', pm25 >= config.pm25Threshold, now.getTime(), AIR_SUSTAINED_SEC)) {
            say('pm25', airAlertText(pm25), now)
          }
        } catch (err) {
          log?.warn('空气取数失败：%s', err instanceof Error ? err.message : String(err))
        }
      }
    },
  }
}

export function apply(ctx: Context, config: KeeperWatchConfig): void {
  const log = ctx.logger('keeper-watch')
  const notify = createNotifyClient({
    url: config.notifyUrl,
    tokenPath: config.notifyTokenPath.trim() || join(homedir(), '.dsh', 'weixin', 'notify.json'),
  })

  // 面板运行时覆盖（~/.dsh/keeper-settings.json）：每个 tick 现读，
  // 缺文件/缺字段回落 Config 基线。live 对象传给 watcher，tick 内读到的都是现值。
  const live: KeeperWatchConfig = { ...config }
  function refreshLive(): void {
    const merged = applyWatchOverrides(config, readWatchOverridesSync())
    live.enabled = merged.enabled
    live.quietHours = merged.quietHours
    live.dailyLimit = merged.dailyLimit
  }
  refreshLive()

  async function fetchSnapshot(): Promise<HubSnapshot | null> {
    if (!config.hubBaseUrl.trim()) return null
    const resp = await fetch(`${config.hubBaseUrl}/v1/snapshot`, {
      headers: config.hubToken ? { authorization: `Bearer ${config.hubToken}` } : {},
      signal: AbortSignal.timeout(8_000),
    })
    if (!resp.ok) throw new Error(`hub HTTP ${resp.status}`)
    return (await resp.json()) as HubSnapshot
  }

  async function phoneAlive(): Promise<boolean> {
    if (!config.phoneHost) return true
    try {
      const conn = await connectTcp(config.phoneHost, config.phonePort, 3_000)
      conn.destroy()
      return true
    } catch {
      return false
    }
  }

  const activationLog = config.activationLogPath.trim() || join(homedir(), '.dsh', 'logs', 'dsh-web.err.log')
  async function readActivationFailures(): Promise<ActivationScan | null> {
    if (!config.activationAlert) return null
    const text = await tailFile(activationLog, ACTIVATION_TAIL_BYTES)
    return text === null ? null : scanActivationFailures(text)
  }

  const voice = config.voiceEnabled
    ? createVoiceClient({ baseUrl: config.voiceBaseUrl, volume: config.voiceVolume })
    : undefined

  // 「同一件事一天一次」落盘：dsh 重启（改配置/装插件/kickstart）是日常动作，
  // 去重不能跟着清空——2026-11-16 那天重启六次，PM2.5 就发了六条。
  const gateStore = createFileGateStore(join(homedir(), '.dsh', 'keeper-watch-state.json'), (message) => log.warn(message))

  const watcher = createWatcher(
    live,
    {
      fetchHourly,
      fetchPm25,
      fetchSnapshot,
      phoneAlive,
      notify,
      readActivationFailures,
      voice,
      localIdleSec: config.localIdleProbe ? readLocalIdleSec : undefined,
      gateStore,
    },
    log,
  )
  refreshLive()
  watcher.tickOnce().catch(() => {}) // 起步先跑一轮，错了不挡装载
  const timer = setInterval(() => {
    refreshLive()
    watcher.tickOnce().catch(() => {})
  }, config.tickSec * 1000)
  timer.unref?.()

  log.info(
    'keeper-watch 就绪：quiet=%j limit=%d hub=%s phone=%s weather=%s(%s) voice=%s@%d idle=%s',
    config.quietHours,
    config.dailyLimit,
    config.hubBaseUrl,
    config.phoneHost || 'off',
    String(config.weatherEnabled),
    config.weatherCity,
    config.voiceEnabled ? config.voiceBaseUrl : 'off',
    config.voiceVolume,
    config.localIdleProbe ? 'local' : 'snapshot-only',
  )
  if (config.watchDeviceIds.length === 0) {
    // 别让人以为在盯设备：devices 恒空 + 名单空 = 这条检查压根没启用
    log.info('设备离线盯梢未启用（watchDeviceIds 为空）')
  }
}

function connectTcp(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = netConnect({ host, port })
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error('timeout'))
    }, timeoutMs)
    sock.once('connect', () => {
      clearTimeout(timer)
      resolve(sock)
    })
    sock.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/** 只读文件尾部 maxBytes（激活扫描不需要全量，日志涨了也不怕）。读不到回 null。 */
async function tailFile(path: string, maxBytes: number): Promise<string | null> {
  let fh
  try {
    fh = await open(path, 'r')
  } catch {
    return null
  }
  try {
    const size = (await fh.stat()).size
    const start = Math.max(0, size - maxBytes)
    const buf = Buffer.alloc(size - start)
    await fh.read(buf, 0, buf.length, start)
    return buf.toString('utf8')
  } catch {
    return null
  } finally {
    await fh.close()
  }
}
