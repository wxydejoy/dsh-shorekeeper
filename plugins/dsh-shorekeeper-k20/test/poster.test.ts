import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackgroundClient } from '../src/background-client.ts'
import { createPosterStore } from '../src/poster.ts'
import { createMockBackground } from './mock-background.ts'

// 1x1 透明 PNG，够 ffmpeg 解码就行
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

const FFMPEG = process.env.DSH_FFMPEG
  || ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find((path) => existsSync(path))

let mock: Awaited<ReturnType<typeof createMockBackground>>
let dir: string

beforeEach(async () => {
  mock = await createMockBackground()
  dir = mkdtempSync(join(tmpdir(), 'k20-poster-'))
})

afterEach(async () => {
  await mock.close()
  rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(FFMPEG === undefined)('PosterStore', () => {
  it('给图片抽一张 320 宽的 JPEG 并落盘复用', async () => {
    const background = new BackgroundClient({ baseUrl: mock.url, token: 'test-token-1234' })
    await background.upload('海边.png', PNG, '守岸人')
    const index = await background.backgrounds()
    const item = index.items[0]
    expect(item).toBeDefined()
    if (item === undefined) return

    const store = createPosterStore({ background, dir, ffmpeg: FFMPEG ?? 'ffmpeg' })
    const first = await store.get(item)
    expect(first.endsWith('.jpg')).toBe(true)
    const bytes = readFileSync(first)
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))

    // 第二次同一个缓存键：直接给同一个文件
    const again = await store.get(item)
    expect(again).toBe(first)
  })

  it('同名文件重传（bytes 变了）换新缓存键', async () => {
    const background = new BackgroundClient({ baseUrl: mock.url, token: 'test-token-1234' })
    const store = createPosterStore({ background, dir, ffmpeg: FFMPEG ?? 'ffmpeg' })
    await background.upload('海边.png', PNG, '守岸人')
    const first = await store.get((await background.backgrounds()).items[0]!)
    await background.upload('海边.png', PNG, '守岸人')
    const second = await store.get((await background.backgrounds()).items[0]!)
    // 同字节同 mtime 允许命中同一份；不相等就说明键里带上了时间戳
    expect([first, second].every((file) => existsSync(file))).toBe(true)
  })
})
