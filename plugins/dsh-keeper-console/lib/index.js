// dsh-keeper-console — host half.
//
// One RPC channel (/keeper-console) serves the sidebar panel. It is a thin
// control plane over three stores, no model round-trip anywhere:
//
//   1. profile patch (cordis.patch.yml) — direct line surgery on the plugin's
//      insert row. The host loader watches the file and hot-reloads (proven:
//      volatile values take effect in seconds, no restart). The host settings
//      service / ConfigEditor path rejects patch-fed namespaces, so this is
//      the supported route.
//   2. ~/.dsh/keeper-settings.json — live overrides for our own plugins
//      (keeper-watch / desk-mi read this file per tick / per execute).
//   3. keeper-tts liveness probe (127.0.0.1:18100) for the status dot.
//
// Actions:
//   snapshot   all toggle states + statuses
//   setTts     { speakReplies?, speakAsItGoes? }
//   setVoice   { readAloudOn? }   — voice-mode readAloud 'voice' | 'off'
//   setKeeper  { watch?: {...}, deskMi?: {...} } — merge into overrides file

import { readFile, rename, writeFile } from 'node:fs/promises'
import { homedir, networkInterfaces } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-keeper-console'
export const inject = ['connection']

const OVERRIDES_FILE_NAME = 'keeper-settings.json'

function overridesPath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), OVERRIDES_FILE_NAME)
}

const TTS_NS = 'dsh-tts'
const VOICE_NS = 'voice-mode'

async function readOverrides() {
  try {
    const raw = JSON.parse(await readFile(overridesPath(), 'utf8'))
    return {
      watch: raw && typeof raw.watch === 'object' && raw.watch ? raw.watch : {},
      deskMi: raw && typeof raw.deskMi === 'object' && raw.deskMi ? raw.deskMi : {},
    }
  } catch {
    return { watch: {}, deskMi: {} }
  }
}

async function writeOverrides(next) {
  const file = overridesPath()
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  await rename(tmp, file)
}

async function keeperTtsAlive() {
  try {
    // keeper-tts 没有 /v1/models 路由（404 也算活着）——只要 HTTP 有响应就是服务在听
    await fetch('http://127.0.0.1:18100/v1/models', { signal: AbortSignal.timeout(1_500) })
    return true
  } catch {
    return false
  }
}

/** 本进程 webServer 的自访地址（用于读各插件 HTTP config 的生效值）。
 *  端口取 launchd 参数 --port；地址依次试 loopback 与本机 IPv4。赢家缓存。
 */
let cachedBase = null
function selfBaseUrlCandidates() {
  const args = process.argv
  let port = '3090'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = String(args[i + 1])
  }
  const ips = []
  try {
    for (const list of Object.values(networkInterfaces())) {
      for (const ni of list ?? []) {
        if (ni.family === 'IPv4' && !ni.internal) ips.push(ni.address)
      }
    }
  } catch {
    // 接口枚举失败就用 loopback 兜着
  }
  return [`http://127.0.0.1:${port}`, ...ips.map((ip) => `http://${ip}:${port}`)]
}

async function fetchJson(base, path) {
  try {
    const resp = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(2_500) })
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}

async function fetchEffective() {
  let base = cachedBase
  if (!base) {
    for (const candidate of selfBaseUrlCandidates()) {
      if (await fetchJson(candidate, '/dsh-tts/config')) {
        cachedBase = base = candidate
        break
      }
    }
  }
  if (!base) return { ttsFull: null, voice: {} }
  const [ttsRaw, voice] = await Promise.all([fetchJson(base, '/dsh-tts/config'), fetchJson(base, '/voice-mode/config')])
  // dsh-tts 的 configResponse 把生效值包在 config 键里（另含 revision）；voice-mode 是平铺的
  const ttsFull = ttsRaw && typeof ttsRaw.config === 'object' && ttsRaw.config ? ttsRaw : null
  return { ttsFull, voice: voice ?? {} }
}

async function readEffective() {
  const { ttsFull, voice } = await fetchEffective()
  return { tts: (ttsFull && ttsFull.config) ?? {}, voice: voice ?? {} }
}

/** profile patch 文件路径（cordis.patch.yml）。profile 名取 launchd 参数 --profile。 */
function patchFilePath() {
  let profile = 'web'
  const args = process.argv
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) profile = String(args[i + 1])
  }
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', profile, 'cordis.patch.yml')
}

/** 把变更写进 profile patch 里指定插件行的 config 段（行级手术，保留注释）。
 *
 * 实证：宿主 loader 监听 patch 文件，外部修改会热重载（volatile 字段立即生效），
 * 不用重启。布尔/数字直写；字符串加单引号（YAML）。原子写，watcher 不怕中间态。
 */
async function patchRowFlip(ns, change) {
  const file = patchFilePath()
  const raw = await readFile(file, 'utf8')
  const lines = raw.split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp('^\\s*- id:\\s*' + ns + '\\s*(#.*)?$').test(lines[i])) {
      start = i
      break
    }
  }
  if (start < 0) throw Object.assign(new Error(`patch 里找不到 ${ns} 的行`), { code: 'no_entry' })
  const idIndent = lines[start].match(/^\s*/)[0].length
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    if (line.match(/^\s*/)[0].length <= idIndent) {
      end = i
      break
    }
  }
  for (const [key, value] of Object.entries(change)) {
    const rendered = typeof value === 'string' ? `'${value}'` : String(value)
    const keyRe = new RegExp('^(\\s*)' + key + ':\\s*(.*?)\\s*(#.*)?$')
    let hit = false
    for (let i = start; i < end; i++) {
      const m = lines[i].match(keyRe)
      if (m) {
        lines[i] = `${m[1]}${key}: ${rendered}${m[3] ? ' ' + m[3] : ''}`
        hit = true
        break
      }
    }
    if (!hit) {
      for (let i = start; i < end; i++) {
        if (/^\s*config:\s*$/.test(lines[i])) {
          const configIndent = lines[i].match(/^\s*/)[0]
          lines.splice(i + 1, 0, `${configIndent}  ${key}: ${rendered}`)
          hit = true
          break
        }
      }
    }
    if (!hit) throw Object.assign(new Error(`${ns} 行里找不到 ${key}，也没有 config: 锚点`), { code: 'no_key' })
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, lines.join('\n'), 'utf8')
  await rename(tmp, file)
}

export function apply(ctx) {
  async function snapshot() {
    const [effective, overrides, ttsAlive] = await Promise.all([readEffective(), readOverrides(), keeperTtsAlive()])
    const ttsValue = effective.tts
    const voiceValue = effective.voice
    return {
      tts: {
        speakReplies: ttsValue.speakReplies === true,
        speakAsItGoes: ttsValue.speakAsItGoes === true,
        available: Object.keys(ttsValue).length > 0,
      },
      voice: {
        readAloudOn: voiceValue.readAloud !== 'off',
        available: Object.keys(voiceValue).length > 0,
      },
      watch: {
        enabled: overrides.watch.enabled !== false,
        quietEnabled: overrides.watch.quietEnabled !== false,
        dailyLimit: Number.isFinite(overrides.watch.dailyLimit) ? overrides.watch.dailyLimit : null,
      },
      deskMi: {
        controlEnabled: overrides.deskMi.controlEnabled === true,
        controlPerMinute: Number.isFinite(overrides.deskMi.controlPerMinute) ? overrides.deskMi.controlPerMinute : null,
      },
      status: { keeperTtsAlive: ttsAlive },
    }
  }

  ctx.connection.register(ctx, '/keeper-console', async (action, payload) => {
    try {
      switch (action) {
        case 'snapshot':
          return { ok: true, value: await snapshot() }

        case 'setTts': {
          const fields = {}
          if (typeof payload?.speakReplies === 'boolean') fields.speakReplies = payload.speakReplies
          if (typeof payload?.speakAsItGoes === 'boolean') fields.speakAsItGoes = payload.speakAsItGoes
          if (Object.keys(fields).length === 0) throw Object.assign(new Error('没有可写的字段'), { code: 'empty_patch' })
          await patchRowFlip(TTS_NS, fields)
          return { ok: true, value: { patched: fields } }
        }

        case 'setVoice': {
          if (typeof payload?.readAloudOn !== 'boolean') {
            throw Object.assign(new Error('readAloudOn 必须是布尔'), { code: 'bad_patch' })
          }
          await patchRowFlip(VOICE_NS, { readAloud: payload.readAloudOn ? 'voice' : 'off' })
          return { ok: true, value: { patched: { readAloud: payload.readAloudOn ? 'voice' : 'off' } } }
        }

        case 'setKeeper': {
          const current = await readOverrides()
          const next = { watch: { ...current.watch }, deskMi: { ...current.deskMi } }
          const watch = payload?.watch
          if (watch && typeof watch === 'object') {
            if (typeof watch.enabled === 'boolean') next.watch.enabled = watch.enabled
            if (typeof watch.quietEnabled === 'boolean') next.watch.quietEnabled = watch.quietEnabled
            if (typeof watch.dailyLimit === 'number' && Number.isFinite(watch.dailyLimit) && watch.dailyLimit >= 0) {
              next.watch.dailyLimit = Math.floor(watch.dailyLimit)
            }
          }
          const deskMi = payload?.deskMi
          if (deskMi && typeof deskMi === 'object') {
            if (typeof deskMi.controlEnabled === 'boolean') next.deskMi.controlEnabled = deskMi.controlEnabled
            if (
              typeof deskMi.controlPerMinute === 'number' &&
              Number.isFinite(deskMi.controlPerMinute) &&
              deskMi.controlPerMinute >= 0
            ) {
              next.deskMi.controlPerMinute = Math.floor(deskMi.controlPerMinute)
            }
          }
          await writeOverrides(next)
          return { ok: true, value: next }
        }

        default:
          throw Object.assign(new Error(`unknown action: ${action}`), { code: 'bad_action' })
      }
    } catch (error) {
      // 信封契约：error.code/message 必须是字符串且 details 必须是对象（连接层严格校验）
      return {
        ok: false,
        error: {
          code: String((error && error.code) || 'keeper-console/error'),
          message: String((error && error.message) || error),
          details: (error && error.details) || {},
        },
      }
    }
  })

  ctx.logger('keeper-console').info('keeper-console 就绪：面板通道 /keeper-console 已挂')
}
