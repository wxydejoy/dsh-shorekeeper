/** dsh-keeper-watch —— 异动提醒：天气突变 / PM2.5 超标 / PC 过热 / 内存压力 /
 *  设备离线 → notify 桥直推微信（不过模型、不烧微信配额）。
 *
 * 移植自 dock-hub proactive.py 的判断骨架：三重闸（免打扰/每日配额/同一件事
 * 一天一次）+ Sustained（持续坏才开口）。数据源：
 * - hub 真身 /v1/snapshot：pc（温度/内存/在线）、devices（离线盯梢）
 * - Open-Meteo：天气与 PM2.5（免费、无需 key）
 * - k20 屏：TCP 探活 phoneHost:phonePort
 *
 * 没做的（诚实标注）：久坐提醒。键鼠 idle 是 hub 内部量（probe 上报 service.py，
 * 不外露到 /v1/snapshot），dsh 侧拿不到真值——不把「没数据」当「在休息」，
 * 等哪天 idle 进了快照再补（同 hub SedentaryWatch 的口径）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { connect as netConnect, type Socket } from 'node:net'
import { AlertGate, Sustained } from './gates.ts'
import { createNotifyClient, type NotifyClient } from './notify.ts'
import { Config, type KeeperWatchConfig } from './config.ts'
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
  pc?: { online?: boolean; cpu?: { temp_celsius?: number }; memory?: { percent?: number } }
  devices?: { id?: string; online?: boolean }[]
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
}

export interface Watcher {
  tickOnce(now?: Date): Promise<void>
}

const WEATHER_CHECK_MS = 30 * 60_000
const AIR_CHECK_MS = 60 * 60_000
const AIR_SUSTAINED_SEC = 600
// 桥发送失败的重试冷静期：别每个 tick 都往挂掉的桥上撞
const SEND_RETRY_MS = 10 * 60_000

/** 判定核心（纯逻辑，测试可直接驱动）。 */
export function createWatcher(config: KeeperWatchConfig, deps: WatcherDeps, log?: {
  info(fmt: string, ...args: unknown[]): void
  warn(fmt: string, ...args: unknown[]): void
}): Watcher {
  const gate = new AlertGate({ quietHours: config.quietHours, dailyLimit: config.dailyLimit })
  const sustained = new Sustained()
  const send = (text: string) => deps.notify.send(text)
  let lastWeatherCheck = 0
  let lastAirCheck = 0
  const sendFailAt = new Map<string, number>()

  function say(key: string, text: string, now: Date): void {
    if ((sendFailAt.get(key) ?? 0) > Date.now() - SEND_RETRY_MS) return
    void gate
      .alert(key, now, () => send(text))
      .then((d) => {
        if (d.said) {
          log?.info('已提醒 [%s]：%s', key, text)
          sendFailAt.delete(key)
        } else if (d.reason === 'off') {
          sendFailAt.set(key, Date.now()) // send 失败：冷静期后重试
        }
      })
      .catch(() => {})
  }

  return {
    async tickOnce(now: Date = new Date()): Promise<void> {
      // —— PC（温度 / 内存 / 离线）——
      try {
        const snap = await deps.fetchSnapshot()
        if (snap) {
          const pc = snap.pc
          if (pc?.online && pc.cpu?.temp_celsius !== undefined) {
            const temp = pc.cpu.temp_celsius
            if (sustained.check('cpu_temp', temp >= config.cpuTempThresholdC, now.getTime(), config.cpuTempSustainedSec)) {
              say('cpu_temp', `电脑 CPU 到 ${Math.round(temp)}° 了，跑了一会儿还没降。风扇狂转的话注意一下散热。`, now)
            }
          } else {
            sustained.clear('cpu_temp')
          }
          if (pc?.online && pc.memory?.percent !== undefined) {
            const mem = pc.memory.percent
            if (sustained.check('memory', mem >= config.memoryPercentThreshold, now.getTime(), config.memorySustainedSec)) {
              say('memory', `电脑内存吃到 ${Math.round(mem)}% 了，卡的话把不用的先关掉几个。`, now)
            }
          } else {
            sustained.clear('memory')
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

      // —— 天气突变（半小时看一眼）——
      if (config.weatherEnabled && Date.now() - lastWeatherCheck >= WEATHER_CHECK_MS) {
        lastWeatherCheck = Date.now()
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

      // —— PM2.5 超标（一小时看一眼，超标要持续 10 分钟才说）——
      if (config.weatherEnabled && Date.now() - lastAirCheck >= AIR_CHECK_MS) {
        lastAirCheck = Date.now()
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
  const notify = createNotifyClient({ url: config.notifyUrl, tokenPath: config.notifyTokenPath })

  async function fetchSnapshot(): Promise<HubSnapshot | null> {
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

  const watcher = createWatcher(config, { fetchHourly, fetchPm25, fetchSnapshot, phoneAlive, notify }, ctx.logger('keeper-watch'))
  watcher.tickOnce().catch(() => {}) // 起步先跑一轮，错了不挡装载
  const timer = setInterval(() => {
    watcher.tickOnce().catch(() => {})
  }, config.tickSec * 1000)
  timer.unref?.()

  ctx.logger('keeper-watch').info(
    'keeper-watch 就绪：quiet=%j limit=%d hub=%s phone=%s weather=%s(%s) devices=%j',
    config.quietHours,
    config.dailyLimit,
    config.hubBaseUrl,
    config.phoneHost || 'off',
    String(config.weatherEnabled),
    config.weatherCity,
    config.watchDeviceIds,
  )
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
