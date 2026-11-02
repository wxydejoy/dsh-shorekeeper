/** 插件 Config（Schemastery）。 */

import Schema from '@deepseek-ai/schemastery'

export interface KeeperVoiceConfig {
  /** keeper-tts 服务地址（独立进程，LaunchAgent 常驻 :18100） */
  baseUrl: string
  /** 服务端 --token 时必填；本机回环默认免口令 */
  token: string
  /** 默认语速（0.7–1.5） */
  speed: number
  /** 试听默认文本 */
  sampleText: string
}

export const Config = Schema.object({
  baseUrl: Schema.string().description('keeper-tts 服务地址').default('http://127.0.0.1:18100').required(),
  token: Schema.string().description('服务端 --token 口令（本机回环可留空）').default(''),
  speed: Schema.number().min(0.7).max(1.5).description('默认语速').default(1.0),
  sampleText: Schema.string().description('试听文本').default('岸边的灯给你留着。'),
})
