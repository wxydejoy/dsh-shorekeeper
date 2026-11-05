/** keeper-voice 工具面：试听、打断、健康状态。
 *
 * 正式说话链路不走工具——是 dsh-tts 的 `custom` provider 配置接线
 * （provider: custom + customBaseUrl 指到 keeper-tts /v1/audio/speech），
 * 见 docs/decisions-voice-provider.md。
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { KeeperClient, KeeperRequestError } from './keeper-client.ts'

export interface KeeperToolDeps {
  client: KeeperClient
  config: { speed: number; sampleText: string }
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

function degrade(error: unknown): { ok: false; degraded: string } {
  if (error instanceof KeeperRequestError) {
    if (error.status === 0) return { ok: false, degraded: `keeper-tts 不可达（${error.code}）：服务没起或地址不对` }
    if (error.status === 401) return { ok: false, degraded: 'keeper-tts 拒绝了口令：检查插件设置里的 token' }
    if (error.status === 503) return { ok: false, degraded: 'keeper-tts 还没就绪（模型加载中）：稍后再试' }
    if (error.status === 502 && error.code === 'stopped') return { ok: false, degraded: '试听被 /v1/stop 打断' }
    return { ok: false, degraded: `keeper-tts 返回 ${error.status}：${error.message}` }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, degraded: `keeper-voice 工具失败：${message}` }
}

function summaryOf(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'summary' in value) {
    const summary = (value as { summary?: unknown }).summary
    if (typeof summary === 'string') return summary
  }
  return 'keeper-voice 完成'
}

export function createKeeperTools(deps: KeeperToolDeps): ToolDefinition[] {
  const { client, config } = deps

  const status = defineTool({
    name: 'keeper.status',
    description: '查看 keeper-tts 服务状态：模型、克隆音色、语速、就绪度。排查「她怎么不说话」从这里开始。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute() {
      try {
        const health = await client.health()
        return {
          ok: true,
          ready: health.ready,
          clone: health.clone,
          voice: health.voice,
          speed: health.speed,
          error: health.error,
          summary: health.ready
            ? `keeper-tts 就绪：克隆=${health.clone ? '开' : '关'} 音色=${health.voice} 语速=${health.speed}`
            : `keeper-tts 未就绪：${health.error ?? '模型加载中'}`,
        } satisfies Json
      } catch (error) {
        return degrade(error) satisfies Json
      }
    },
  })

  const voiceTest = defineTool({
    name: 'keeper.voice_test',
    description: '用守岸人的克隆音色合成一段试听（OpenAI 兼容 /v1/audio/speech）。返回音频字节与首包延迟；不出本机喇叭，由 dsh-tts 播放器播。',
    parameters: {
      text: { type: 'string', description: '试听文本；缺省用插件设置里的 sampleText' },
      speed: { type: 'number', description: '语速 0.7–1.5；缺省用插件设置' },
      format: { type: 'string', enum: ['wav', 'pcm'], description: '返回格式，缺省 wav' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute(args) {
      try {
        const text = typeof args.text === 'string' && args.text.trim() ? args.text.trim() : config.sampleText
        const speed = typeof args.speed === 'number' ? args.speed : config.speed
        const format = args.format === 'pcm' ? 'pcm' : 'wav'
        const result = await client.speech({ input: text, speed, format })
        return {
          ok: true,
          bytes: result.audio.byteLength,
          contentType: result.contentType,
          firstAudioMs: result.firstAudioMs,
          text,
          summary: `试听合成成功：${result.audio.byteLength} 字节（${result.contentType}），首包 ${result.firstAudioMs}ms`,
        } satisfies Json
      } catch (error) {
        return degrade(error) satisfies Json
      }
    },
  })

  const stop = defineTool({
    name: 'keeper.stop',
    description: '立刻打断 keeper-tts：清掉本机喇叭播放队列、作废在途合成（幂等）。语音会话里的 barge-in 由 dsh-tts 播放器先行，这里是兜底。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute() {
      try {
        await client.stop()
        return { ok: true, summary: 'keeper-tts 已停止（播放队列清空、在途合成作废）' } satisfies Json
      } catch (error) {
        return degrade(error) satisfies Json
      }
    },
  })

  // F31 白噪音（helper desk/companion_desk._run_noise 对标）：雨声/海浪/风扇/白噪音，到点自动淡出
  const NOISE_LABELS: Record<string, string> = { rain: '雨声', waves: '海浪', fan: '风扇', brown: '白噪音' }

  const noise = defineTool({
    name: 'keeper.noise',
    description:
      '放/停白噪音（本机喇叭）：雨声/海浪/风扇/白噪音，到点自动淡出（默认 30 分钟，最长 180）。适合「放点白噪音」「雨声助眠」「把声音停了」。写 off 或不传 name 就是停。',
    parameters: {
      name: { type: 'string', enum: ['rain', 'waves', 'fan', 'brown', 'off'], description: 'rain=雨声 waves=海浪 fan=风扇 brown=白噪音；off=停' },
      minutes: { type: 'number', description: '放多久（分钟），1-180；缺省 30' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: summaryOf(value) }],
    },
    async execute(args) {
      try {
        const raw = typeof args.name === 'string' ? args.name.trim().toLowerCase() : ''
        const name = (['rain', 'waves', 'fan', 'brown', 'off'].includes(raw) ? raw : '') as 'rain' | 'waves' | 'fan' | 'brown' | 'off' | ''
        if (!name) {
          return { ok: false, degraded: 'name 要填 rain/waves/fan/brown/off', summary: '参数不对' } satisfies Json
        }
        const minutes = typeof args.minutes === 'number' && args.minutes >= 1 && args.minutes <= 180 ? Math.round(args.minutes) : undefined
        if (name === 'off') {
          await client.noise('off')
          return { ok: true, name: 'off', summary: '白噪音停了。' } satisfies Json
        }
        const state = await client.noise(name, minutes)
        if (!state.ok) {
          return { ok: false, degraded: '白噪音没放成', summary: '这次没动成。' } satisfies Json
        }
        const label = NOISE_LABELS[name] ?? '白噪音'
        const mins = state.minutes ?? minutes ?? 30
        return {
          ok: true,
          name,
          minutes: mins,
          seconds_left: state.seconds_left ?? 0,
          summary: `${label}放上了，${mins} 分钟后自己淡出。`,
        } satisfies Json
      } catch (error) {
        return degrade(error) satisfies Json
      }
    },
  })

  return [status, voiceTest, stop, noise]
}
