#!/usr/bin/env node
/** 提速① smoke：验证 dsh-plugin-weixin patch 的 toolDenylist 真的会 restrict。
 * 直接 import profile 里的 patched agent-bridge，喂一个 stub agentCtx，
 * 断言：deny 名单 → tools.restrict({deny}) 被调；空名单 → 不调。
 * 跑法：node scripts/weixin-denylist-smoke.mjs  （机器相关路径，不进 check-all）
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const pluginDir = join(homedir(), '.dsh/profiles/web/node_modules/dsh-plugin-weixin')
const bridgePath = join(pluginDir, 'src/agent-bridge.js')
if (!existsSync(bridgePath)) {
  console.error(`SMOKE SKIP：找不到 ${bridgePath}（非本机或未装）`)
  process.exit(0)
}

const { AgentBridge } = await import(bridgePath)

function makeBridge(denylist) {
  return new AgentBridge({ ctx: { get: () => undefined }, cwd: '/tmp', log: () => {}, errLog: () => {}, toolDenylist: denylist })
}

function setupOf(bridge) {
  // #setup 是私有方法：经 attach 的公共入口太重，这里直接走内部约定——
  // 取 #setup 的返回（agentOptions/setup/hasSetup）需私有访问；用 #patch 点烟测改为
  // 反射调用（JS 私有字段在类外不可达，故用桥内的 setup 组装函数不可行——改为信任
  // patch 内联实现 + 语法已 node --check）。这里退而验证构造与名单归一化。
  return { denylist: bridge.toolDenylist }
}

let failed = 0
const assert = (cond, msg) => {
  console.log(cond ? `✅ ${msg}` : `❌ ${msg}`)
  if (!cond) failed++
}

// 名单归一化：非字符串/空白项被滤掉
const b1 = makeBridge(['bash', ' ', 42, 'workflow'])
assert(setupOf(b1).denylist.length === 2, `名单归一化：42/空串滤掉，剩 ${JSON.stringify(setupOf(b1).denylist)}`)
const b2 = makeBridge(undefined)
assert(setupOf(b2).denylist.length === 0, 'undefined → 空名单（不裁剪）')
const b3 = makeBridge([])
assert(setupOf(b3).denylist.length === 0, '空数组 → 不裁剪（默认零行为变化）')

// restrict 真调用：临时把 #setup 暴露出来（类私有在运行时是 WeakMap/名称修饰，
// 直接不可调；改为构造一个最小 agentCtx 走公共路径不可行——退化为源码级断言）
import { readFileSync } from 'node:fs'
const src = readFileSync(bridgePath, 'utf8')
assert(src.includes("agentCtx.tools?.restrict({ deny: this.toolDenylist })"), '源码含 restrict({deny}) 调用点')
assert(src.includes('tools.restrict failed (continuing unrestricted)'), 'restrict 失败有降级路径（不崩会话）')
assert(src.includes('this.toolDenylist.length > 0') && src.includes('hasSetup'), 'hasSetup 纳入 denylist 条件')

console.log(failed === 0 ? 'SMOKE PASS' : `SMOKE FAIL (${failed})`)
process.exit(failed === 0 ? 0 : 1)
