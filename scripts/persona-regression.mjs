#!/usr/bin/env node
/**
 * Z7 · 守岸人人格回归执行器
 *
 * 跑法：node scripts/persona-regression.mjs [--filter <id>] [--out <report.json>]
 *
 * 原理：dsh headless 一枪模式（`dsh --profile <p> --patch <overlay> "<msg>"`）。
 * headless 下 dsh-tavern 插件 pending（T3 实证天花板：tavern 等 webServer），卡与
 * 世界书注入不可用——本执行器改为**程序化合成 tavern 等价注入**：读仓库里
 * content/shorekeeper-card/{character,worldbook}.json 当前内容，按 tavern 的组合
 * 顺序（描述/性格/场景/示例对话 + 常驻条款 + 关键词触发条款）拼进 persona prefix，
 * 以 JSON 形态 YAML overlay（YAML 是 JSON 超集，绕开 T3 的手写缩进坑）经 --patch
 * 覆盖 profile 层。这样回归测的是**卡与书的当前真身**：改卡不改剧本，卡改了
 * 下一轮跑批立即生效，无档案漂移。
 * tavern 面板运行时注入格式的差异（世界书关键词触发的 token 预算等）仍归 web 端，
 * 断言三类：control（控制句不剧情化）/ persona（称呼与声线）/ leak（无脚手架泄漏）。
 *
 * 凭据：ZHIPU_API_KEY 从全局 refs（~/.dsh/.credentials.yaml）读出后只进子进程
 * 环境变量，不写文件、不进日志。
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CARD_DIR = join(ROOT, 'content/shorekeeper-card')
const PROFILE = process.env.Z7_PROFILE ?? 'shorekeeper-reg'
const DSH = process.env.Z7_DSH ?? '/opt/homebrew/bin/dsh'

const args = process.argv.slice(2)
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const FILTER = argOf('--filter')
const OUT = argOf('--out') ?? join(tmpdir(), `z7-report-${Date.now()}.json`)

// ---------- 1. 载入卡与书（仓库真身） ----------
const card = JSON.parse(readFileSync(join(CARD_DIR, 'character.json'), 'utf8')).data
const wb = JSON.parse(readFileSync(join(CARD_DIR, 'worldbook.json'), 'utf8'))
const wbEntries = (Array.isArray(wb.entries) ? wb.entries : Object.values(wb.entries))
  .filter((e) => !e.disable)
const constantEntries = wbEntries.filter((e) => e.constant)
const keywordEntries = wbEntries.filter((e) => !e.constant)
const matchKeyword = (text, e) => {
  const keys = e.key ?? e.keys ?? []
  return keys.some((k) => String(k) !== '' && text.toLowerCase().includes(String(k).toLowerCase()))
}

// ---------- 2. 合成 tavern 等价 persona prefix ----------
const cardBlock = [
  `# 角色卡：${card.name}`,
  card.description,
  card.personality ? `【性格】\n${card.personality}` : '',
  card.scenario ? `【场景】\n${card.scenario}` : '',
  card.mes_example ? `【示例对话】\n${card.mes_example}` : '',
  card.first_mes ? `【开场白（仅供参考，不要复读）】\n${card.first_mes}` : '',
  card.post_history_instructions ? `【每轮回复前自检】\n${card.post_history_instructions}` : '',
].filter(Boolean).join('\n\n')

const wbBlock = (entries, title) => entries.length
  ? `# 世界书 · ${title}\n` + entries.map((e) => `## ${e.comment ?? e.name}\n${e.content}`).join('\n\n')
  : ''

const frameBlock = [
  '# 写作要求',
  '你在扮演上面的角色，严格按角色卡与世界书行事：先分流（办事→报数→工具），后陪伴。',
  '控制与查询走工具（本环境工具面可能缺失，缺失时诚实说明怎么办，绝不装成功、不编数）。',
  '陪伴时守声线：慢、短、轻、静，偏诗意，不卖萌，不煽情，不用感叹号。',
  '所有思考与回复用中文。',
].join('\n')

// tavern 模板变量在 headless 的 system-prompt 模板引擎里不认识（UNKNOWN:
// unknown prompt variable "{{user}}"），合成时替换成卡内实名。
const expandTavernVars = (s) => String(s).replaceAll('{{char}}', '守岸人').replaceAll('{{user}}', '漂泊者')

const buildPrefix = (msg) => [
  cardBlock,
  wbBlock(constantEntries, '常驻条款'),
  wbBlock(keywordEntries.filter((e) => matchKeyword(msg, e)), '触发条款（本轮命中）'),
  frameBlock,
].filter(Boolean).join('\n\n')

// ---------- 3. overlay（JSON 即合法 YAML，规避手写缩进） ----------
// 覆盖点：headless 的 persona 注入在 @deepseek-ai/dsh-system-prompt 的 personaPrefix
// （--dump-config 实证：树里没有 id:persona 行，hl/T3 的 - id: persona 覆盖一直是
// 静默无效——id 覆盖只打在树里已存在的行上，目标行缺失仅告警）。
const tmpDir = mkdtempSync(join(tmpdir(), 'z7-overlay-'))
const overlayPath = join(tmpDir, 'persona-overlay.yml')
const writeOverlay = (msg) => {
  const overlay = [
    {
      id: 'system-prompt',
      name: '@deepseek-ai/dsh-system-prompt',
      config: { personaPrefix: expandTavernVars(buildPrefix(msg)) },
    },
  ]
  // 顶层数组格式与 profile 模板一致
  writeFileSync(overlayPath, JSON.stringify(overlay, null, 2), 'utf8')
}

// ---------- 4. 凭据（refs 全局文件 → 子进程 env，不落盘） ----------
function readZhipuKey() {
  const p = join(homedir(), '.dsh/.credentials.yaml')
  const text = readFileSync(p, 'utf8')
  const m = text.match(/^ {2}ZHIPU_API_KEY:[ \t]*"?([^\s"]+)"?[ \t]*$/m)
  if (!m) throw new Error('~/.dsh/.credentials.yaml 的 refs 里找不到 ZHIPU_API_KEY（行格式与预期不符）')
  return m[1]
}

// ---------- 5. 断言 ----------
const GLOBAL_LEAK = [
  { re: /<weixin_[a-z_]+>/i, desc: 'weixin 标签泄漏' },
  { re: /这次主动发的是/, desc: '主动消息脚手架原话泄漏' },
  { re: /别把这段状态/, desc: '状态块提示词原话泄漏' },
  { re: /^当前状态：/m, desc: '状态块回声' },
  { re: /<\/?(tool_call|function_call|invoke|tool_result)>/i, desc: '工具调用记号泄漏' },
  { re: /【工具调用|<\|.*?\|>/, desc: '工具记号样式泄漏' },
  { re: /[！!]/, desc: '感叹号（REGRESSION.md F27 全局红线）' },
]
const runOnce = (msg) => {
  writeOverlay(msg)
  const env = { ...process.env, ZHIPU_API_KEY: readZhipuKey() }
  delete env.NODE_OPTIONS // WorkBuddy/zcode shim（brokered-fs）会劫持 dsh 存储（T7 实证坑）
  const r = spawnSync(DSH, ['--profile', PROFILE, '--patch', overlayPath, msg], {
    encoding: 'utf8', timeout: 120_000, env, cwd: tmpDir,
  })
  if (r.status !== 0) {
    const errTail = String(r.stderr ?? '').split('\n').filter(Boolean).slice(-2).join(' / ')
    return { reply: null, error: `exit=${r.status} ${errTail}` }
  }
  return { reply: String(r.stdout ?? '').trim(), error: null }
}

const evaluate = (sc, reply) => {
  if (reply == null) return [{ type: 'env', ok: false, desc: '进程失败', sample: sc.error }]
  // 断言在「折叠换行」后的全文上跑：回复常多行，而 `^…$` 不带 m/s 时 `.` 不过行尾
  const flat = reply.replace(/\s*\n+\s*/g, ' ')
  const fails = []
  for (const g of GLOBAL_LEAK) {
    if (g.re.test(reply)) fails.push({ type: 'leak', ok: false, desc: g.desc })
  }
  for (const ex of sc.expect ?? []) {
    const ok = new RegExp(ex.re, 'u').test(flat)
    if (!ok) fails.push({ type: ex.type, ok: false, desc: ex.desc })
  }
  return fails
}

// ---------- 6. 主循环 ----------
const scenarios = JSON.parse(readFileSync(join(CARD_DIR, 'regression/scenarios.json'), 'utf8')).scenarios
  .filter((s) => !FILTER || FILTER.split(',').includes(s.id))
const results = []
for (const sc of scenarios) {
  if (sc.env !== 'headless') {
    results.push({ id: sc.id, group: sc.group, skipped: true, reason: `env=${sc.env}（web 专属层）` })
    console.log(`⏭  ${sc.id}  ${sc.group}  跳过：${sc.env} 专属`)
    continue
  }
  process.stdout.write(`▶ ${sc.id} ${sc.send.slice(0, 24)}… `)
  const { reply, error } = runOnce(sc.send)
  const fails = evaluate(sc, reply)
  const ok = fails.length === 0
  console.log(ok ? '✅' : `❌ (${fails.map((f) => f.desc).join('；')})`)
  if (!ok) console.log(`   回复：${String(reply ?? error).slice(0, 160).replace(/\n/g, ' ⏎ ')}`)
  results.push({ id: sc.id, group: sc.group, send: sc.send, reply, error, fails, ok })
}

const ran = results.filter((r) => !r.skipped)
const passed = ran.filter((r) => r.ok)
console.log(`\n═══ Z7 回归：${passed.length}/${ran.length} 过（跳过 ${results.length - ran.length}，web 专属层）═══`)
writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), profile: PROFILE, results }, null, 2))
console.log(`报告：${OUT}`)
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }) } catch {} })
if (passed.length !== ran.length) process.exitCode = 1
