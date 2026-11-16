/** 提醒出声：keeper-tts 直连（提醒专用薄封装）。
 *
 * POST /v1/audio/speech {input, play:true} —— 服务端在本机喇叭流式出声
 * （keeper-tts 以 --play 起，见 dsh-shorekeeper-reading/src/tts-client.ts 同一契约）。
 *
 * 几个刻意的选择：
 * - **不用 afplay**：服务端已经会播，多一道临时文件+播放进程纯属给自己找麻烦。
 * - **不打断朗读**：keeper-tts 同一播放队列串行，正在听书时这条提醒会排在那一段
 *   之后（一段几秒到几十秒），比插话盖掉正文好。真要立刻停用 /v1/stop。
 * - **失败只 warn**：文字那条（notify 桥）已经发出去了，语音是加强项，出声失败
 *   不该反过来影响提醒本身。
 */

const DEFAULT_TIMEOUT_MS = 60_000

export interface VoiceClient {
  /** 出声成功回 true；服务不在线/超时/被拒回 false，不抛。 */
  speak(text: string): Promise<boolean>
}

export interface VoiceClientOptions {
  /** 例如 http://127.0.0.1:18100 */
  baseUrl: string
  /** 采样增益 0–100（与朗读面板同一个口径，不动系统音量）。undefined = 服务端现值 */
  volume?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export function createVoiceClient(options: VoiceClientOptions): VoiceClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    async speak(text: string): Promise<boolean> {
      const input = text.trim()
      if (!input) return false
      const body: Record<string, unknown> = { input, play: true }
      if (options.volume !== undefined) body.volume = options.volume
      try {
        const resp = await fetchImpl(`${baseUrl}/v1/audio/speech`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'audio/*' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!resp.ok) return false
        // 服务端已经出声，字节本身用不上（留给将来接字幕/存档）
        await resp.arrayBuffer()
        return true
      } catch {
        return false
      }
    },
  }
}
