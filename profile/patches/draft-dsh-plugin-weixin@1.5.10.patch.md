# dsh-plugin-weixin@1.5.10 升级预打草稿（zcode 2026-11-05 夜）
#
# 状态：草稿——未上机！1.4.3→1.5.10 语义核对过（wx-sub/wx-pro 两处正点替换、日报路径未动、
# 五个 denylist 锚点原样），语法 node --check 过。真升级流程仍按正规 pnpm patch 走：
#   pnpm patch dsh-plugin-weixin@1.5.10 → 本草稿的两段 diff 手工对齐应用（或参照）
#   → patch-commit → 配 toolDenylist → 重启 → 微信 in/out 回归 + journal 泄漏巡查。
#
# === index.js ===
--- /var/folders/d4/c5hbp8gn0c5g7hs_y4m78fsh0000gn/T//wx1510clean-d9qm/package/src/index.js	1985-10-26 16:15:00
+++ /var/folders/d4/c5hbp8gn0c5g7hs_y4m78fsh0000gn/T/wx1510patch-TCPs/package/src/index.js	2026-11-05 05:02:44
@@ -189,6 +189,19 @@
   describeMediaFailures,
 } from './media/inbound.js'
 
+/**
+ * 主动消息输出消毒（Z2b 补丁，1.5.10 重打版——语义与 1.4.3 补丁一致）。
+ */
+function sanitizeProactiveText(raw) {
+  let text = String(raw ?? '').trim()
+  if (text === '') return ''
+  const quoted = text.match(/这次主动发的是[：:]\s*[「『]?([^」』\n]+)[」』]?/)
+  if (quoted && quoted[1].trim() !== '') return quoted[1].trim()
+  text = text.replace(/<\/?weixin_proactive>/g, '').trim()
+  if (/别把这段状态/.test(text) || /^当前状态：/m.test(text)) return ''
+  return text
+}
+
 export const name = 'dsh-weixin'
 
 /**
@@ -373,6 +386,9 @@
   digestWhen: z.string().default(DEFAULT_DIGEST_WHEN).description('日报时间，形如「每天 21:00」或「每周五 18:30」。'),
   memoryReviewEnabled: z.boolean().default(true).description('每周到点发一条记忆核对：「我记住的这些还准吗」，你回 /remember 或 /forget 纠正。'),
   memoryReviewWhen: z.string().default(DEFAULT_REVIEW_WHEN).description('记忆核对时间，形如「每周日 20:00」。'),
+  toolDenylist: z.array(z.string()).default([]).description(
+    'Tool names to hide from Weixin conversations (Z7 提速). Applied per-conversation via tools.restrict({ deny }) on the agent scope; empty = no restriction (default).',
+  ),
   toolAudit: z.boolean().default(true).description(
     'Append one JSONL line per tool the agent runs (tool name, truncated arguments, which Weixin account/conversation/sender caused it, and whether the result carried an error) under <state>/audit/. Off by default nothing would ever answer "who ran that destructive tool yesterday"; a missing directory or a full disk only warns, it never fails a turn.',
   ),
@@ -671,6 +687,7 @@
         // 账本：桥每完成一个真正跑完的回合就报一次（谁会调用由它决定，写去哪
         // 由这里决定 —— 桥不认识 stateRoot）。
         onUsage: (usage) => recordModelUsage(stateRoot, withSavedConfig(config), warn, usage),
+        toolDenylist: config.toolDenylist,
         progressAfterMs: config.progressAfterMs,
         progressToolAfterMs: config.progressToolAfterMs,
         progressEveryMs: config.progressEveryMs,
@@ -1040,7 +1057,7 @@
               `</weixin_subscription>`,
             ].filter((part) => part !== '').join('\n\n')
             const result = await bridge.summarize({ conversationId: item.conversationId, accountId: item.accountId, prompt, sessionPrefix: 'wx-sub-', route: sideRoute('report') })
-            const text = typeof result?.text === 'string' ? result.text.trim() : ''
+            const text = sanitizeProactiveText(typeof result?.text === 'string' ? result.text.trim() : '')
             if (text === '' || text === '（已取消）') {
               log(`subscription ${item.id} produced nothing to send`)
               return
@@ -1156,7 +1173,7 @@
             sessionPrefix: 'wx-pro-',
             route: sideRoute('proactive'),
           })
-          const text = typeof result?.text === 'string' ? result.text.trim() : ''
+          const text = sanitizeProactiveText(typeof result?.text === 'string' ? result.text.trim() : '')
           if (text === '' || text === '（已取消）') return ''
           const plan = live.stickerEnabled !== false
             ? takeStickers(text, { modeId: candidate.mode?.id, stateRoot, warn, keepBuiltins: live.stickerKeepBuiltins === true })

# === agent-bridge.js ===
--- /var/folders/d4/c5hbp8gn0c5g7hs_y4m78fsh0000gn/T//wx1510clean-d9qm/package/src/agent-bridge.js	1985-10-26 16:15:00
+++ /var/folders/d4/c5hbp8gn0c5g7hs_y4m78fsh0000gn/T/wx1510patch-TCPs/package/src/agent-bridge.js	2026-11-05 05:02:44
@@ -136,6 +136,8 @@
     // one that is only thinking - the user can see the difference in what they
     // asked for, and 45s of silence during `npm test` reads as a dead bot.
     this.progressToolAfterMs = options.progressToolAfterMs ?? 8_000
+    // Z7 提速：微信会话工具面裁剪（tools.restrict agent-scope deny；失败降级为不裁剪）。
+    this.toolDenylist = Array.isArray(options.toolDenylist) ? options.toolDenylist.filter((n) => typeof n === 'string' && n.trim() !== '') : []
     this.maxWaitMs = options.maxWaitMs ?? 20 * 60_000
     this.pollMs = options.pollMs ?? 1_000
     // The session event log is an in-memory snapshot; polling it is how a turn
@@ -400,6 +402,14 @@
     const presetId = await this.#presetId(presets)
 
     const setup = async (agentCtx) => {
+      if (this.toolDenylist.length > 0) {
+        try {
+          agentCtx.tools?.restrict({ deny: this.toolDenylist })
+          this.log(`tool deny list applied (${this.toolDenylist.length} names)`)
+        } catch (error) {
+          this.errLog(`tools.restrict failed (continuing unrestricted): ${String(error)}`)
+        }
+      }
       if (presetId !== undefined) await presets.mount(agentCtx, presetId)
       if (route !== undefined) {
         const install = await loadInstallModelSelection()
@@ -408,7 +418,7 @@
         }
       }
     }
-    const hasSetup = presetId !== undefined || route !== undefined
+    const hasSetup = presetId !== undefined || route !== undefined || this.toolDenylist.length > 0
     return { agentOptions, setup: hasSetup ? setup : undefined }
   }
 
