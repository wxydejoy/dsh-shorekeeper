import { describe, expect, it } from 'vitest'
import { NewsSpeaker, splitForSpeech } from '../src/tts.ts'

const LONG =
  '早上好。今天的新闻我挑了几条，说给你听。第一条，小米回应雷军APEC发言紧张。' +
  '第二条，U19国足二比一韩国夺冠，这批孩子踢得挺硬。第三条，某地发布暴雨蓝色预警，出门记得带伞。' +
  '就这些。哪条想细听，我再展开。'

function fakeFetch(behaviour: 'ok' | 'fail' = 'ok') {
  const calls: { url: string; body: Record<string, unknown> | null }[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url)
    let body: Record<string, unknown> | null = null
    if (typeof init?.body === 'string') body = JSON.parse(init.body) as Record<string, unknown>
    calls.push({ url: href, body })
    if (href.endsWith('/v1/stop')) return new Response('{}', { status: 200 })
    if (behaviour === 'fail') return new Response('boom', { status: 502 })
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
  }) as unknown as typeof fetch
  return { calls, impl }
}

async function waitIdle(speaker: NewsSpeaker, ms = 3_000): Promise<void> {
  const deadline = Date.now() + ms
  while (speaker.playing && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('splitForSpeech（36/52 打包规则）', () => {
  it('切出的段不长于 52 字，字符不丢', () => {
    const chunks = splitForSpeech(LONG)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(52)
      expect(chunk.trim()).not.toBe('')
    }
    expect(chunks.join('')).toBe(LONG)
  })

  it('短句合成一段', () => {
    expect(splitForSpeech('外面下雨了。')).toEqual(['外面下雨了。'])
  })

  it('超长无标点串等长硬切（不把一整段塞给 TTS）', () => {
    const text = '啊'.repeat(300)
    const chunks = splitForSpeech(text)
    expect(chunks.length).toBeGreaterThanOrEqual(3)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(52)
  })

  it('纯标点/空白不出段', () => {
    expect(splitForSpeech('，。！？ …')).toEqual([])
    expect(splitForSpeech('   ')).toEqual([])
  })
})

describe('NewsSpeaker', () => {
  it('逐段 POST /v1/audio/speech，play:true，收尾 stoppedBy=end', async () => {
    const { calls, impl } = fakeFetch('ok')
    const speaker = new NewsSpeaker({
      baseUrl: 'http://127.0.0.1:18100/',
      speed: 1.0,
      volume: 40,
      fetchImpl: impl,
      paceFactor: 0,
    })
    expect(speaker.start(LONG)).toBe(true)
    expect(speaker.playing).toBe(true)
    await waitIdle(speaker)

    const speeches = calls.filter((call) => call.url.endsWith('/v1/audio/speech'))
    expect(speeches.length).toBeGreaterThan(1)
    expect(speeches[0]!.url).toBe('http://127.0.0.1:18100/v1/audio/speech')
    expect(speeches[0]!.body).toMatchObject({ play: true, speed: 1, volume: 40 })
    expect(speeches.map((call) => String(call.body?.input)).join('')).toBe(LONG)
    const status = speaker.status
    expect(status.playing).toBe(false)
    expect(status.stoppedBy).toBe('end')
    expect(status.spokenChunks).toBe(status.totalChunks)
  })

  it('空稿不启动', () => {
    const { impl } = fakeFetch('ok')
    const speaker = new NewsSpeaker({ baseUrl: 'http://x', speed: 1, volume: 40, fetchImpl: impl })
    expect(speaker.start('   ')).toBe(false)
    expect(speaker.playing).toBe(false)
  })

  it('stop：打断循环 + 调 /v1/stop，stoppedBy=stop', async () => {
    const { calls, impl } = fakeFetch('ok')
    const speaker = new NewsSpeaker({
      baseUrl: 'http://127.0.0.1:18100',
      speed: 1,
      volume: 40,
      fetchImpl: impl,
      paceFactor: 1, // 留出节流窗口，好在播到一半时打断
    })
    speaker.start(LONG)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await speaker.stop()
    expect(calls.some((call) => call.url.endsWith('/v1/stop'))).toBe(true)
    expect(speaker.playing).toBe(false)
    expect(speaker.status.stoppedBy).toBe('stop')
  })

  it('服务端连续 5xx：记 error，不冒充播完', async () => {
    const { impl } = fakeFetch('fail')
    const speaker = new NewsSpeaker({
      baseUrl: 'http://127.0.0.1:18100',
      speed: 1,
      volume: 40,
      fetchImpl: impl,
      paceFactor: 0,
    })
    speaker.start('外面下雨了。')
    await waitIdle(speaker)
    expect(speaker.status.stoppedBy).toBe('error')
    expect(speaker.status.error).toBeTruthy()
  })

  it('重播：start 会打断上一轮，不会两条一起念', async () => {
    const { calls, impl } = fakeFetch('ok')
    const speaker = new NewsSpeaker({
      baseUrl: 'http://127.0.0.1:18100',
      speed: 1,
      volume: 40,
      fetchImpl: impl,
      paceFactor: 1,
    })
    speaker.start(LONG)
    await new Promise((resolve) => setTimeout(resolve, 5))
    speaker.start('换个话题，只说一句。')
    await waitIdle(speaker, 5_000)
    expect(speaker.status.stoppedBy).toBe('end')
    expect(speaker.status.text).toBe('换个话题，只说一句。')
    expect(calls.filter((call) => call.url.endsWith('/v1/audio/speech')).length).toBeLessThan(4)
  })
})
