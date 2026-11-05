/** notify 桥客户端 —— POST 127.0.0.1:47832/notify 直推微信，不过模型、不烧配额。
 *
 * token 在 ~/.dsh/weixin/notify.json（dsh-plugin-weixin 生成）。
 * 桥会推到最近活跃的会话。发送失败返回 false，由调用方决定是否下轮重试。
 */

import { readFile } from 'node:fs/promises'

export interface NotifyClient {
  send(text: string): Promise<boolean>
}

export function createNotifyClient(opts: { url: string; tokenPath: string }): NotifyClient {
  let token: string | null = null
  let tokenReadAt = 0

  async function loadToken(force = false): Promise<string | null> {
    // token 文件在重启实例时会换；缓存 10 分钟，超时或强刷重读
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

  return {
    async send(text: string): Promise<boolean> {
      const tk = await loadToken()
      if (!tk) return false
      try {
        const resp = await fetch(opts.url, {
          method: 'POST',
          headers: { authorization: `Bearer ${tk}`, 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(10_000),
        })
        if (resp.status === 401 || resp.status === 403) {
          // token 换了：强刷一次再试
          const fresh = await loadToken(true)
          if (!fresh || fresh === tk) return false
          const retry = await fetch(opts.url, {
            method: 'POST',
            headers: { authorization: `Bearer ${fresh}`, 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
            signal: AbortSignal.timeout(10_000),
          })
          return retry.ok
        }
        return resp.ok
      } catch {
        return false
      }
    },
  }
}
