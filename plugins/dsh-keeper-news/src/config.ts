/** dsh-keeper-news Config（Schemastery）。
 *
 * 口径与 keeper-watch 对齐：主动开口要有免打扰时段、要能一键关；
 * 播报本身不过模型（模板稿 + keeper-tts 服务端喇叭），所以没有 token 成本。
 */

import Schema from '@deepseek-ai/schemastery'

export interface NewsConfig {
  /** 总开关（关掉后定时与点播都不出声；点播仍可取到要闻列表） */
  enabled: boolean
  /** 早报时刻 HH:MM；空串 = 不播早报 */
  morningAt: string
  /** 晚报时刻 HH:MM；空串 = 不播晚报 */
  eveningAt: string
  /** 错过窗口的补播时长（分钟）：机器睡着/实例没起来，醒来这么久内还补一次 */
  catchUpMinutes: number
  /** 免打扰时段（沿用 keeper-watch 口径，定时播报命中则整次跳过） */
  quietHours: [string, string] | []
  /** 一次念几条 */
  count: number
  /** keeper-tts 地址（play:true 服务端在喇叭出声） */
  ttsBaseUrl: string
  speed: number
  /** 采样增益 0–100（不动系统音量） */
  volume: number
  /** 定时播报同时推一条微信文字（notify 桥直推，不过模型、不烧配额） */
  notifyEnabled: boolean
  notifyUrl: string
  notifyTokenPath: string
  /** 只有本机「有人」才出声：键鼠空闲超过 presentIdleMaxSec 视为不在，改发微信 */
  speakOnlyWhenPresent: boolean
  presentIdleMaxSec: number
  /** 额外 RSS 源（可选，补充要闻；空数组 = 只用百度热搜） */
  extraFeeds: string[]
  /** 主循环间隔（秒） */
  tickSec: number
}

export const Config = Schema.object({
  enabled: Schema.boolean().description('总开关').default(true),
  morningAt: Schema.string().description('早报时刻 HH:MM；空 = 不播').default('08:30'),
  eveningAt: Schema.string().description('晚报时刻 HH:MM；空 = 不播').default('21:00'),
  catchUpMinutes: Schema.number().description('错过窗口多久内还补播（分钟）').default(90),
  quietHours: Schema.tuple([Schema.string(), Schema.string()])
    .description('免打扰时段，允许跨零点；定时播报命中则跳过')
    .default(['23:00', '07:00']),
  count: Schema.number().description('一次念几条（5 条约 40 秒）').default(5),
  ttsBaseUrl: Schema.string().description('keeper-tts 地址').default('http://127.0.0.1:18100'),
  speed: Schema.number().description('播报语速 0.5–2.0').default(1.0),
  volume: Schema.number().description('播报音量 0–100（采样增益，不动系统音量）').default(40),
  notifyEnabled: Schema.boolean().description('定时播报同时推一条微信文字').default(true),
  notifyUrl: Schema.string().description('微信 notify 桥地址').default('http://127.0.0.1:47832/notify'),
  notifyTokenPath: Schema.string().description('notify 桥 token 路径；空 = ~/.dsh/weixin/notify.json').default(''),
  speakOnlyWhenPresent: Schema.boolean().description('只在有人时出声（无人在电脑前则只发微信）').default(true),
  presentIdleMaxSec: Schema.number().description('键鼠空闲超过这个秒数算不在').default(600),
  extraFeeds: Schema.array(Schema.string()).description('额外 RSS 源（可选）').default([]),
  tickSec: Schema.number().description('主循环间隔秒').default(60),
}) as Schema<NewsConfig>
