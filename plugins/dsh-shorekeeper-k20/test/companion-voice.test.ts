import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDeskVoice } from '../src/companion-voice.ts'

describe('书桌对话', () => {
  it('只收带本轮标记的回答，别人的句子和上一轮结束都不算', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'k20-voice-'))
    const bus = new EventEmitter()
    let prompted = ''
    const voice = createDeskVoice({
      events: {
        on(_name, listener) {
          bus.on('ev', listener)
          return () => bus.off('ev', listener)
        },
      },
      sessions: {
        create: async () => 's1',
        prompt: async (_id, text) => {
          prompted = text
        },
        cancel: async () => undefined,
      },
      sessionFile: join(dir, 'session.json'),
      cwd: dir,
    })
    const pending = voice.reply('在吗', AbortSignal.timeout(2_000))
    await new Promise((resolve) => setTimeout(resolve, 20))
    const mark = /k20:[a-z0-9]+/.exec(prompted)?.[0]
    expect(mark).toBeTruthy()
    bus.emit('ev', { id: 's1' }, { type: 'turn/end', data: {} })
    bus.emit('ev', { id: 'other' }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '别人' }] } } })
    bus.emit('ev', { id: 's1' }, { type: 'user/message', data: { content: [{ type: 'text', text: prompted }] } })
    bus.emit('ev', { id: 's1' }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '我去看看' }] } } })
    bus.emit('ev', { id: 's1' }, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '晚上好。' }] } } })
    bus.emit('ev', { id: 's1' }, { type: 'turn/end', data: {} })
    await expect(pending).resolves.toBe('晚上好。')
  })
})
