/** mock keeper-tts。形状按 dock 仓库 companion/tts/server.py 实测（含 T4 新增的 OpenAI 兼容端点）。 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export interface MockKeeper {
  server: Server
  url: string
  speechRequests: { input: string; speed?: number; format?: string }[]
  stopped: number
  ready: boolean
  /** 让 /v1/audio/speech 抛 InterruptedError → 502 stopped */
  interrupt: boolean
  close(): Promise<void>
}

const TOKEN = ''

export function createMockKeeper(options: { port?: number; ready?: boolean; wav?: Buffer } = {}): Promise<MockKeeper> {
  const state = {
    speechRequests: [] as { input: string; speed?: number; format?: string }[],
    stopped: 0,
    ready: options.ready ?? true,
    interrupt: false,
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      respond(response, 500, { error: { code: 'internal', message: 'mock 崩了' } })
    })
  })

  function respond(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(body))
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? '/').split('?')[0] ?? '/'
    const body = await readBody(request)

    if (path === '/health' && request.method === 'GET') {
      respond(response, 200, {
        ok: true,
        service: 'helm-companion-tts',
        ready: state.ready,
        model: '/models/Qwen3-TTS-12Hz-1.7B-Base-4bit',
        voice: 'shorekeeper',
        clone: true,
        play: true,
        speed: 1.0,
        error: null,
      })
      return
    }
    if (path === '/v1/stop' && request.method === 'POST') {
      state.stopped += 1
      respond(response, 200, { ok: true, stopped: true })
      return
    }
    if (path === '/v1/audio/speech' && request.method === 'POST') {
      if (!state.ready) {
        respond(response, 503, { error: { code: 'not_ready', message: '模型加载中' } })
        return
      }
      const input = typeof body.input === 'string' ? body.input : ''
      if (!input.trim()) {
        respond(response, 400, { error: { code: 'bad_request', message: 'input 不能为空' } })
        return
      }
      const format = typeof body.response_format === 'string' ? body.response_format : 'wav'
      if (format !== 'wav' && format !== 'pcm') {
        respond(response, 400, { error: { code: 'unsupported_format', message: `response_format 只支持 wav / pcm，收到 ${format}` } })
        return
      }
      const entry: { input: string; speed?: number; format?: string } = { input, format }
      if (typeof body.speed === 'number') entry.speed = body.speed
      state.speechRequests.push(entry)
      if (state.interrupt) {
        respond(response, 502, { error: { code: 'stopped', message: '已被 /v1/stop 打断' } })
        return
      }
      const payload = options.wav ?? wavFixture()
      response.writeHead(200, {
        'Content-Type': format === 'wav' ? 'audio/wav' : 'audio/pcm',
        'Content-Length': payload.byteLength,
        'Cache-Control': 'no-store',
        'X-First-Audio-Ms': '123',
      })
      response.end(payload)
      return
    }
    respond(response, 404, { error: { code: 'not_found', message: '未知接口' } })
  }

  function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        if (!raw) return resolve({})
        try {
          resolve(JSON.parse(raw) as Record<string, unknown>)
        } catch {
          resolve({})
        }
      })
    })
  }

  void TOKEN

  return new Promise((resolve) => {
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        get speechRequests() {
          return state.speechRequests
        },
        get stopped() {
          return state.stopped
        },
        get ready() {
          return state.ready
        },
        set ready(value: boolean) {
          state.ready = value
        },
        get interrupt() {
          return state.interrupt
        },
        set interrupt(value: boolean) {
          state.interrupt = value
        },
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

function wavFixture(): Buffer {
  // 44 字节标准头 + 200 字节 16bit 数据（够断言用，不必真出声）
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + 200, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(24000, 24)
  header.writeUInt32LE(48000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(200, 40)
  return Buffer.concat([header, Buffer.alloc(200)])
}
