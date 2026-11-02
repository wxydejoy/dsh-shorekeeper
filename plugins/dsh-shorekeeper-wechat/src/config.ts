/** 插件 Config（Schemastery）。安全默认值在这里：只读、脱敏、白名单空。 */

import Schema from '@deepseek-ai/schemastery'

export interface WechatConfig {
  /** Windows 挂机侧微信桥地址（见 docs/bridge-contract.md） */
  bridgeBaseUrl: string
  bridgeToken: string
  /** 摘要/代读输出里的人名脱敏（默认开；关掉即守岸人可见真名） */
  maskNames: boolean
  /** 发送总闸：默认关——「默认只读不发」 */
  sendEnabled: boolean
  /** 发送白名单：联系人 id 或显示名精确匹配；空名单 = 谁也不发 */
  sendWhitelist: string[]
}

export const Config = Schema.object({
  bridgeBaseUrl: Schema.string().description('微信桥服务地址（Windows 挂机侧）').default('http://win.lan:17901').required(),
  bridgeToken: Schema.string().description('桥的 Bearer 口令').default(''),
  maskNames: Schema.boolean().description('人名脱敏（输出里真名换稳定别名）').default(true),
  sendEnabled: Schema.boolean().description('允许代发（高危；默认只读不发）').default(false),
  sendWhitelist: Schema.array(Schema.string()).description('代发白名单（联系人 id 或显示名）').default([]),
})
