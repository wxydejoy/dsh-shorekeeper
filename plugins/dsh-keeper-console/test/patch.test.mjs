import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { readFileSync } from 'node:fs'

import { applyPatchText, mergeKeeperView, normalizeTtsPatch, readKeeperBaselines, readPanelPatch, shapeSnapshot } from '../lib/index.js'

const PATCH = `
- id: dsh-tts
  config:
    speakReplies: true
- id: dsh-keeper-watch
  config:
    enabled: false
    dailyLimit: 8
    quietHours:
      - '23:00'
      - '07:00'
- id: dsh-shorekeeper-desk-mi
  config:
    controlEnabled: true
    controlPerMinute: 4
- id: voice-mode
  config:
    readAloud: 'off'
`

describe('applyPatchText', () => {
  it('缺的键插进 config，已有的键即使贴在块尾也能改到，不写出重复行', () => {
    const next = applyPatchText(PATCH, 'dsh-tts', { speakAsItGoes: true, speakReplies: false })
    const block = next.split('- id: dsh-keeper-watch')[0]
    assert.equal((block.match(/speakAsItGoes:/g) || []).length, 1)
    assert.equal((block.match(/speakReplies:/g) || []).length, 1)
    assert.match(block, /speakReplies: false/)
    assert.match(block, /speakAsItGoes: true/)
    assert.match(next, /- id: dsh-keeper-watch/)
  })

  it('找不到插件行就报 no_entry，不改原文', () => {
    assert.throws(() => applyPatchText(PATCH, 'missing', { enabled: true }), (error) => error.code === 'no_entry')
  })
})

describe('设置面板生效值', () => {
  it('覆盖缺字段时用 patch 基线，而不是把提醒画成开、把控灯画成关', () => {
    const baselines = readKeeperBaselines(PATCH)
    assert.equal(baselines.watch.enabled, false)
    assert.equal(baselines.watch.quietEnabled, true)
    assert.equal(baselines.watch.dailyLimit, 8)
    assert.equal(baselines.deskMi.controlEnabled, true)
    assert.equal(baselines.deskMi.controlPerMinute, 4)

    const view = mergeKeeperView(baselines, { watch: {}, deskMi: {} })
    assert.equal(view.watch.enabled, false)
    assert.equal(view.deskMi.controlEnabled, true)
    assert.equal(view.watch.dailyLimit, 8)
  })

  it('显式覆盖压过基线；免打扰只有显式 false 才关', () => {
    const baselines = readKeeperBaselines(PATCH)
    const view = mergeKeeperView(baselines, {
      watch: { enabled: true, quietEnabled: false, dailyLimit: 1 },
      deskMi: { controlEnabled: false },
    })
    assert.equal(view.watch.enabled, true)
    assert.equal(view.watch.quietEnabled, false)
    assert.equal(view.watch.dailyLimit, 1)
    assert.equal(view.deskMi.controlEnabled, false)
    assert.equal(view.deskMi.controlPerMinute, 4)
  })

  it('quietHours 空数组是关', () => {
    const baselines = readKeeperBaselines(`
- id: dsh-keeper-watch
  config:
    quietHours: []
`)
    assert.equal(baselines.watch.quietEnabled, false)
    assert.equal(baselines.watch.enabled, true)
  })

  it('语音模式内朗读：只有 readAloud===voice 才算开，拉不到配置不算开', () => {
    const on = shapeSnapshot({
      tts: { speakReplies: true },
      voice: { readAloud: 'voice' },
      baselines: readKeeperBaselines(''),
      overrides: { watch: {}, deskMi: {} },
      ttsAlive: true,
    })
    assert.equal(on.voice.readAloudOn, true)
    assert.equal(on.voice.available, true)

    const missing = shapeSnapshot({
      tts: { speakReplies: false },
      voice: {},
      baselines: readKeeperBaselines(''),
      overrides: { watch: {}, deskMi: {} },
      ttsAlive: false,
    })
    assert.equal(missing.voice.readAloudOn, false)
    assert.equal(missing.voice.available, false)
    assert.equal(missing.tts.available, true)
  })

  it('两个朗读开关同开时，后写上的那个留下，另一个关掉', () => {
    assert.deepEqual(normalizeTtsPatch({ speakReplies: true }), { speakReplies: true, speakAsItGoes: false })
    assert.deepEqual(normalizeTtsPatch({ speakAsItGoes: true }), { speakReplies: false, speakAsItGoes: true })
    assert.deepEqual(normalizeTtsPatch({ speakReplies: false }), { speakReplies: false })
  })

  it('热重载还没跟上时，开关画 patch 里刚写下的值，不画旧的 HTTP 生效值', () => {
    const snap = shapeSnapshot({
      tts: { speakReplies: true, speakAsItGoes: false, language: 'zh' },
      voice: { readAloud: 'off', rate: 1 },
      baselines: readKeeperBaselines(''),
      overrides: { watch: {}, deskMi: {} },
      ttsAlive: true,
      patchFlags: readPanelPatch(`
- id: dsh-tts
  config:
    speakReplies: false
    speakAsItGoes: true
- id: voice-mode
  config:
    readAloud: 'voice'
`),
    })
    assert.equal(snap.tts.speakReplies, false)
    assert.equal(snap.tts.speakAsItGoes, true)
    assert.equal(snap.tts.available, true)
    assert.equal(snap.voice.readAloudOn, true)
    assert.equal(snap.voice.available, true)
  })

  it('patch 没写的键继续用 HTTP 生效值，拉不到配置也不要把开关画成开', () => {
    const snap = shapeSnapshot({
      tts: { speakReplies: true },
      voice: {},
      baselines: readKeeperBaselines(''),
      overrides: { watch: {}, deskMi: {} },
      ttsAlive: false,
      patchFlags: readPanelPatch(`
- id: dsh-tts
  config:
    language: zh
`),
    })
    assert.equal(snap.tts.speakReplies, true)
    assert.equal(snap.tts.speakAsItGoes, false)
    assert.equal(snap.voice.readAloudOn, false)
    assert.equal(snap.voice.available, false)
  })
})

describe('按钮按下立刻改画', () => {
  const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const start = src.indexOf('function paintSnap(')
  const end = src.indexOf('function KeeperPanel(')
  const paintSnap = new Function(`${src.slice(start, end)}\nreturn paintSnap`)()

  const base = {
    tts: { speakReplies: false, speakAsItGoes: true, available: true },
    voice: { readAloudOn: false, available: true },
    watch: { enabled: true, quietEnabled: true, dailyLimit: 12 },
    deskMi: { controlEnabled: false, controlPerMinute: 10 },
    status: { keeperTtsAlive: true },
  }

  it('打开自动朗读时开关马上翻过去，并把另一个朗读关掉', () => {
    const next = paintSnap(base, 'setTts', { speakReplies: true })
    assert.equal(next.tts.speakReplies, true)
    assert.equal(next.tts.speakAsItGoes, false)
    assert.equal(base.tts.speakReplies, false)
  })

  it('热重载前的旧快照盖不住刚按下的值', () => {
    const stale = {
      ...base,
      tts: { speakReplies: false, speakAsItGoes: false, available: true },
      voice: { readAloudOn: false, available: true },
    }
    const next = paintSnap(stale, 'setVoice', { readAloudOn: true })
    assert.equal(next.voice.readAloudOn, true)
    assert.equal(next.tts.speakReplies, false)
  })

  it('数字在按下应用时就写进画面', () => {
    const next = paintSnap(base, 'setKeeper', { watch: { dailyLimit: 3 } })
    assert.equal(next.watch.dailyLimit, 3)
    assert.equal(next.watch.enabled, true)
  })
})

describe('新闻播报（news 段）', () => {
  // 面板半区是 classic script（没有 export），照「按钮按下立刻改画」的办法把函数切出来测
  const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const start = src.indexOf('function paintSnap(')
  const end = src.indexOf('function KeeperPanel(')
  const paintSnap = new Function(`${src.slice(start, end)}\nreturn paintSnap`)()

  const PATCH_NEWS = `${PATCH}
- id: dsh-keeper-news
  config:
    enabled: true
    morningAt: '07:45'
    eveningAt: ''
    count: 7
`

  it('基线从 profile patch 读（含空串时间点）', () => {
    const b = readKeeperBaselines(PATCH_NEWS)
    assert.equal(b.news.morningAt, '07:45')
    assert.equal(b.news.eveningAt, '')
    assert.equal(b.news.count, 7)
    assert.equal(b.news.enabled, true)
  })

  it('显式空串是「关掉这一档」，不回落默认值', () => {
    const b = readKeeperBaselines(PATCH_NEWS)
    const v = mergeKeeperView(b, { news: { morningAt: '' } })
    assert.equal(v.news.morningAt, '')
    assert.equal(v.news.count, 7)
  })

  it('没有 news 块时用默认，不把开关画成关', () => {
    const b = readKeeperBaselines(PATCH)
    assert.equal(b.news.enabled, true)
    assert.equal(b.news.morningAt, '08:30')
    assert.equal(b.news.eveningAt, '21:00')
    assert.equal(b.news.count, 5)
  })

  it('快照带上 news，按下后画面立刻改', () => {
    const b = readKeeperBaselines(PATCH_NEWS)
    const snap = shapeSnapshot({ tts: {}, voice: {}, baselines: b, overrides: {}, ttsAlive: true, patchFlags: {} })
    assert.equal(snap.news.count, 7)
    const next = paintSnap(snap, 'setKeeper', { news: { count: 3, morningAt: '' } })
    assert.equal(next.news.count, 3)
    assert.equal(next.news.morningAt, '')
    assert.equal(next.news.eveningAt, '')
  })
})
