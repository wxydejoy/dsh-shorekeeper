/** keeper-watch Config（Schemastery）。
 *
 * 口径对齐 dock-hub proactive.py 与 confirmations D4：
 * 免打扰 23:00–07:00、同一件事一天最多一次；输出走 notify 桥（不过模型）。
 */

import Schema from '@deepseek-ai/schemastery'

export interface KeeperWatchConfig {
  /** 总开关（红线默认开——提醒类只读环境，不属于控制类） */
  enabled: boolean
  /** 免打扰 [start, end]，允许跨零点；空数组 = 全天不打扰 */
  quietHours: [string, string] | []
  /** 异动提醒每日配额（独立于微信主动开口的配额） */
  dailyLimit: number
  /** hub 真身（取 pc/devices/temperature 快照） */
  hubBaseUrl: string
  hubToken: string
  /** k20 屏（设备离线检测）；空 = 不查 */
  phoneHost: string
  phonePort: number
  /** 天气/空气：Open-Meteo（无需 key） */
  weatherCity: string
  weatherEnabled: boolean
  /** PM2.5 超标阈值（μg/m³；hub.yaml 口径 75 = 良的上界） */
  pm25Threshold: number
  /** PC 过热阈值（°C）与需要持续坏的秒数 */
  cpuTempThresholdC: number
  cpuTempSustainedSec: number
  /** 内存压力阈值（%）与持续秒数 */
  memoryPercentThreshold: number
  memorySustainedSec: number
  /** 设备离线：盯 snapshot 里这些设备 id，持续坏这么久才说；空 = 不盯 */
  watchDeviceIds: string[]
  deviceOfflineSustainedSec: number
  /** PC 离线提醒默认关——关机/睡眠是日常，不是异动 */
  pcOfflineAlert: boolean
  pcOfflineSustainedSec: number
  /** 手机（k20）离线持续秒数 */
  phoneOfflineSustainedSec: number
  /** notify 桥 */
  notifyUrl: string
  notifyTokenPath: string
  /** 主循环间隔（秒） */
  tickSec: number
}

export const Config = Schema.object({
  enabled: Schema.boolean().description('总开关').default(true),
  quietHours: Schema.tuple([Schema.string(), Schema.string()])
    .description('免打扰时段，允许跨零点')
    .default(['23:00', '07:00']),
  dailyLimit: Schema.number().description('异动提醒每日配额').default(12),
  hubBaseUrl: Schema.string().description('dock-hub 真身地址').default('http://127.0.0.1:17890'),
  hubToken: Schema.string().description('hub API token').default(''),
  phoneHost: Schema.string().description('k20 屏主机名/IP；空 = 不查').default('k20.lan'),
  phonePort: Schema.number().description('k20 adb 端口（TCP 探活用）').default(5555),
  weatherCity: Schema.string().description('天气/空气城市（Open-Meteo）').default('上海'),
  weatherEnabled: Schema.boolean().description('天气突变与 PM2.5 提醒').default(true),
  pm25Threshold: Schema.number().description('PM2.5 超标阈值 μg/m³').default(75),
  cpuTempThresholdC: Schema.number().description('PC CPU 过热阈值 °C').default(85),
  cpuTempSustainedSec: Schema.number().description('过热要持续坏的秒数').default(120),
  memoryPercentThreshold: Schema.number().description('内存压力阈值 %').default(92),
  memorySustainedSec: Schema.number().description('内存压力要持续坏的秒数').default(300),
  watchDeviceIds: Schema.array(Schema.string())
    .description('盯离线的 hub 设备 id；空 = 不盯')
    .default([]),
  deviceOfflineSustainedSec: Schema.number().description('设备离线要持续的秒数').default(600),
  pcOfflineAlert: Schema.boolean().description('PC 离线也提醒（默认关：关机是日常）').default(false),
  pcOfflineSustainedSec: Schema.number().description('PC 离线要持续的秒数').default(600),
  phoneOfflineSustainedSec: Schema.number().description('手机离线要持续的秒数').default(300),
  notifyUrl: Schema.string().description('微信 notify 桥地址').default('http://127.0.0.1:47832/notify'),
  notifyTokenPath: Schema.string().description('notify 桥 token 文件路径').default('/Users/weiekko/.dsh/weixin/notify.json'),
  tickSec: Schema.number().description('主循环间隔秒').default(60),
}) as Schema<KeeperWatchConfig>
