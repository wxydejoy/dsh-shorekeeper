/** dsh-keeper-news —— 守岸人的新闻播报。
 *
 * 两条出口：
 * - 点播：模型调 news_speak，取百度热搜串一段稿，逐段送 keeper-tts 服务端喇叭；
 * - 定时：早/晚报各一次（默认 08:30 / 21:00，错过 90 分钟内补），同样出声 + 推一条
 *   微信文字（notify 桥直推，不过模型）。人在不在电脑前用 ioreg 空闲判定，
 *   不在就只发微信，别对着空房间念 40 秒。
 *
 * 不重复开口靠落盘（~/.dsh/keeper-news-state.json）：dsh 重启是日常动作，
 * 「今天这一档播过了」不能只存内存（keeper-watch 2026-11-16 的教训）。
 *
 * 已知取舍：keeper-tts 服务端播放队列串行，正在听书时定时新闻会排在当前段落之后；
 * 要插队先 news_stop（那会一起把朗读停掉）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Config, type NewsConfig } from './config.ts'
import { buildSpokenBrief, buildTextBrief, resolvePeriod } from './brief.ts'
import { collectNews } from './feed.ts'
import { readLocalIdleSec } from './idle.ts'
import { createNotifyClient, type NotifyClient } from './notify.ts'
import { applyNewsOverrides, readNewsOverridesSync } from './overrides.ts'
import { inQuietHours, localDateKey, slotDue } from './schedule.ts'
import { NewsState } from './state.ts'
import { createNewsTools } from './tools.ts'
import { NewsSpeaker } from './tts.ts'

export const inject = ['tools']

export { Config }

export function apply(ctx: Context, config: NewsConfig): void {
  const log = ctx.logger('keeper-news')

  // 面板运行时覆盖：每个 tick 现读，缺字段回落基线。live 对象传给工具面，读到的是现值。
  const live: NewsConfig = { ...config }
  function refreshLive(): void {
    Object.assign(live, applyNewsOverrides(config, readNewsOverridesSync()))
  }
  refreshLive()

  const speaker = new NewsSpeaker({
    baseUrl: live.ttsBaseUrl,
    speed: live.speed,
    volume: live.volume,
    log,
  })

  const statePath = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'keeper-news-state.json')
  const state = new NewsState(statePath, (message) => log.warn(message))

  const notify: NotifyClient | null = live.notifyEnabled
    ? createNotifyClient({
        url: live.notifyUrl,
        tokenPath: live.notifyTokenPath.trim() || join(homedir(), '.dsh', 'weixin', 'notify.json'),
      })
    : null

  for (const tool of createNewsTools({ config: live, speaker, state })) {
    ctx.tools.register(tool)
  }

  /** 一档定时播报：取要闻 → 出声（有人在才出）→ 推微信。整档只播一次。 */
  async function runSlot(slot: 'morning' | 'evening', at: string, now: Date): Promise<void> {
    // 先占位再干活：万一中途抛错/被重启，也不要同一个档位重复念（新闻过期了重播没意义）
    state.markRan(slot, localDateKey(now))
    const label = slot === 'morning' ? '早报' : '晚报'

    if (!live.enabled) {
      log.info('%s 到点了，但新闻开关是关的，跳过', label)
      return
    }
    if (inQuietHours(live.quietHours, now)) {
      log.info('%s 落在免打扰时段 %j，跳过', label, live.quietHours)
      return
    }

    let items
    let warnings: string[]
    try {
      const got = await collectNews({ limit: live.count, extraFeeds: live.extraFeeds })
      items = got.items
      warnings = got.warnings
    } catch (error) {
      log.warn('%s 取数失败，这档不播了：%s', label, error instanceof Error ? error.message : String(error))
      return
    }
    if (warnings.length > 0) log.warn('%s 取数降级：%s', label, warnings.join('；'))
    if (items.length === 0) {
      log.warn('%s 一条要闻都没取到，跳过', label)
      return
    }

    const period = resolvePeriod(now, live.morningAt, live.eveningAt)
    const spoken = buildSpokenBrief(items, { count: live.count, period })

    // 人在不在：取不到空闲就按「在」处理（宁可念，也别因为 ioreg 抽风整档吞掉）
    let present = true
    if (live.speakOnlyWhenPresent) {
      const idle = await readLocalIdleSec()
      present = idle === null || idle <= live.presentIdleMaxSec
      if (!present) log.info('%s：键鼠空闲 %d 秒（阈值 %d），只发微信不出声', label, idle ?? -1, live.presentIdleMaxSec)
    }

    if (present) {
      if (!speaker.start(spoken.text)) {
        log.warn('%s 稿子切不出段来，没出声', label)
      } else {
        state.remember(spoken.text, items.map((item) => item.title), now.getTime())
        log.info('%s 已出声：%d 条，约 %d 秒', label, items.length, spoken.estimatedSec)
      }
    }

    if (notify) {
      const text = buildTextBrief(items, { count: live.count })
      const ok = await notify.send(present ? `（刚念了一遍）\n${text}` : text)
      if (!ok) log.warn('%s 微信文字没发出去（notify 桥没通或 token 过期）', label)
    }
  }

  async function tickOnce(now: Date = new Date()): Promise<void> {
    if (!live.enabled) return
    for (const [slot, at] of [
      ['morning', live.morningAt],
      ['evening', live.eveningAt],
    ] as const) {
      if (!at.trim()) continue
      const last = state.lastRunDate(slot)
      if (!slotDue(at, now, last, live.catchUpMinutes)) continue
      await runSlot(slot, at, now)
    }
  }

  refreshLive()
  tickOnce().catch(() => {}) // 起步先跑一轮：正好落在窗口里（例如刚重启）就补上
  const timer = setInterval(() => {
    refreshLive()
    tickOnce().catch(() => {})
  }, Math.max(15, live.tickSec) * 1000)
  timer.unref?.()

  log.info(
    'keeper-news 就绪：早报=%s 晚报=%s 条数=%d 补播=%dmin tts=%s 音量=%d 微信=%s 有人才出声=%s',
    live.morningAt || 'off',
    live.eveningAt || 'off',
    live.count,
    live.catchUpMinutes,
    live.ttsBaseUrl,
    live.volume,
    notify ? live.notifyUrl : 'off',
    String(live.speakOnlyWhenPresent),
  )
}
