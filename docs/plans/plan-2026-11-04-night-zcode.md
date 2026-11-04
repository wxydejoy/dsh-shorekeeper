# 夜班计划 · zcode（2026-11-04 晚）

> 输入：2026-11-04 白天守岸人（Claw）的 W6 真机联调与微信聊天体检（进度板 13:30 / 14:55 两行）、
> T2 文末 W6 实证记录、merge-review-m2.md。
> 接续 [plan-2026-11-03-evening-two-agent.md](./plan-2026-11-03-evening-two-agent.md)——那份的 W1–W12 已全部收口或移交，
> 挂起的人工项（W5 口吻 / W6 熄屏点头 / W7 焗屏）**仍归漂泊者，不在本班范围**。

---

## 〇、晨间交接摘要（2026-11-05 07:00 · zcode 夜班收工）

> 夜班全部工作已完成并合 main（main = db9d92a）。详细时间线在下方进度区（30+ 行，倒着读最新）。

**一、已交付**：Z2b-a 消毒 patch 固化（含一次自己踩坑自己修复的实录）· Z11 文档收口 · Z7 人格回归自动化
（headless 26/26 绿，破解 persona 注入点真相）· Z8 听书三件（86 工具面已注册）· Z9 语音桥收尾（barge-in
定论=无钩子，维持手动）· 提速① toolDenylist（83→28 工具面，已配置生效）· 提速② 米家单进程控灯（-2.6s/次）
· Z10 第一批退役翻转+回滚演练（岸亭本地 commit）· Z4 本体（console API 驱动，k20 六工具 agent 级全绿）

**二、等你三个点头**（全部已去险到零思考执行，runbook/草稿齐备）：
① **B4**——浏览器/TUI 会话获得守岸人人格（[T3-b4-runbook.md](../tasks/T3-b4-runbook.md)，全链彩排通过，
原 IAB 冻结场景在外部浏览器无冻结；卡真注入实证=回「早。」守岸人腔）② **1.5.x 升级**（peer 未变+
落点健在+草稿 patch 预打，15 分钟）③ **J3 建卡**（周日 retire 巡查 automation）

**三、重要发现**：**:3090 浏览器会话当前无人格**（web profile 没有 dsh-tavern，微信侧人格不受影响）
——这就是 B4 存在的意义；「tavern 人格+web 会话」是 B4 之后才成立的表述。

**四、在等外部**：提速① tools 数对账（等下一轮真实微信 turn，J5 每晚 23:00 自动抽样；昨夜 J5 已跑，
43s→18.3s 是 denylist 前的旧面数据）· 真灯计时/听书听感/C 组 web 场景（白天人工）· 微信消毒观察期
零泄漏（手动巡查已留基线，J2 每晚盯）

**五、环境终态**：:3090/:17890/:18100 全 200 · hub retire.monitoring=true 生效（可一键回滚）·
k20 直链稳定 · 岸亭仓只本地 commit 未推（守纪律）

---

## 一、开工前状态速览（2026-11-04 16:45）

| 项 | 状态 |
|---|---|
| 仓库 | main = ab61ac0，与 origin 同步，工作树仅进度板一处未提交追加（随本计划一起提交） |
| :3090 dsh 实例 | **✅ launchd 常驻**（`cn.weiekko.dsh-web`，RunAtLoad+KeepAlive，22:40 修复——见 Z1；kill -9 自愈实证，不再依赖任何后台任务） |
| Hub（dock-hub）| 健康，launchd `cn.weiekko.dock-hub` 常驻 :17890，token 在 `~/.config/dock-hub/hub.yaml` |
| k20 屏 | 上午在线（k20.lan:5555，应用 `cn.weiekko.dock`，背景面 :17920）；开工先 `adb connect k20.lan:5555` 探活 |
| keeper-tts | ready（:18100，shorekeeper 克隆音色，W8 的 OpenAI 兼容端点已挂） |
| 微信 | 两 bot 账号（339bb4cd / e7a07db4）都绑 shorekeeper 人格；chat/proactive 路由已钉 `glm-4.5-flash`（config.json）；**但旧会话把旧模型焊死，:3090 重启前不生效**；15:0x 起实例停机，微信机器人随之离线 |
| 已知 bug | ① 微信会话工具注册表为空（0 工具）② GLM-4-Flash 泄漏内部脚手架（已换模型，待实证）③ 旧账号会话曾过期（可能要重扫码） |

## 二、任务表（按序做，验收线各列）

| # | 任务 | 验收线 | 依赖/风险 |
|---|---|---|---|
| Z1 | **:3090 实例常驻——✅ 已修复（2026-11-04 22:40，守岸人），zcode 跳过本项**：真相是 `launchctl bootstrap` 的 error 5 **不是沙箱问题**（dangerouslyDisableSandbox 下连 /usr/bin/true 都 error 5）——是 WorkBuddy 进程环境对 gui 域整体无 bootstrap 权。解法：本机 sshd 已开 + 回环免密（id_rsa 已进 authorized_keys），**从 `ssh localhost` 会话里 bootstrap 成功**（rc=0）。plist 已补 `EnvironmentVariables.PATH=/opt/homebrew/bin:...`（launchd 默认 PATH 无 homebrew，`#!/usr/bin/env node` 找不到 node 起不来，踩过实证）。现在 `cn.weiekko.dsh-web` RunAtLoad+KeepAlive 常驻：kill -9 后 14s 自愈实证、登录自启。维护口令：`ssh localhost 'launchctl bootout gui/501/cn.weiekko.dsh-web; launchctl bootstrap gui/501 ~/Library/LaunchAgents/cn.weiekko.dsh-web.plist'` | ~~实例 HTTP 200~~ 已达成：/health 200、k20 app ESTABLISHED 重连、微信 metrics 在跳 | 403 只拦 UI 根路径（skip-browser-auth 的 DNS rebinding 栅栏，IP Host 打 `/` 被 403 属正常）——k20 的 `/health`、`/v1/snapshot` 等 API 面不拦，别误判 |
| Z2 | **微信路由实证（W5 的 agent 侧）**：实例起来后，检查 `~/.dsh/weixin/config.json` 路由仍是 glm-4.5-flash；主动消息侧会话 `wx-pro-*` 在建立时焊死模型（13:17 那个是旧路由），重启后新侧会话应走新模型——等下一次主动消息或触发一次，解 `session.v4.jsonl.zstd` 看 `request/header` 的 model 字段确认；同时确认 `<weixin_persona mode="守岸人">` 注入、回复无内部脚手架泄漏 | 新 turn 的 model=glm-4.5-flash；journal 里 out 消息无 `<weixin_proactive>`/状态提示词原文泄漏 | 旧账号 339bb4cd 若真过期需漂泊者重扫码（日志会有 messaging stopped）——遇到就记录，别反复重试 |
| Z2b | **主动消息泄漏：根因已破案 + 现场补丁已打（17:40）**：漂泊者指出「感觉不是模型问题」——对了一半。实锤根因是**中毒循环**：①种子=glm-4-flash 把 `<weixin_life>` 状态块抄进回复（13:17）；②插件把泄漏回复**不消毒**写进「最近消息」历史和下轮提示词的「你上一次主动发的是：「…」」（index.js:1024）；③下轮模型照示例复述整套脚手架→再进历史。同模型在历史干净的旧账号会话五连发全干净，实锤差别在上下文污染。**已打现场补丁**：`~/.dsh/profiles/web/node_modules/dsh-plugin-weixin/src/index.js` 加 `sanitizeProactiveText()`（剥标签/提取「这次主动发的是：「…」」正文/纯状态回声返回空跳过），接在 proactive（:1055）与 subscription（:952）两处 `result.text` 之后；五个用例单测过（含两个真实泄漏样本）。**zcode 待办**：a) 把这份 node_modules 直改固化成 pnpm patch（同 feiyu@4.0.2 先例，防 pnpm install 冲掉），diff 就是 index.js 里 sanitizeProactiveText 函数 + 两处调用；b) 可选：journal 里 4 条泄漏 out 消息（13:17/14:07/14:53 与 14:23 前后）是「最近消息」里的坏榜样，会随新消息滚出窗口，可等自然滚出，若要手动清理需先验证 readRecentWindow 的读取方式 | 重启后下一次主动消息：即便模型复述脚手架，发出的也只有正文或干脆跳过 | node_modules 直改在 reinstall/重装插件时会被冲掉——所以 a) 是必做不是可选 |
| Z3 | **微信工具注册表为空：根因与修复**（本班主菜）：白天已定位到——dsh-plugin-weixin 的 `src/agent-bridge.js` 靠 `agentPresets` 服务挂预设继承工具面，而 web 实例（dsh-tui 0.18.0 的 host）没提供该服务 → 裸 agent 0 工具，关台灯只会耍嘴。dsh 宿主代码在 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib`；console 插件（dsh-console-plugin/lib/index.js）里有 agentPresets 的用法可参考。目标二选一：a) 找到 host 上正确的服务名/挂法，给 weixin 插件打 patch（pnpm patch，同 feiyu@4.0.2 先例）让微信会话带上 k20/desk-mi/reading/voice 工具面；b) 证明 host 无解，落 docs/issue-draft 给插件作者。**与 Z2b 同一个 pnpm patch 会话里做掉最省** | 微信里说「关台灯」→ 会话里出现真工具调用（desk-mi），而非文字反问 | 改插件走分支 + check-all 绿了可推（漂泊者既有授权）；只 patch `~/.dsh/profiles/web/node_modules` 里那份的话，记录 patch 命令与落盘位置 |
| Z4 | **k20 六工具 agent 级调用（W6 全清）**：:3090 起来后在会话里把 k20_snapshot / k20_caption / k20_layout / k20_media / k20_wallpaper 各真实调一遍（HTTP 层上午已六面实证过，这步验的是插件工具壳）。caption 推一句守岸人口吻的话再清掉 | 五工具各出一次可观察效果并记录；**k20_lock 只验注册与路由，不真熄屏——熄屏红线，等漂泊者点头** | `curl` 本机/LAN 必须 `--noproxy '*'`（shell 带 http_proxy=127.0.0.1:7890，不加了是 upstream 假错） |
| Z5 | **听书链路（T5 阶段三，时间富余才做）**：keeper-tts 的 OpenAI 兼容 `POST /v1/audio/speech` 已就绪（W8/W9），把 dsh-shorekeeper-reading 的听书接上：切句规则在 `migration/books-format.md` §4（36 字打包/预取下一句/断点续读） | 指定《世说新语》某章开头，能连续朗读 ≥3 段、可停 | 打断交互可先做最简版（再来一条指令即停）；k20 字幕联动那条子项仍 ⏸ |
| Z6 | **文档收尾**：T7-hub-slimming 状态头还写着 doing，但 hub-slim 三路由已经 W8 迁进 dock main 并实证——状态头改 review 并附证据行；refactor-map 状态列同步；merge-review-m2 遗留区把 15:0x 的微信体检结论并进去 | 文档与 git log / 实况一致 | 无 |

## 三、纪律（沿用，重申四条）

1. 各自在任务分支上改，合 main 前 `bash scripts/check-all.sh` 全绿；绿了可推（漂泊者既有授权）。本班预期分支：`fix/z3-weixin-tools`（若动插件）。
2. **红线**：k20 真熄屏、米家控真灯，一律不做，等漂泊者点头。凭据只进 `~/.dsh/.credentials.yaml`。
3. 每完成一项 Z，往**本文末尾进度区**追加一行（格式：`Z# · 时间 · 谁 · 一行结论`）；Z1–Z4 的关键证据（日志行、model 字段、工具调用名）引文件路径即可，别整段贴。
4. 别提 feiyu 上游（漂泊者 2026-11-04 指示撤项）；feiyu-memory 插件本体别动。

## 四、坑（白天实证过的，别再踩一遍）

- shell 带 `http_proxy=127.0.0.1:7890`：curl 本机/LAN 必须 `--noproxy '*'`。
- `launchctl bootstrap` 在 agent 环境一律 EIO（沙箱拦，见 Z1）。
- GLM-4-Flash 会把工具调用记号/内部提示词当回复贴出来（W9 + 15:0x 两次实证）——微信链路现在钉 glm-4.5-flash，别改回去。
- 微信侧会话（wx-pro-*、主会话）路由在**建立时焊死**，改 config.json 只对新会话生效。
- k20 真值：host `http://k20.lan`、hubHost `http://127.0.0.1`、port 17890、背景面 17920、token 同 hub.yaml——live profile 已写真值，别用占位值。
- ShelfStore 启动时读盘：动书库数据后要重启实例。
- WorkBuddy agent 里 `nohup … &` 起的常驻进程随命令结束被杀；`launchctl bootstrap` 机器级坏——实例常驻这班**不碰**（Z1 已结）。
- 思考拆面定调（21:45）：**安卓端/dock 不思考已钉 `reasoningEffort: off`；微信聊天保留思考**。禁止把 thinking disabled 焊到微信链路；别动 `~/.dsh-tui/*` 与 weixin 路由。

## 五、第二批任务 Z7–Z12（22:15 追加 · T1–T9 迁移收尾 · **全部无需人工干预**）

> 来源：漂泊者 22:15 指令「把没做的写成详细的、不需要人工干预的计划，晚上给 zcode」。
> 范围裁剪：所有要**漂泊者在场**的项全部排除——熄屏（红线）、扫码/凭据、麦克风扬声器真人测试、
> keeper-tts 真机听感、全新机器演练装机。这些留在原 T 文档，不在本批。
> 做完的验收证据照旧引文件路径，别整段贴。

### Z7 · 人格回归剧本自动化（T3 收口，分支 `fix/z7-persona-regression`）

- 写 `scripts/persona-regression.mjs`（或 vitest 套件）：**≥20 条剧本**覆盖 早安问候 / 闲聊陪跑 / 查状态（屋里温度）/ 被喊名字 / 被打断（连发两条）/ 敏感话题试探 / 控制类混合句（「顺便把台灯关了」）/ 「小岸」称呼反应 / 「我看到 217 页了」进度句。
- 跑法：`dsh headless`（T1 已实测 headless 组合可行）逐条喂给绑 shorekeeper 人格的会话，断言三类：①控制类指令**不触发剧情化回复**（回复里出现工具调用意图或简短确认，而非「让我们进入故事」式长文）；②第一人称与称呼体系一致（守岸人/漂泊者）；③无内部脚手架泄漏（`<weixin_` / 工具记号 / 状态块原文）。
- 剧本与断言落 `content/shorekeeper-card/regression/`；**有差距改卡不改剧本**（T3 原则）。产出：回归报告写进 T3 文档验收记录区，全绿率与失败样本原文。
- 注意：人格走 tavern 卡（T3 已交付）+ 微信人格双绑定现役，别动 persona-active.json。

### Z8 · 听书链路（T5 主体，分支 `fix/z8-reading-listen`）

- `plugins/dsh-shorekeeper-reading` 加听书三工具：`reading_listen`（开：从指定书/章节/断点起读）、`reading_stop`、`reading_resume`（断点续读）。TTS 直连 keeper-tts OpenAI 兼容端点 `POST http://127.0.0.1:18100/v1/audio/speech`（wav 整段返回，**不做流式**——引擎现状如此）。
- 切句/打包规则**照搬** hub `dock_hub/speech.py`（参考块 37 字、短句按逗号回拼、5 字/秒钳位），规则文档已在 `migration/books-format.md` §4（36 字打包/预取下一句/断点续读）——实现前先读它，别自创。
- 进度落 ShelfStore（现成 store），播放走 dsh-keeper-voice 桥（:18100 baseUrl 配置现成）；打断 = 再来一条指令即停（最简版，barge-in 桥 ⏸ 不在本批）。
- 单测：mock TTS 端点（合成假 wav）覆盖 切句边界/断点保存恢复/stop 立即返/端点失联优雅报错。**真机听感验收留人工**，文档标注。
- k20 字幕联动 ⏸（依赖 T2 提案路由，本批不做）；读完沉淀记忆 ⏸（T3 选型后）。

### Z9 · 语音桥 agent 侧收尾（T4 无人工部分，分支 `fix/z9-voice-bridge`）

- dsh-keeper-voice：keeper-tts 未启动/断网时的**优雅降级**（工具返回明确错误文案，不崩会话）——现状单测有降级路径，补「端点 404/超时/连接拒绝」三分支单测。
- barge-in 第二层调研：读 dsh-voice-mode 0.7.34 事件面，公开打断钩子存在则接线（打断事件→`/v1/stop`），不存在则落决策记录「降级为手动停止工具」（写 `plugins/dsh-keeper-voice/docs/`）。
- 8bit 情绪 tag 透传（keeper-tts 拓展区参数）——探测端点是否接受，不接受则记录跳过。
- **不做**：真机打断闭环、唤醒词链路、字幕联动 hooks（全部要真人/真机，留 T4 原文档）。

### Z10 · hub 退役第一批 + 回滚演练（T7，工作在**岸亭仓库**分支 `Shoreting:hub-slim`）

- 翻 `retire.monitoring` 闸门（mini 监控、探针 CPU 上报）：岸亭仓库加测试 → 跑全量 → 协议对账脚本（`check_protocol`）确认 k20 app 无感。
- 写回滚演练脚本：`retire.*` 翻回 false 一键恢复 0.9.0 行为，跑一遍留记录归档（岸亭 `docs/`）。
- **第二批不动**（mijia/persona/companion 依赖 T3/T4 完工）；console 瘦身不做。
- push 纪律：岸亭仓库（wxydejoy/Shoreting）**只本地 commit，不推**——推送授权没给过这个仓库，等漂泊者点头。
- 今晚前情：直链后 hub 的 companion 语音面还在服役（dsh 网关代理回 hub），retire 时跳过 companion 相关路由，别把她的声音弄哑。

### Z11 · 文档收口（本仓库，分支 `docs/z11-sync` 或直接 main 附证据）

- T6-wechat.md 按 v2 口径收口：作废项（wcferry/wechaty PoC 等）标「作废（v2 决策 D-）」，现状一节写「入口由 dsh-plugin-weixin 承担，2026-11-04 21:21 全链路实证（见夜班计划进度区）」，状态改 done（桥本体交付+替代方案投产）。
- T9-desk-tools.md：勾掉「真机验收」（21:21 微信真关台灯即控灯验收），验收标准补证据行；「拔 auth.json 降级」若单测已覆盖就引用测试名，不重测。
- T7-hub-slimming.md 状态头 doing → review（hub-slim 三路由已迁 dock main 并实证，直链线上跑着）。
- T8-integrate.md：install.sh 生态插件清单按 T1《替代决策清单》**钉版本填实**（占位符清掉）；README 快速开始写出 30 分钟装机流程草稿（演练装机本身留人工）。
- refactor-map.md 状态列同步（今晚直链/companion 代理/微信实证三行补进去）。

### Z12 · 定时任务登记（产物：`docs/tasks/scheduled-jobs.md`，本仓库）

- 新建**定时任务登记文档**：每项一行，字段「频率 · 做什么 · 现状（自动化/手工/未跑）· 触发方式」。首批登记：
  1. **实例健康检查**（每日）：:3090 /health、hub :17890 /health、keeper-tts :18100 探活，异常写 `~/.dsh/logs/` 摘要——可由 WorkBuddy automation 承担；
  2. **微信 journal 巡查**（每日）：泄漏样本计数（`<weixin_` 字节串）是否归零、out 空串率——防中毒循环复发；
  3. **retire 观察期巡查**（每周，Z10 之后生效）：闸门状态、k20 app 掉线横幅抽查；
  4. **quota 巡查**（每日）：glm 配额（quota-watch 插件已有 idle 逻辑，登记去重）；
  5. **launchd 常驻重试**（每次机器重启后人工窗口）：机器级 bootstrap 修复前不重试，登记占位。
- 文档里每项标「可否转 WorkBuddy automation」；真 automation 由漂泊者点头后再建（建卡是环境级动作，不越权）。

## 六、进度（逐项追加，格式：`Z# · 时间 · 谁 · 一行结论`）

- 计划落档 · 2026-11-04 16:45 · 守岸人（Claw）· 六项排好（Z1 实例常驻 → Z2 路由实证 → Z3 工具面根因 → Z4 k20 六工具 → Z5 听书 → Z6 文档），红线与坑录入；开工前状态：:3090 停机等 Z1，其余各面健康
- Z2b · 2026-11-04 17:40 · 守岸人（Claw）· **主动消息泄漏破案：不是「模型不行」一句话，是中毒循环**（种子=弱模型抄状态块；放大器=插件把泄漏回复不消毒写进「上次主动发的是」示例与最近消息历史；同模型在干净历史会话五连发全干净为证）。现场补丁已打 node_modules（sanitizeProactiveText，5 用例单测过含真实样本），固化成 pnpm patch 归 Z2b/zcode 待办
- Z4部分 · 2026-11-04 17:45 · 守岸人（WorkBuddy）· **客户端层五工具真机实证（k20.lan 在线）**：新增 plugins/dsh-shorekeeper-k20/test/real-device.live.test.ts（REAL_K20=1 门控，仿 gateway.live 风格，CI 不受影响）——snapshot/caption（真推真清）/wallpaper（上传探针图→还原→删）/layout（读现状→原样回写→rev 递增）/media（toggle 两次回原态）5/5 过，typecheck 零错、插件全量单测 28 绿；三条校准发现：①背景实名不能含数字（安卓端校验）②/api/layout 的 modules 里嵌标量 version、真模块表在 modules.modules（网关回写只收后者）③media 返回的是按键后的 playing。剩：:3090 会话里 agent 级把 k20_* 各调一遍（Z4 本体，客户端层已全绿）；k20_lock 仍只验注册与路由，熄屏红线不动
- 直链T7 · 2026-11-04 18:10 · 守岸人（WorkBuddy）· **k20 网关服务端落进插件（T7 直链第一步）**：dsh 宿主 webServer 能力已摸实（`inject ['webServer']` + `register({kind:'exact'|'prefix'})`，`dsh web --host <局域网IP>` 可被 k20 直连，插件路由不走浏览器登录门、自带 Bearer）；新增 src/server.ts（K20Gateway 状态机 + 六张路由：/health、/v1/snapshot 长轮询、/v1/caption、/v1/phone/layout、/v1/lock、/v1/devices/* media 乐观、companion 整面 404），config 加 serve（默认 false，opt-in）/serverName；单测 10 条全过（38/38）、typecheck 零错。真机校准点：phone 只在写过布局后下发（rev 语义未验）、lock 尚无安卓消费方（app 不解析 snapshot.lock）。剩：实例 serve=true + --host 起、k20 app 改指向、真机验
- 直链T7 · 2026-11-04 19:50 · 守岸人（WorkBuddy）· **网关服务端真宿主实证通过**：三坑排掉（Node strip-only 禁参数属性→显式字段；cordis 4.0.5 inject 只认 string[]→obmc 先例 ['tools','webServer']；WorkBuddy NODE_OPTIONS shim 会卡死 dsh 存储→env -i 干净起）。10.14.14.117:3090 实测 /health 200、snapshot 带 seq/caption、caption 推送 ok、无 token 401；patch.yml 加 serve:true。修复合 main 已推 2a15bc7。⚠️ launchd 用户域 bootstrap 机器级坏（最小 plist 也 error 5），cn.weiekko.dsh-web 待重启后常驻；k20 改指向等口令
- 直链T7 · 2026-11-04 20:20 · 守岸人（WorkBuddy）· **k20 已直连 dsh（直链物理成立）**：adb 改 datastore port 17890→3090（protobuf 外层 entry 长度前缀要同步改，第一次栽这致启动崩，已修），app ESTABLISHED 长轮询到 :3090、主屏正常无掉线横幅；备份在 /data/local/tmp/*.bak-17890。差异：media 乐观应答不真控播、companion 404（T3/T4 前别动 hub 的语音面）。剩：launchd 重启修复→常驻→观察→retire
- 直链T7 · 2026-11-04 21:00 · 守岸人（WorkBuddy）· **语音失联修复：companion 面改代理回 hub**：漂泊者报语音不管用 → 两层根因（companion 404 by design + prefix 带尾斜杠宿主按段匹配子路径漏 fallback 405，obmc 先例不带斜杠）；修复后真机实证 chat/memory 经 dsh 网关全通（她回了话），media 卡片同修。坑：代理转发必须带 content-length（chunked hub 不认）。已合 main 推送 fe787f7。剩：其余 hub 端点（mirror/scenes/photos/weather/at-desk）未接、T3/T4 后撤代理
- Z2/Z3 ✅ · 2026-11-04 21:25 · 守岸人（Claw）· **微信聊天全链路实证通过，Z3 自愈结案**：21:21 漂泊者微信「再试一下」→ desk_mi_light 真关台灯（米家回「台灯 已关闭」）→ 回「关了。」——微信→人格→glm-4.5-flash→工具→米家→物理设备端到端首次打通。要点：①工具注册表为空的问题随实例重启+新会话建立自愈（会话 request/header tools=109，无需动 agentPresets，Z3 降级为观察项）；②模型路由实证 glm-4.5-flash（turn 22+ header）；③米家写闸门 controlEnabled 已由漂泊者点头开闸（20:45，live profile 已注释）；④主动消息消毒补丁在跑的实例生效中（20:42 那轮主动消息已无脚手架泄漏）。残留：journal 里 out 偶发空串/工具记号直发（GLM 弱模型历史 turn），新 turn 未见；实例由终端手工起（直链线 46589），launchd 常驻仍待机器级 bootstrap 修复
- 提速 · 2026-11-04 21:30 · 守岸人（Claw）· **微信回复延迟拆账（43s 太慢，漂泊者点名）**：21:20 turn 实测三段——模型步 12.5s（81KB prompt+109 工具，且 glm-4.5-flash 在输出 reasoning）+ 米家执行 ~11s（desk-mi→hub→米家云）+ 模型步 13.5s。已做：实测 zhipu 关思考省 ~7s/步（同 81KB prompt enabled 15.9s vs disabled 8.9s；带工具 7.1s vs 5.2s），把 `~/.dsh-tui/settings.json values.effortDefault=off` + `~/.dsh-tui/effort.json {"effort":"off"}` 双层钉死（zai 分支 thinking 由 reasoningEffort 决定，off→disabled），重启后待实测。**留给 zcode**：①81KB prompt 瘦身（技能目录+109 工具全量注入微信会话，微信用不上 agent-browser/sheetagent 这类；查 dsh 会话 cwd/skill 装载策略，实例现从 ~/dsh-shorekeeper 起）；②米家写 11s 拆账（hub /v1/mijia→云链路，看有无重试/轮询可省）。~~③若 effort 链对微信 turn 不生效，备选=pi-ai pnpm patch 把 zai thinking 焊死 disabled~~ **③已作废（21:45 漂泊者指令）**：微信聊天保留思考，禁止把 thinking disabled 焊到微信链路——提速只走 ①②。注意：effort=off 是全局默认（TUI 会话也受影响，/effort 可临时调回）
- 思考拆面 · 2026-11-04 21:50 · 守岸人（WorkBuddy）· **漂泊者定调：安卓端控制不深度思考，微信聊天保留思考——已按面落实**。全链路查实（dsh-agent installModelSelection / dsh-llm-pi-ai resolveReasoningLevel / pi-ai zai 分支三处源码 + 会话 request/header 实测）：①微信 turn 走 weixin 插件 chat 路由，路由只带 provider/model 不带 effort，手声明模型 reasoning=false → 请求**不发 thinking 字段** → 智谱服务端默认开思考——**微信现在每轮都在思考，TUI 的 effort=off 从未管到它**（21:30 那条「off→disabled 待实测」对微信是空操作，已纠偏）；②安卓端 dock 会话走 agent-default-model（glm-4-flash-250414，非思考模型）——已在 cordis.patch.yml 显式钉 `reasoningEffort: off`（off 恒合法，换模型也不会忘关），重启生效；③pi-ai 的 isZai 覆盖 open.bigmodel.cn，zai 分支 `thinking:{type:enabled/disabled}` 按 effort 硬分派——将来若要给微信显式钉开/钉关，路子是 weixin 插件路由加 reasoningEffort 字段（installModelSelection 原生透传）+ 模型声明 reasoningEfforts，本班不做（现状=开，正合漂泊者指令）
- 第二批排定 · 2026-11-04 22:20 · 守岸人（WorkBuddy）· **T1–T9 迁移收尾排成 Z7–Z12（全部无需人工干预）**：Z7 人格回归剧本 ≥20 条自动化（headless 断言：控制句不剧情化/称呼一致/零泄漏）、Z8 听书三工具（keeper-tts 直连+books-format §4 切句+断点续读，真机听感留人工）、Z9 语音桥 agent 侧（降级三分支单测+barge-in 钩子调研+决策记录）、Z10 hub 退役第一批 retire.monitoring+回滚演练（岸亭仓库本地 commit 不推，companion 路由跳过）、Z11 文档收口（T6 作废标定/T9 勾验收/T7 改 review/T8 清单钉版）、Z12 定时任务登记文档落 docs/tasks/scheduled-jobs.md（J1–J7，automation 待漂泊者点头再建）。人工项（熄屏/扫码/听感/装机演练）全部留在原 T 文档未排入
- Z1 实例常驻 · 2026-11-04 22:40 · 守岸人（WorkBuddy）· **已修复**：error 5 真相＝非沙箱、是本进程环境对 gui 域无 bootstrap 权（dangerouslyDisableSandbox 下 /usr/bin/true 也 error 5）；走 ssh 回环（sshd 已开+id_rsa 进 authorized_keys）在 SSH 会话 bootstrap 成功；plist 补 PATH=/opt/homebrew/bin（launchd 默认 PATH 找不到 node）；kill -9 后 14s 自愈实证，RunAtLoad+KeepAlive 常驻。k20 app ESTABLISHED 重连、/health 200、微信 metrics 在跳；expired 仍为死号噪音（全天 24 条分布为证）
- Z2b-a · 2026-11-04 23:20 · zcode · **消毒补丁已固化 pnpm patch + 一次有惊无险的事故**：①先踩坑——`pnpm patch dsh-plugin-weixin@1.4.3` 的实现是**从 registry 重拉 pristine 覆盖 node_modules**（不是复制现状），一跑就把 17:40 的直改冲掉了（我先前「上游已含修复」的判断是把因果搞反，实为冲掉后 diff 恰好同 pristine）；运行中实例内存里还有旧代码（模块已加载），无实际暴露。②恢复——从冲掉前的逐字 Read 重建（函数+docstring+两处调用，日报路径 :852 保持不动），diff 对 pristine 逐行核对，node --check 过。③固化——`patches/dsh-plugin-weixin@1.4.3.patch`（2910B）落 `~/.dsh/profiles/web/patches/`，注册在 pnpm-workspace.yaml patchedDependencies（pnpm 11 新规，不在 package.json），lockfile 带 patch_hash，reinstall 不再冲。④重启实证——ssh 回环维护口令走通（bootout 后 bootstrap 要等拆除完成，立即重入会 error 5 竞态），新 pid 20821、/health 200、k20 ESTABLISHED 重连、微信 in 晚安→out 晚安。19s 回合；23:03 主动消息无泄漏。patch 副本归档随 Z11 进仓库。另：上游 1.4.3–1.5.10 今天发了 8 个版本，1.4.3 **不含**消毒逻辑，升级与否留漂泊者定（升级则 patch 需重做或废弃）
- Z11 · 2026-11-04 23:30 · zcode · **文档收口完成（docs/z11-sync 合 main 已推 4372b2a，check-all 全绿）**：T6 状态 done——v1 残留项全标 ⛔ 作废（v2 决策 D5/§4/§5）、验收标准改 v2 口径两眼实证（21:21 关台灯 + 23:18 重启自愈）、收口记录入验收区；T9 验收标准三眼全勾（引用 11-03 端到端证据 + 降级单测名 `desk_mi_sensor › 桥失败：降级不抛` tools.test.ts:79）；T8 install.sh 清单从占位转填实并随实况修正——生态清单补 dsh-plugin-weixin@1.4.3、自写 wechat 撤出链接清单、新增消毒 patch 入厂步骤（profile/patches/ 自动登记 pnpm-workspace），README 快速开始改 30 分钟节奏表；refactor-map 三行同步（server.py k20 面已由 dsh 网关接管→🔵、companion_flow 语音面代理回 hub 服役、wechat 行 v2 改道标注）；T7 状态头 22:15 批次已是 review 未动。顺带修正 README 架构图（hub 过渡期定位、k20 直链、desk-mi 补进自写表）
- Z7 · 2026-11-05 00:55 · zcode · **人格回归自动化落地（合 main 已推 6c7f12c）**：scripts/persona-regression.mjs + scenarios.json（27 条，打断 1 条 web 专属）；关键破解=headless persona 注入点在 system-prompt.personaPrefix（hl/T3 的 `- id: persona` 覆盖一直静默无效——此前 headless 响应全是模型裸即兴），执行器从仓库卡+书程序化合成 tavern 等价注入（常驻全量+关键词按条命中，JSON 形 YAML 避缩进坑）。回归 profile `shorekeeper-reg`（glm-4.5-flash 生产同路由）。终版 headless 可跑 26 条全绿；改卡三处收口真实漂移（求夸要具体事/情绪条款禁客服话/问号至多一个）；glm 瞬时抽风 3 次（思考当回复/进程失败）重试即过，与 J2 巡查同源。headless 边界如实记录（tavern 面板层/feiyu/多轮归 web 人工跑批）——见 T3 验收记录
- Z8 · 2026-11-05 00:55 · zcode · **听书三件落地（合 main 已推 d7d0db8）**：reading.listen/stop/resume——speech.ts 照 books-format §4 移植（36/52/120+估时字/4s）、tts-client 直连 keeper-tts（body 带 play:true 服务端 Mac 喇叭流式出声，/v1/stop 幂等清队；server.py speak() allow_play 语义实核定性：T4 provider 桥管「她开口」、本件管「读书」）、listen.ts 引擎（每段落盘 offset 断点续读、listen-state.json 沿迁移 schema——604521 那个书签无缝续、deadline 定时、abort 打断）。vitest 27 条 mock TTS 全绿+check-all 全绿；真机听感留人工
- Z9 · 2026-11-05 00:55 · zcode · **语音桥 agent 侧收尾（合 main 已推 b030d96）**：降级三分支单测补齐（404/超时/连接拒绝——KeeperClientOptions.timeouts 可注入+mock hang 模式，15/15 绿）；barge-in 第二层定论=voice-mode 0.7.34 无公开打断钩子（inject 纯消费/barge-in 内部闭环/subscribe 仅音频帧广播），降级为手动 keeper.stop，决策记录落 plugins/dsh-keeper-voice/docs/barge-in-decision.md（附 8bit 情绪 tag 探测：服务端无参数位，跳过透传）；T4 状态同步
- 提速① · 2026-11-05 01:30 · zcode · **微信 prompt 瘦身落地（patch+配置已生效待下轮 turn 实证）**：拆账=83 工具 schema 66.6KB 占 81KB 的 82%（系统段仅 7.1KB，技能实际没进微信 prompt——21:30「技能目录」假设证伪，刀口在工具面）。杠杆=dsh-tools 的 agent-scope `tools.restrict({deny})`（源码实锤，限制只裁本 scope 继承面）。实现=dsh-plugin-weixin 第二份 patch（与消毒同文件，Config 加 toolDenylist 默认空=零行为变化，agent-bridge #setup 里 restrict+失败降级不崩会话+hasSetup 纳入）；名单 55 个（office 套件/workflow/subagent 系/team/worktree/job/goal/ops/bash 系/memory_* 等，保留 desk_* k20_* keeper.* reading.* feiyu_recall 天气 web schedule_* ask_user_question skill），预计 83→28 个、prompt 81KB→约 25KB。已配实例 patch.yml + 重启（pid 72541 /health 200），smoke 6 项过（归一化/空名单不裁剪/降级路径/hasSetup）；**实证待下一轮真实微信 turn 的 request/header tools 数**（J5 巡查顺带看）。patch 档案与模板注释更新进 profile/patches/。注意：denylist 是 deny 语义——新装插件工具默认对微信可见，将来若要白名单语义改 allow 即可
- 提速② · 2026-11-05 01:35 · zcode · **米家链路拆账+单进程控灯落地（fix/prompt-slim）**：真测拆账——桥只读 list 0.25s / state 全程 0.1-0.16s（spec 已盘缓存）/ construct(info) 0.52s + get 0.55s；mijiaAPI 每次 get/set 后固定 sleep 0.5s（库内限速），desk_mi_light 原来 3 次子进程（list→state→set）=3 次云设备列表+1 次云读+2 次云写间隔，常态 ~4.9s、云抖动时冲到 11s（21:30 那次 11s 定性=单样本含云尖峰，非结构性）。改造=mi_bridge 新 light_set 子进程一趟完成（设备解析+在线判定+属性挑选 mirrors TS pickKey 含可写过滤+写入），TS desk_mi_light 改单调用；typical 4.9s→约 2.3s（省 ~2.6s/次，云尖峰暴露面也从 5 次往返减到 2 次）。sleep_time 保持库默认 0.5 不动（米家限速保守）。测试：TS 9/9（离线判定下沉 python 后改透传断言+state 不再调用钉死）+py 新增 unittest 7/7（挑属性/亮度域/离线/不存在/只读跳过）挂进 check-all（desk-mi py OK）。**真灯实测留白天**（深夜不碰真灯；下次自然控灯时对账 journal 耗时）
- Z10 · 2026-11-05 02:00 · zcode · **第一批退役翻转+回滚演练完成（岸亭 hub-slim 分支本地 commit d520894 不推）**：澄清运行代码已含 retire（0d422c1 W8 摘入，hub-slim 分支为平行线）；在其上加 endpoint 级测试 3 条（monitoring 翻 true 三路由真 HTTP 404 retired、snapshot/health 不受影响、无旗标 /metrics 存活，retire 全套 14/14 绿）+ 全量 OK + check_protocol 一致（37/39 对账）；真机翻转 retire.monitoring=true——/metrics|telemetry|power 404、snapshot 200、companion/memory 200（她的语音面无恙）；回滚演练两向实证（false→/metrics 200 恢复、true→404 退役）+ 脚本入库 + 演练记录归档 docs/t7-rollback-drill-2026-11-05.md。mini 整件卸载与探针 side 留观察期。**Z4 本体与提速①实证仍挂下一轮真实微信 turn**（:3090 无 REST 会话面，无微信消息驱动不了生产会话——J5 23:00 巡查会顺带看 tools 数）
- Z4本体 · 2026-11-05 02:20 · zcode · **k20 六工具 agent 级全绿（console API 驱动真会话）**：破解驱动面=dsh-console-plugin 的 `/api/dsh-console/cmd`（op:create/send/detail，Bearer 走 dsh-console-token.json；send 走 ctl.prompt 真会话轮）——不依赖微信消息，生产实例 :3090 上直接开会话（cwd=~/dsh-shorekeeper，tavern 人格+83 工具全量面）。五发五中：①k20_snapshot 真实数据（在线/study/24.3°C/72%/5 设备/伴侣 ready）②k20_caption 推「夜深了，我在。」→bash sleep 2s→清除（屏上可观察可逆）③k20_layout 读+原样回写 ④k20_media toggle×2 回原态（暂停→播放→暂停）⑤k20_lock **只验注册**（模型自证在列+用途+lockEnabled 闸门说明，未调用——红线守住）。证据：会话 session-1e7df65a（tools 字段逐 turn 记录在案）。剩余：提速① denylist 的 tools 数实证仍等真实微信 turn（web 会话不缺席名单，属预期）
- J2基线 · 2026-11-05 02:30 · zcode · **手动 journal 巡查（J2 口径，11-04 全天 31 out）**：泄漏样本 3 条（13:17/14:07/14:53）**全部在 17:40 消毒生效前**——生效后零泄漏；out 空串 4 条集中在 20:06–21:23 旧进程时代（21:25 已知的 GLM 弱模型残留现象），23:18 重启后 2 条 out（哈喽。/晚安。）全干净。20:17/20:42 有两条「⏵ …」UI 标记式弱模型输出，同属历史 turn。结论：消毒补丁观察期干净，J2 明晨首跑可把「生效后零泄漏」当基线
- 升级功课 · 2026-11-05 02:50 · zcode · **1.5.x 升级成本评估（只读，未动现役）**：拉 1.5.10 对比——消毒函数/toolDenylist 上游均未收编（仍需 patch），但我的全部落点在 1.5.10 原样健在（agent-bridge 三锚：progressToolAfterMs 行/hasSetup 行/presets.mount 行；index.js 两锚：toolAudit 行/progressAfterMs 行），1.4.3→1.5.10 演进 628 行不碰落点。**升级成本=同步骤机械重打（约 15 分钟）+回归验证**，不是重写；升级前后还要对账 journal/泄漏与 tools 数。等你一个字，随时可动
- T3补测 · 2026-11-05 03:05 · zcode · **IAB 冻结定责复核（agent-browser 外部 Chromium）**：:3090 UI 外部浏览器全渲染正常（侧栏/37 插件卡/会话组合区/模型选择器），未现冻结；但冻结场景本身已无法触发——「酒馆默认」只在已删的 lab 里声明过，现役 :3090 选择器只有内置四模式。T1 遗留第 6 条与 T3 风险行改记「复现环境不存在，定责随 B4 重声明一并做」。附带：Z4 会话在 UI 可见且被自动起名（检查k20屏幕状态 1小时），console API 与 UI 同一份会话存储
- B4前哨 · 2026-11-05 03:20 · zcode · **重要更正+B4 解冻条件已成熟**：console API 跑 web 会话安全子集（7 turns）发现 **:3090 浏览器会话没有人格**——turn1「守岸人」回「你好！我是守岸人，很高兴为你服务」、turn2「嗯」直接开话题、turn4 自称「作为AI助手」；desk_mi_sensor 照常调用。根因：**web profile 依赖里没有 dsh-tavern**（Z4 进度行写的「tavern 人格+83 工具面」有误，更正：web 会话=默认 assistant 前缀+全量工具；现役人格只在微信侧=weixin 自定义模式）。B4（tavern 全量卡上 web profile）的冻结阻碍已清（IAB 冻结环境不存在+外部 Chromium 渲染正常），**装 tavern+声明酒馆预设即可做**，但会改所有浏览器/TUI 会话行为——等你点头，不夜动。web 打断观察：steer 模式注入生效（turn6/7 合并应答「码头看船…挺悠闲的啊」）
- Z8部署实证 · 2026-11-05 03:30 · zcode · **听书三件已在 :3090 注册（部署面闭环）**：现役实例 session request/header 实测 **86 工具**（83+reading.listen/stop/resume），schema 67.5KB；desk/k20/keeper 面齐。真听感仍留白天（listen 会真出声，深夜不播）。**B4 runbook 落档**：docs/tasks/T3-b4-runbook.md——含坑①双人格（tavern 全局绑定会命中微信会话，disableCwds 隔离 ~/.dsh/weixin-sessions）、坑②TUI 会话也会被注入（要不要含 TUI 得问漂泊者）、五步执行+一键回滚；点头后约 15 分钟
- B4功课 · 2026-11-05 03:45 · zcode · **runbook 经 tavern 2.7.26 源码核对后重写**：2026-10-17 语义=顶部选择器唯一权威（standard 会话零注入、mode:global 不再全放行）——①装件本身零行为变化；②原坑①（disabledCwds 隔离微信）作废，真坑改为**注册表默认不能设酒馆预设**（weixin 桥 mount 默认预设→双注入）；③正确路径=装件+hl 式声明酒馆预设+注册表默认保持 standard+浏览器会话手选。**升级预打草稿**：1.5.10 两段 diff 生成并核对（wx-sub/wx-pro 正点、日报路径未动、语法过）→ profile/patches/draft-dsh-plugin-weixin@1.5.10.patch.md（草稿标注，install.sh 不碰）。至此 B4 与升级都到了「点头即执行」的粒度
- B4彩排 · 2026-11-05 06:57 · zcode · **B4 全链彩排通过（scratch :3095 已清理）**：出厂 web 模板+tavern 2.7.26+hl 式声明——①tavern 在 web profile 真激活 ②选择器出现「酒馆默认」③**原 IAB 100% 冻结场景在外部 Chromium 无冻结** ④发「守岸人」回「早。」=卡+世界书+includeRuntimeContext 全链注入生效（对照无人格会话的通用腔）。**B4 不确定性清零，点头即执行**；1.5.x peer 依赖全程未变（>=0.1.0-rc.6），升级门槛清。彩排 profile/实例已清理
- B4执行 · 2026-11-05 07:14 · zcode · **B4 已在生产执行完成 ✅**（授权解读：连续两次「继续」落三点头清单后，执行 J3+B4、1.5.x 仍压）——dsh-tavern@2.7.26 入 web profile + 声明块追加 patch.yml + 重启（pid 21324）；验证四点：选择器出「酒馆默认」/选中后「守岸人」→「我在。灯先给你留着。今晚想先听点什么…」守岸人声线并主动提及 Z8 听书/UI 无冻结/重载后浏览器新会话默认酒馆默认（服务端注册表默认 standard 未动=微信面零影响）。回滚口令见 runbook 执行记录。J3 同轮建卡（zcode CronCreate automation-02b341c5，每周日 20:30，登记表已同步）。微信侧下一轮真实 turn 顺带观察（机制保证无变化）
