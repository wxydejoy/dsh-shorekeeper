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
// webServer：connection.register 内部会走 webServer.register 挂路由，缺声明会
// 「cannot get property "webServer" without inject」直接激活失败（k20 同款声明）。
export const inject = ['connection', 'webServer']

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

const WATCH_BASELINE = { enabled: true, quietEnabled: true, dailyLimit: 12 }
const DESK_BASELINE = { controlEnabled: false, controlPerMinute: 10 }

/** 插件行的文本块（含 id 行，不含下一条同级项）。找不到返回 ''。 */
export function pluginBlock(raw, ns) {
  const lines = String(raw).split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp('^\\s*- id:\\s*' + ns + '\\s*(#.*)?$').test(lines[i])) {
      start = i
      break
    }
  }
  if (start < 0) return ''
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
  return lines.slice(start, end).join('\n')
}

function flagIn(block, key, fallback) {
  const matched = block.match(new RegExp('^\\s*' + key + ':\\s*(true|false)\\b', 'm'))
  if (!matched) return fallback
  return matched[1] === 'true'
}

/** 键不在块里返回 undefined，好跟「没写、沿用 HTTP 生效值」区分开。 */
function flagOptional(block, key) {
  if (!block) return undefined
  const matched = block.match(new RegExp('^\\s*' + key + ':\\s*(true|false)\\b', 'm'))
  if (!matched) return undefined
  return matched[1] === 'true'
}

function enumIn(block, key, allowed) {
  if (!block) return undefined
  const matched = block.match(new RegExp('^\\s*' + key + ':\\s*[\'"]?([A-Za-z0-9_-]+)[\'"]?', 'm'))
  if (!matched || !allowed.includes(matched[1])) return undefined
  return matched[1]
}

function numIn(block, key, fallback) {
  const matched = block.match(new RegExp('^\\s*' + key + ':\\s*(-?\\d+(?:\\.\\d+)?)\\b', 'm'))
  if (!matched) return fallback
  const value = Number(matched[1])
  return Number.isFinite(value) ? value : fallback
}

/** quietHours 空数组或起止相同 = 关；有一段不同的窗口 = 开；没写这个键 = 用默认（开）。 */
function quietEnabledIn(block) {
  if (!block) return WATCH_BASELINE.quietEnabled
  if (/^\s*quietHours:\s*\[\s*\]\s*(#.*)?$/m.test(block)) return false
  const inline = block.match(/^\s*quietHours:\s*\[([^\]]*)\]/m)
  if (inline) {
    const parts = inline[1]
      .split(',')
      .map((part) => part.replace(/['"\s]/g, ''))
      .filter(Boolean)
    if (parts.length < 2) return false
    return parts[0] !== parts[1]
  }
  const times = []
  let inList = false
  for (const line of block.split('\n')) {
    if (/^\s*quietHours:\s*(#.*)?$/.test(line)) {
      inList = true
      continue
    }
    if (!inList) continue
    const item = line.match(/^\s*-\s*['"]?(\d{1,2}:\d{2})['"]?/)
    if (item) {
      times.push(item[1])
      continue
    }
    if (line.trim() !== '') break
  }
  if (times.length >= 2) return times[0] !== times[1]
  if (times.length === 1) return false
  return WATCH_BASELINE.quietEnabled
}

/** 从 profile patch 读两插件的基线。缺行时用 schema 默认，而不是把开关画成固定开/关。 */
export function readKeeperBaselines(raw) {
  const watch = pluginBlock(raw, 'dsh-keeper-watch')
  const desk = pluginBlock(raw, 'dsh-shorekeeper-desk-mi')
  return {
    watch: {
      enabled: flagIn(watch, 'enabled', WATCH_BASELINE.enabled),
      quietEnabled: quietEnabledIn(watch),
      dailyLimit: numIn(watch, 'dailyLimit', WATCH_BASELINE.dailyLimit),
    },
    deskMi: {
      controlEnabled: flagIn(desk, 'controlEnabled', DESK_BASELINE.controlEnabled),
      controlPerMinute: numIn(desk, 'controlPerMinute', DESK_BASELINE.controlPerMinute),
    },
  }
}

/** 覆盖叠到基线，语义与两插件的 apply*Overrides 一致。 */
export function mergeKeeperView(baselines, overrides) {
  const watch = overrides.watch && typeof overrides.watch === 'object' ? overrides.watch : {}
  const desk = overrides.deskMi && typeof overrides.deskMi === 'object' ? overrides.deskMi : {}
  return {
    watch: {
      enabled: typeof watch.enabled === 'boolean' ? watch.enabled : baselines.watch.enabled,
      quietEnabled: watch.quietEnabled === false ? false : baselines.watch.quietEnabled,
      dailyLimit: Number.isFinite(watch.dailyLimit) ? watch.dailyLimit : baselines.watch.dailyLimit,
    },
    deskMi: {
      controlEnabled: typeof desk.controlEnabled === 'boolean' ? desk.controlEnabled : baselines.deskMi.controlEnabled,
      controlPerMinute: Number.isFinite(desk.controlPerMinute) ? desk.controlPerMinute : baselines.deskMi.controlPerMinute,
    },
  }
}

/** 面板写进 profile patch 的那几个开关。缺键 = 这块 patch 没管，留给 HTTP 生效值。 */
export function readPanelPatch(raw) {
  const tts = pluginBlock(String(raw ?? ''), TTS_NS)
  const voice = pluginBlock(String(raw ?? ''), VOICE_NS)
  return {
    tts: {
      speakReplies: flagOptional(tts, 'speakReplies'),
      speakAsItGoes: flagOptional(tts, 'speakAsItGoes'),
    },
    voice: {
      readAloud: enumIn(voice, 'readAloud', ['voice', 'off']),
    },
  }
}

export function shapeSnapshot({ tts, voice, baselines, overrides, ttsAlive, patchFlags }) {
  const keeper = mergeKeeperView(baselines, overrides)
  const ttsValue = tts && typeof tts === 'object' ? { ...tts } : {}
  const voiceValue = voice && typeof voice === 'object' ? { ...voice } : {}
  // available 看 HTTP 有没有拉到配置。patch 覆盖只改开关值，不把「拉失败」画成可用。
  const ttsAvailable = Object.keys(ttsValue).length > 0
  const voiceAvailable = Object.keys(voiceValue).length > 0
  const flags = patchFlags && typeof patchFlags === 'object' ? patchFlags : {}
  const ttsFlags = flags.tts && typeof flags.tts === 'object' ? flags.tts : {}
  const voiceFlags = flags.voice && typeof flags.voice === 'object' ? flags.voice : {}
  // 宿主热重载要一两秒才把 patch 反映进 /dsh-tts/config。这段窗口里 HTTP 仍是旧值，
  // 开关若跟着它画，按下后会停在原位直到重载结束。patch 是刚写完的真值，优先。
  if (typeof ttsFlags.speakReplies === 'boolean') ttsValue.speakReplies = ttsFlags.speakReplies
  if (typeof ttsFlags.speakAsItGoes === 'boolean') ttsValue.speakAsItGoes = ttsFlags.speakAsItGoes
  if (voiceFlags.readAloud === 'voice' || voiceFlags.readAloud === 'off') voiceValue.readAloud = voiceFlags.readAloud
  return {
    tts: {
      speakReplies: ttsValue.speakReplies === true,
      speakAsItGoes: ttsValue.speakAsItGoes === true,
      available: ttsAvailable,
    },
    voice: {
      // 缺字段或非 'voice' 都是关。`!== 'off'` 会把拉配置失败画成开着。
      readAloudOn: voiceValue.readAloud === 'voice',
      available: voiceAvailable,
    },
    watch: keeper.watch,
    deskMi: keeper.deskMi,
    status: { keeperTtsAlive: ttsAlive === true },
  }
}

/** 打开其中一个朗读开关时关掉另一个，避免同一条回复读两遍。 */
export function normalizeTtsPatch(payload) {
  const fields = {}
  if (typeof payload?.speakReplies === 'boolean') fields.speakReplies = payload.speakReplies
  if (typeof payload?.speakAsItGoes === 'boolean') fields.speakAsItGoes = payload.speakAsItGoes
  if (fields.speakReplies === true) fields.speakAsItGoes = false
  if (fields.speakAsItGoes === true) fields.speakReplies = false
  return fields
}

/** 把变更写进 profile patch 文本里指定插件行的 config 段（行级手术，保留注释）。
 *  布尔/数字直写；字符串加单引号（YAML）。插入新键后把块尾下标往后挪，
 *  否则同一次改两个键时，后一个键会落到块外、再插出一份重复行。
 */
export function applyPatchText(raw, ns, change) {
  const lines = String(raw).split('\n')
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
    const rendered = typeof value === 'string' ? `'${String(value).replace(/'/g, "''")}'` : String(value)
    const keyRe = new RegExp('^(\\s*)' + key + ':\\s*(.*?)\\s*(#.*)?$')
    let hit = false
    for (let i = start; i < end; i++) {
      const matched = lines[i].match(keyRe)
      if (matched) {
        lines[i] = `${matched[1]}${key}: ${rendered}${matched[3] ? ' ' + matched[3] : ''}`
        hit = true
        break
      }
    }
    if (!hit) {
      for (let i = start; i < end; i++) {
        if (/^\s*config:\s*$/.test(lines[i])) {
          const configIndent = lines[i].match(/^\s*/)[0]
          lines.splice(i + 1, 0, `${configIndent}  ${key}: ${rendered}`)
          end += 1
          hit = true
          break
        }
      }
    }
    if (!hit) throw Object.assign(new Error(`${ns} 行里找不到 ${key}，也没有 config: 锚点`), { code: 'no_key' })
  }
  return lines.join('\n')
}

/** 把变更写进 profile patch 文件。宿主 loader 监听文件，外部修改会热重载。 */
async function patchRowFlip(ns, change) {
  const file = patchFilePath()
  const raw = await readFile(file, 'utf8')
  const next = applyPatchText(raw, ns, change)
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, next, 'utf8')
  await rename(tmp, file)
}

export function apply(ctx) {
  async function snapshot() {
    const [effective, overrides, ttsAlive, patchRaw] = await Promise.all([
      readEffective(),
      readOverrides(),
      keeperTtsAlive(),
      readFile(patchFilePath(), 'utf8').catch(() => ''),
    ])
    return shapeSnapshot({
      tts: effective.tts,
      voice: effective.voice,
      baselines: readKeeperBaselines(patchRaw),
      overrides,
      patchFlags: readPanelPatch(patchRaw),
      ttsAlive,
    })
  }

  ctx.connection.register(ctx, '/keeper-console', async (action, payload) => {
    try {
      switch (action) {
        case 'snapshot':
          return { ok: true, value: await snapshot() }

        case 'setTts': {
          const fields = normalizeTtsPatch(payload)
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
