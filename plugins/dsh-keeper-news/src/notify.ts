/** notify 桥客户端 —— POST 127.0.0.1:47832/notify 直推微信，不过模型、不烧配额。
 *
 * 与 dsh-keeper-watch/src/notify.ts 同一份契约（token 在 ~/.dsh/weixin/notify.json，
 * 由 dsh-plugin-weixin 生成；token 换了强刷一次再试）。跨插件 import 会让两个包
 * 的依赖绑在一起，所以拷一份，改协议两边一起改。
 */

import { readFile } from 'node:fs/promises'

export interface NotifyClient {
  send(text: string): Promise<boolean>
}

export function createNotifyClient(opts: { url: string; tokenPath: string }): NotifyClient {
  let token: string | null = null
  let tokenReadAt = 0

  async function loadToken(force = false): Promise<string | null> {
    // token 文件在实例重启时会换；缓存 10 分钟，超时或强刷重读
    if (!force && token && Date.now() - tokenReadAt < 600_000) return token
    try {
      const raw = JSON.parse(await readFile(opts.tokenPath, 'utf8')) as { token?: string }
      token = typeof raw.token === 'string' ? raw.token : null
      tokenReadAt = Date.now()
    } catch {
      token = null
      tokenReadAt = Date.now()
    }
    return token
  }

  /** 发一次；网络错回 null（和 HTTP 401 区分开：一个要重试、一个要换 token）。 */
  async function post(tk: string, text: string): Promise<{ ok: boolean; status: number } | null> {
    try {
      const resp = await fetch(opts.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${tk}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(10_000),
      })
      return { ok: resp.ok, status: resp.status }
    } catch {
      return null
    }
  }

  return {
    async send(text: string): Promise<boolean> {
      const tk = await loadToken()
      if (!tk) return false
      const first = await post(tk, text)
      if (first === null) return false
      if (first.status === 401 || first.status === 403) {
        // token 换了：强刷一次再试
        const fresh = await loadToken(true)
        if (!fresh || fresh === tk) return false
        const retry = await post(fresh, text)
        return retry?.ok ?? false
      }
      return first.ok
    },
  }
}
