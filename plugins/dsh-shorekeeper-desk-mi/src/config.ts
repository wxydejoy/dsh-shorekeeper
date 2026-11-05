/** desk-mi Config（Schemastery）。控制类工具默认关（红线：米家写入走审批）。 */

import Schema from '@deepseek-ai/schemastery'

export interface SensorMapping {
  /** 工具参数里用的名字，例如「卧室」 */
  name: string
  /** 米家 did（blt.3.x…） */
  did: string
}

export interface DeskMiConfig {
  pythonBin: string
  sensors: SensorMapping[]
  /** 「屋里多少度」默认读哪台 */
  defaultSensor: string
  /** 控灯写闸门：false 时 desk_mi_light 一律拒绝（红线默认） */
  controlEnabled: boolean
  /** 设备控制每分钟配额（token bucket，按设备分键）；0 = 不限 */
  controlPerMinute: number
}

export const Config = Schema.object({
  pythonBin: Schema.string().description('Python 解释器（需已安装 mijiaAPI）').default('python3'),
  sensors: Schema.array(
    Schema.object({
      name: Schema.string().description('传感器名（工具参数用）').required(),
      did: Schema.string().description('米家 did').required(),
    }),
  )
    .description('温湿度计映射（name → did）')
    .default([]),
  defaultSensor: Schema.string().description('「屋里多少度」默认传感器名').default('卧室'),
  controlEnabled: Schema.boolean().description('允许米家写入（高危；关闭时 desk_mi_light 一律拒绝）').default(false),
  controlPerMinute: Schema.number().description('设备控制每分钟配额（按设备分桶；0=不限）').default(10),
})
