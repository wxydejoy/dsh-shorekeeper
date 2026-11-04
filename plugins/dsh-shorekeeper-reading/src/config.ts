/** 插件 Config（Schemastery）。 */

import Schema from '@deepseek-ai/schemastery'

export interface ReadingConfig {
  /** 数据目录（shelf.json / notes.json / listen-state.json）。缺省与 export_books.py 落点一致 */
  dataDir: string
  /** keeper-tts 服务地址（听书直连其 OpenAI 兼容 /v1/audio/speech，服务端喇叭出声） */
  ttsBaseUrl: string
  /** 朗读语速（0.5–2.0，books.py voice_speed 同域，引擎再钳位） */
  ttsSpeed: number
}

export const Config = Schema.object({
  dataDir: Schema.string().description('阅读数据目录（缺省 $DSH_HOME/data/reading 或 ~/.dsh/data/reading）').default(''),
  ttsBaseUrl: Schema.string().description('keeper-tts 服务地址（听书播放）').default('http://127.0.0.1:18100'),
  ttsSpeed: Schema.number().description('朗读语速 0.5–2.0').default(1.0),
})

export function resolveDataDir(config: ReadingConfig): string | undefined {
  const trimmed = config.dataDir.trim()
  return trimmed === '' ? undefined : trimmed
}
