/** 背景缩略图。手机只肯给整段原文件，这里过一遍 ffmpeg 抽一帧存盘复用。
 *
 * - 图片：喂管道，缩到 320 宽，20MB 原图不用整张进面板。
 * - 视频：先落临时文件再抽第 1.5 秒那帧——mp4 的 moov 常在尾部，管道不可 seek，
 *   直接喂 stdin 会读到底才报「没帧」（output_2k.mp4 实测）。
 * - 缓存键含 bytes+modified，同名文件重传会自动换新图。
 * - 所有路径都在本进程里，浏览器只拿到一张几十 KB 的 JPEG。
 */

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { BackgroundClient } from './background-client.ts'
import type { BackgroundItem } from './types.ts'

const POSTER_WIDTH = 320
/** 允许的最宽/最窄（面板列表 320，布局预览板 960） */
const MIN_WIDTH = 160
const MAX_WIDTH = 1600
const POSTER_QUALITY = 6
const MAX_SOURCE_BYTES = 220 * 1024 * 1024
const FRAME_TIMEOUT_MS = 25_000
const MAX_CACHED_FILES = 300

export interface PosterStoreOptions {
  background: BackgroundClient
  dir?: string
  ffmpeg?: string
  log?: (message: string) => void
}

export interface PosterStore {
  /** 返回缓存里的 JPEG 绝对路径；同一背景并发只抽一次。width 缺省 320 */
  get(item: BackgroundItem, width?: number): Promise<string>
}

export function posterDir(home = process.env.DSH_HOME || join(homedir(), '.dsh')): string {
  return join(home, 'k20-bg-posters')
}

export function createPosterStore(options: PosterStoreOptions): PosterStore {
  const dir = options.dir ?? posterDir()
  const pending = new Map<string, Promise<string>>()

  return {
    async get(item, requested) {
      const width = clampWidth(requested)
      const key = cacheKey(item, width)
      const file = join(dir, `${key}.jpg`)
      if (existsSync(file)) return file
      const running = pending.get(key)
      if (running !== undefined) return running
      const job = generate(options, item, dir, file, width)
        .finally(() => pending.delete(key))
      pending.set(key, job)
      return job
    },
  }
}

function clampWidth(requested?: number): number {
  const n = Number(requested)
  if (!Number.isFinite(n) || n <= 0) return POSTER_WIDTH
  return Math.min(Math.max(Math.round(n), MIN_WIDTH), MAX_WIDTH)
}

function cacheKey(item: BackgroundItem, width: number): string {
  const stamp = `${item.id}|${item.bytes ?? 0}|${item.modified ?? 0}|${width}`
  return createHash('sha1').update(stamp).digest('hex').slice(0, 16)
}

async function generate(
  options: PosterStoreOptions,
  item: BackgroundItem,
  dir: string,
  file: string,
  width: number,
): Promise<string> {
  mkdirSync(dir, { recursive: true })
  const jpeg = item.kind === 'video'
    ? await frameFromFile(options, item, width)
    : await frameFromStream(options, item, width)
  if (jpeg === null) throw new Error('ffmpeg 没出帧')
  writeFileSync(file, jpeg)
  prune(dir, options.log)
  return file
}

/** 图片：直接喂管道，20MB 以内不落地 */
async function frameFromStream(options: PosterStoreOptions, item: BackgroundItem, width: number): Promise<Buffer | null> {
  const response = await options.background.mediaResponse(item.id)
  if (response.body === null) throw new Error('媒体流为空')
  const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>)
  try {
    return await frame(options, source, 0, undefined, width)
  } finally {
    source.destroy()
    void response.body.cancel().catch(() => undefined)
  }
}

/** 视频：先落临时文件。mp4 的 moov 常在最尾部，管道不可 seek 时 ffmpeg 会读到底再报没帧 */
async function frameFromFile(options: PosterStoreOptions, item: BackgroundItem, width: number): Promise<Buffer | null> {
  const response = await options.background.mediaResponse(item.id)
  if (response.body === null) throw new Error('媒体流为空')
  const responseBody = response.body
  const tmp = join(tmpdir(), `k20-poster-${randomUUID()}.bin`)
  try {
    const sink = createWriteStream(tmp)
    let bytes = 0
    const source = Readable.fromWeb(responseBody as import('node:stream/web').ReadableStream<Uint8Array>)
    for await (const chunk of source) {
      bytes += (chunk as Buffer).byteLength
      if (bytes > MAX_SOURCE_BYTES) throw new Error('源文件过大，放弃抽帧')
      if (!sink.write(chunk as Buffer)) await once(sink, 'drain')
    }
    await new Promise<void>((resolve, reject) => {
      sink.end((error?: Error | null) => (error ? reject(error) : resolve()))
    })
    return await frame(options, null, 1.5, tmp, width)
  } finally {
    void responseBody.cancel().catch(() => undefined)
    rmSync(tmp, { force: true })
  }
}

/** 抽一帧成 JPEG；抽不到返回 null（不抛，让上层决定要不要退第 0 帧） */
function frame(
  options: PosterStoreOptions,
  source: Readable | null,
  atSec: number,
  seekFile: string | undefined,
  width: number,
): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      // 文件输入时 -ss 放在 -i 前（快进到关键帧）；管道只能放后面
      ...(seekFile !== undefined ? ['-ss', String(atSec), '-i', seekFile] : ['-i', 'pipe:0', '-ss', String(atSec)]),
      '-frames:v', '1',
      '-vf', `scale=${width}:-2`,
      '-q:v', String(POSTER_QUALITY),
      '-f', 'mjpeg',
      'pipe:1',
    ]
    const child = spawn(ffmpegPath(options.ffmpeg), args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let downloaded = 0
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(() => reject(new Error(`抽帧超时（${FRAME_TIMEOUT_MS}ms）`)))
    }, FRAME_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      if (err.length < 8) err.push(chunk)
    })
    child.on('error', (error) => finish(() => reject(error)))
    child.on('close', (code) => {
      if (out.length > 0) {
        finish(() => resolve(Buffer.concat(out)))
        return
      }
      finish(() => {
        const detail = Buffer.concat(err).toString('utf8').trim().slice(0, 200)
        if (detail === '' && code !== 0) {
          reject(new Error(`ffmpeg 退出码 ${code}`))
          return
        }
        resolve(null)
      })
    })
    child.stdin.on('error', () => undefined)

    if (source === null) return
    source.on('data', (chunk: Buffer) => {
      downloaded += chunk.byteLength
      if (downloaded > MAX_SOURCE_BYTES) {
        child.kill('SIGKILL')
        finish(() => reject(new Error('源文件过大，放弃抽帧')))
      }
    })
    source.pipe(child.stdin)
  })
}

function ffmpegPath(configured?: string): string {
  if (configured !== undefined && configured !== '') return configured
  if (process.env.DSH_FFMPEG !== undefined && process.env.DSH_FFMPEG !== '') return process.env.DSH_FFMPEG
  for (const candidate of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) {
    if (existsSync(candidate)) return candidate
  }
  return 'ffmpeg'
}

/** 缓存太多就按修改时间清掉最旧的一批 */
function prune(dir: string, log?: (message: string) => void): void {
  try {
    const files = readdirSync(dir).filter((name) => name.endsWith('.jpg'))
    if (files.length <= MAX_CACHED_FILES) return
    const aged = files
      .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => a.at - b.at)
      .slice(0, files.length - MAX_CACHED_FILES)
    for (const entry of aged) unlinkSync(join(dir, entry.name))
    log?.(`缩略图缓存清理 ${aged.length} 个`)
  } catch {
    // 清理失败不影响出图
  }
}
