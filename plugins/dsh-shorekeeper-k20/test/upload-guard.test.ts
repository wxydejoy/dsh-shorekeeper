import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIMITS,
  UploadRejected,
  admitUpload,
  assertContent,
  describeLimits,
  extensionsOf,
  guardStream,
  kindOfFile,
  limitBytes,
  normalizeLimits,
  peekHead,
  sniffKind,
} from '../src/upload-guard.ts'

const JPEG_HEAD = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const PNG_HEAD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
const WEBP_HEAD = Uint8Array.from(Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1'))
const MP4_HEAD = Uint8Array.from(Buffer.from('\x00\x00\x00\x18ftypmp42', 'latin1'))
const WEBM_HEAD = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x23])

async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  for await (const chunk of source) parts.push(chunk)
  return Buffer.concat(parts.map((part) => Buffer.from(part)))
}

/** 走一遍真实顺序：peekHead → assertContent → guardStream（→ 收齐） */
async function pipeline(source: AsyncIterable<Uint8Array>, admission: Parameters<typeof assertContent>[1]): Promise<Uint8Array> {
  const peeked = await peekHead(source)
  assertContent(peeked.head, admission)
  return collect(guardStream(peeked.head, peeked.rest, admission))
}

async function rejection(source: AsyncIterable<Uint8Array>, admission: Parameters<typeof assertContent>[1]): Promise<UploadRejected> {
  try {
    await pipeline(source, admission)
  } catch (error) {
    if (error instanceof UploadRejected) return error
    throw error
  }
  throw new Error('本该被拒，却通过了')
}

describe('扩展名 → kind', () => {
  it('认常见图片与视频后缀（大小写不敏感）', () => {
    expect(kindOfFile('海边.JPG')).toBe('image')
    expect(kindOfFile('海边.jpeg')).toBe('image')
    expect(kindOfFile('a.png')).toBe('image')
    expect(kindOfFile('a.webp')).toBe('image')
    expect(kindOfFile('a.mp4')).toBe('video')
    expect(kindOfFile('a.WEBM')).toBe('video')
  })

  it('别的后缀一律不收（含无后缀、可执行文件、gif）', () => {
    expect(kindOfFile('a.exe')).toBeNull()
    expect(kindOfFile('a.gif')).toBeNull()
    expect(kindOfFile('wallpaper')).toBeNull()
    expect(kindOfFile('a.png.exe')).toBeNull()
  })
})

describe('魔数嗅探', () => {
  it('认出 JPEG / PNG / WebP / MP4 / WebM', () => {
    expect(sniffKind(JPEG_HEAD)).toBe('image')
    expect(sniffKind(PNG_HEAD)).toBe('image')
    expect(sniffKind(WEBP_HEAD)).toBe('image')
    expect(sniffKind(MP4_HEAD)).toBe('video')
    expect(sniffKind(WEBM_HEAD)).toBe('video')
  })

  it('文本/空头认不出', () => {
    expect(sniffKind(new TextEncoder().encode('hello world!'))).toBeNull()
    expect(sniffKind(new Uint8Array())).toBeNull()
  })
})

describe('上限与准入', () => {
  it('默认 20MB 图 / 200MB 视频，可配', () => {
    expect(DEFAULT_LIMITS.imageMB).toBe(20)
    expect(limitBytes('image', DEFAULT_LIMITS)).toBe(20 * 1024 * 1024)
    expect(limitBytes('video', normalizeLimits({ videoMB: 50 }))).toBe(50 * 1024 * 1024)
  })

  it('异常配置回落到默认值', () => {
    expect(normalizeLimits({ imageMB: 0, videoMB: Number.NaN })).toEqual(DEFAULT_LIMITS)
    expect(normalizeLimits({ imageMB: 99999 }).imageMB).toBe(4096)
  })

  it('文案给人看', () => {
    expect(describeLimits(DEFAULT_LIMITS)).toBe('图片 JPG/JPEG/PNG/WEBP ≤20MB；视频 MP4/WEBM ≤200MB')
    expect(extensionsOf('video')).toEqual(['mp4', 'webm'])
  })

  it('不支持的格式 415', () => {
    expect(() => admitUpload({ filename: 'a.exe', limits: DEFAULT_LIMITS })).toThrow(UploadRejected)
    try {
      admitUpload({ filename: 'a.exe', limits: DEFAULT_LIMITS })
    } catch (error) {
      expect((error as UploadRejected).status).toBe(415)
    }
  })

  it('没后缀时认 ?kind= 提示', () => {
    expect(admitUpload({ filename: 'wallpaper', kindHint: 'video', limits: DEFAULT_LIMITS }).kind).toBe('video')
    expect(admitUpload({ filename: '壁纸.png', limits: DEFAULT_LIMITS }).kind).toBe('image')
  })

  it('声明长度超上限 413，先拒不给手机传半截', () => {
    try {
      admitUpload({ filename: 'a.jpg', declaredLength: 21 * 1024 * 1024, limits: DEFAULT_LIMITS })
      throw new Error('本该被拒')
    } catch (error) {
      expect(error).toBeInstanceOf(UploadRejected)
      expect((error as UploadRejected).status).toBe(413)
      expect((error as UploadRejected).message).toContain('超过上限 20MB')
    }
    // 视频走自己的上限
    expect(() => admitUpload({ filename: 'a.mp4', declaredLength: 21 * 1024 * 1024, limits: DEFAULT_LIMITS })).not.toThrow()
  })
})

describe('流转发闸门', () => {
  const limits = { imageMB: 4, videoMB: 8 }

  it('整块放行，字节一个不少（首块先缓冲够魔数）', async () => {
    const admission = admitUpload({ filename: 'a.jpg', limits })
    const body = Buffer.concat([Buffer.from(JPEG_HEAD), Buffer.alloc(1000, 7)])
    const out = await pipeline((async function* () { yield body })(), admission)
    expect(out.byteLength).toBe(body.byteLength)
    expect([...out.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
  })

  it('分片上传同样放行（魔数可能跨片）', async () => {
    const admission = admitUpload({ filename: 'a.png', limits })
    const body = Buffer.concat([Buffer.from(PNG_HEAD), Buffer.alloc(50, 1)])
    const source = (async function* () {
      yield body.subarray(0, 5)
      yield body.subarray(5)
    })()
    const out = await pipeline(source, admission)
    expect(out.byteLength).toBe(body.byteLength)
  })

  it('内容与后缀不符 415', async () => {
    const admission = admitUpload({ filename: 'a.mp4', limits })
    const error = await rejection((async function* () { yield Buffer.from(JPEG_HEAD) })(), admission)
    expect(error.status).toBe(415)
    expect(error.message).toContain('文件内容像图片')
  })

  it('认不出的字节 415', async () => {
    const admission = admitUpload({ filename: 'a.jpg', limits })
    const error = await rejection((async function* () { yield new TextEncoder().encode('<html>nope</html>') })(), admission)
    expect(error.status).toBe(415)
  })

  it('空体 400', async () => {
    const admission = admitUpload({ filename: 'a.jpg', limits })
    const error = await rejection((async function* () { /* 什么都不给 */ })(), admission)
    expect(error.status).toBe(400)
  })

  it('边数边拦：没声明长度也能认出超限', async () => {
    const admission = admitUpload({ filename: 'a.jpg', limits })
    const big = Buffer.concat([Buffer.from(JPEG_HEAD), Buffer.alloc(5 * 1024 * 1024, 3)])
    const source = (async function* () {
      yield big.subarray(0, 64 * 1024)
      yield big.subarray(64 * 1024)
    })()
    const error = await rejection(source, admission)
    expect(error.status).toBe(413)
  })
})
