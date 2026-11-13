import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'

/** 宿主会话控制器里这一路用得到的三件事。 */
export interface VoiceSessions {
  create(cwd: string): Promise<string>
  prompt(sessionId: string, text: string): Promise<void>
  cancel(sessionId: string): Promise<void>
}

export interface VoiceEvents {
  on(
    name: 'session/event',
    listener: (session: { id?: string; header?: { id?: string } }, event: { type?: string; data?: unknown }) => void,
  ): () => void
}

export interface DeskVoice {
  reply(heard: string, signal: AbortSignal): Promise<string>
  cancel(): void
}

const REPLY_TIMEOUT_MS = 75_000

/** 书桌手机上的一句话，送进现有的 dsh 会话，等到这一轮说完。 */
export function createDeskVoice(options: {
  events: VoiceEvents
  sessions: VoiceSessions
  sessionFile: string
  cwd: string
  log?: (message: string) => void
}): DeskVoice {
  let sessionId = readSessionId(options.sessionFile)
  let current: AbortController | null = null

  async function ensureSession(forceNew: boolean): Promise<string> {
    if (!forceNew && sessionId !== '') return sessionId
    const created = await options.sessions.create(options.cwd)
    sessionId = created
    try {
      mkdirSync(dirname(options.sessionFile), { recursive: true })
      writeFileSync(options.sessionFile, JSON.stringify({ sessionId: created }), 'utf8')
    } catch (error) {
      options.log?.(`会话号没写下来：${error instanceof Error ? error.message : String(error)}`)
    }
    return created
  }

  function forgetSession(): void {
    sessionId = ''
    try {
      unlinkSync(options.sessionFile)
    } catch {
      // 文件本来就没有
    }
  }

  return {
    cancel(): void {
      current?.abort()
      current = null
      if (sessionId !== '') void options.sessions.cancel(sessionId).catch(() => undefined)
    },
    async reply(heard: string, signal: AbortSignal): Promise<string> {
      current?.abort()
      const local = new AbortController()
      current = local
      const linked = AbortSignal.any([signal, local.signal])
      const run = async (forceNew: boolean): Promise<string> => {
        const id = await ensureSession(forceNew)
        await options.sessions.cancel(id).catch(() => undefined)
        return waitForTurn(options.events, options.sessions, id, heard, linked)
      }
      try {
        return await run(false)
      } catch (error) {
        if (linked.aborted || !missingSession(error)) throw error
        forgetSession()
        return await run(true)
      } finally {
        if (current === local) current = null
      }
    },
  }
}

function waitForTurn(
  events: VoiceEvents,
  sessions: VoiceSessions,
  sessionId: string,
  heard: string,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ''
    let started = false
    let settled = false
    const finish = (ok: string | Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stop()
      signal.removeEventListener('abort', onAbort)
      if (ok instanceof Error) reject(ok)
      else resolve(ok)
    }
    const mark = `k20:${Math.random().toString(36).slice(2, 10)}`
    const stop = events.on('session/event', (session, event) => {
      if (sessionIdOf(session) !== sessionId) return
      if (event.type === 'user/message' && eventHasMark(event.data, mark)) {
        started = true
        return
      }
      if (!started) return
      if (event.type === 'assistant/message') {
        const next = messageText(event.data).replaceAll(mark, '').trim()
        if (next !== '') text = next
      }
      if (event.type === 'turn/end') finish(text !== '' ? text : '这句我没接住。')
    })
    const timer = setTimeout(() => finish(new Error('reply timeout')), REPLY_TIMEOUT_MS)
    const onAbort = (): void => {
      void sessions.cancel(sessionId).catch(() => undefined)
      finish(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort)
    void sessions.prompt(sessionId, promptFor(heard, mark)).catch((error: unknown) => {
      finish(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

function promptFor(heard: string, mark: string): string {
  return [
    '【书桌手机】漂泊者对着 k20 说了下面这句。',
    '用一两句口语回答。回答会显示在屏幕字幕上，也会从书桌喇叭读出来。',
    '不要用 markdown，不要列清单，不要写代码。能直接说就不要调用工具。',
    `（标记 ${mark}，不要复述。）`,
    heard.trim().slice(0, 500),
  ].join('\n')
}

function sessionIdOf(session: { id?: string; header?: { id?: string } }): string {
  return session.id ?? session.header?.id ?? ''
}

function eventHasMark(data: unknown, mark: string): boolean {
  if (messageText(data).includes(mark)) return true
  try {
    return JSON.stringify(data).includes(mark)
  } catch {
    return false
  }
}

function messageText(data: unknown): string {
  if (typeof data !== 'object' || data === null) return ''
  const record = data as { message?: { content?: unknown }; content?: unknown }
  const content = record.message?.content ?? record.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (typeof block !== 'object' || block === null) return ''
      const item = block as { type?: unknown; text?: unknown }
      return item.type === 'text' && typeof item.text === 'string' ? item.text : ''
    })
    .filter((part) => part !== '')
    .join('\n')
    .trim()
}

function missingSession(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /not[- ]?found|不存在/i.test(message)
}

function readSessionId(file: string): string {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { sessionId?: unknown }
    return typeof parsed.sessionId === 'string' ? parsed.sessionId : ''
  } catch {
    return ''
  }
}
