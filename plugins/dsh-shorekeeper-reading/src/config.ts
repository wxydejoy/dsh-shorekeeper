/** 插件 Config（Schemastery）。 */

import Schema from '@deepseek-ai/schemastery'

export interface ReadingConfig {
  /** 数据目录（shelf.json / notes.json / progress.json）。缺省与 export_books.py 落点一致 */
  dataDir: string
}

export const Config = Schema.object({
  dataDir: Schema.string().description('阅读数据目录（缺省 $DSH_HOME/data/reading 或 ~/.dsh/data/reading）').default(''),
})

export function resolveDataDir(config: ReadingConfig): string | undefined {
  const trimmed = config.dataDir.trim()
  return trimmed === '' ? undefined : trimmed
}
