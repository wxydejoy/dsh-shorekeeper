import { describe, expect, it } from 'vitest'
import { createVoiceClient } from '../src/voice.ts'

/** 造一个假 fetch：记录请求，按需回 ok/fail/throw。 */
function fakeFetch(behaviour: 'ok' | 'error' | 'throw') {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    if (behaviour === 'throw') throw new Error('ECONNREFUSED')
    if (behaviour === 'error') {
      return new Response('{"error":{"code":"busy"}}', { status: 502 })
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
  }) as unknown as typeof fetch
  return { calls, impl }
}

describe('createVoiceClient（keeper-tts 出声契约）', () => {
  it('POST /v1/audio/speech，带 play:true 与音量', async () => {
    const { calls, impl } = fakeFetch('ok')
    const voice = createVoiceClient({
      baseUrl: 'http://127.0.0.1:18100/',
      volume: 30,
      fetchImpl: impl,
    })
    expect(await voice.speak('外面空气不好了。')).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('http://127.0.0.1:18100/v1/audio/speech')
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
    expect(body).toEqual({ input: '外面空气不好了。', play: true, volume: 30 })
  })

  it('不给 volume 就不塞这个键（交给服务端现值）', async () => {
    const { calls, impl } = fakeFetch('ok')
    const voice = createVoiceClient({ baseUrl: 'http://127.0.0.1:18100', fetchImpl: impl })
    await voice.speak('起来了没。')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ input: '起来了没。', play: true })
  })

  it('服务端 502 → false，不抛', async () => {
    const { impl } = fakeFetch('error')
    const voice = createVoiceClient({ baseUrl: 'http://127.0.0.1:18100', fetchImpl: impl })
    expect(await voice.speak('测试')).toBe(false)
  })

  it('服务连不上 → false，不抛（提醒本体不能因为出声失败而崩）', async () => {
    const { impl } = fakeFetch('throw')
    const voice = createVoiceClient({ baseUrl: 'http://127.0.0.1:18100', fetchImpl: impl })
    expect(await voice.speak('测试')).toBe(false)
  })

  it('空文本不发请求', async () => {
    const { calls, impl } = fakeFetch('ok')
    const voice = createVoiceClient({ baseUrl: 'http://127.0.0.1:18100', fetchImpl: impl })
    expect(await voice.speak('   ')).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
