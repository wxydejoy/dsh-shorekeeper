# 守岸人项目 · 长期备忘

## 拓扑与真值位置（勿把 token 写进仓库）
- Hub（dock-hub，Python）：Mac 本机 :17890，launchd 服务 `cn.weiekko.dock-hub`，配置 `~/.config/dock-hub/hub.yaml`（token 在此）。改代码后需 kickstart 重启才生效。
- k20 屏：`k20.lan`（10.14.14.177），adb 5555，背景面 :17920，应用 `cn.weiekko.dock`，应用配置在 app datastore（su 可读）。
- dsh web profile（唯一主实例）：:3090，配置 `~/.dsh/profiles/web/cordis.patch.yml`；微信状态 `~/.dsh/weixin/`（persona-modes.json / persona-active.json，均为每次现读，改完即生效）。
- dsh 插件约定：TS，`export const inject = ['tools']`；分支上改、check-all 绿了合 main 可推（漂泊者既有授权）。

## 漂泊者的规矩与偏好
- 进度交接板：docs/plans/plan-2026-11-03-evening-two-agent.md 的「进度」区，每完成一项 W 追加一行。
- 一次一件事、别问太多、不擅自 push 越权的东西（push 授权以「绿了可推」为准，高危项如熄屏要他点头）。
- feiyu 话题已撤项（2026-11-04「别提了 删掉」）：上游 issue 不提交；feiyu-memory 本体（日记记忆插件）仍在用。
- 思考拆面（2026-11-04 定调）：**安卓端/dock 控制不深度思考，微信聊天保留思考**。禁止把 thinking disabled 焊到微信链路；微信提速走 prompt 瘦身/米家链路，不动思考。

## 坑
- shell 带 http_proxy=127.0.0.1:7890：curl 本机/LAN 必须 --noproxy '*'，「upstream connect failed」是代理假象。
- GLM-4-Flash 会把工具调用记号当回复贴（W9 观察）；feiyu@4.0.2 的 UNSUPPORTED_REASONING_EFFORT 用本机 pnpm patch 修了（上游 issue 不再提）。
- launchctl bootstrap/load/submit 在 WorkBuddy 进程里一律 error 5（非沙箱问题，非沙箱通道也拒）——**走 ssh 回环**：`ssh localhost 'launchctl bootstrap gui/501 <plist>'`（sshd 已开、id_rsa 已进 authorized_keys，2026-11-04 实证）。
- launchd 服务 plist 必须显式给 EnvironmentVariables.PATH=/opt/homebrew/bin:...（默认 PATH 找不到 node，`#!/usr/bin/env node` 起不来）。
- :3090 实例已由 launchd `cn.weiekko.dsh-web` 常驻（RunAtLoad+KeepAlive，kill -9 自愈实证）；重启口令：ssh localhost 'launchctl bootout gui/501/cn.weiekko.dsh-web; launchctl bootstrap gui/501 ~/Library/LaunchAgents/cn.weiekko.dsh-web.plist'。
- dsh web 的 403 辨认：skip-browser-auth 栅栏按 Host 头判，IP Host 打根路径 `/` 403 属正常（DNS rebinding 防护），API 面（/health、/v1/snapshot 等）不拦。
- effort 链分层：TUI effort（~/.dsh-tui）只管 TUI 会话；weixin chat 路由只带 provider/model，turn 请求不发 thinking 字段 → 智谱默认**开思考**（微信慢的主因之一）。给微信钉思考：weixin 路由对象加 reasoningEffort（installModelSelection 透传）+ patch 里模型声明 reasoningEfforts。
- Bash 工具里 `nohup … &` 起的常驻进程会随命令结束被杀；要用 run_in_background: true。launchctl bootstrap 在 agent 沙箱一律被拦。

## 夜班 zcode（2026-11-05）新增
- **pnpm patch 会冲 node_modules**：`pnpm patch <pkg>` 是从 registry 重拉 pristine 覆盖安装副本（不是复制现状）——直改的 node_modules 补丁要先存档再 patch；patch 会话（.pnpm_patches）commit 前一直保留，可继续编辑再 patch-commit。已固化的 patchedDependencies 在 pnpm-workspace.yaml（pnpm 11 不写 package.json）。
- **bootout 后立即 bootstrap 会 error 5 竞态**：等 job 从 launchctl print 消失再 bootstrap。
- **dsh headless persona 注入点 = `system-prompt.personaPrefix`**（dsh-base 的 `- id: persona` 覆盖目标行不存在=静默无效）；headless 下 tavern 插件 pending（等 webServer），卡/世界书注入不可用——Z7 回归是程序化合成 tavern 等价注入。回归 profile `shorekeeper-reg`（headless 模板+zhipu+desk-mi，Z7 专用，可随时删）。
- **微信 prompt 瘦身杠杆 = dsh-tools 的 `tools.restrict({deny})`（agent-scope）**：已给 dsh-plugin-weixin 打 patch 加 `toolDenylist`（配在实例 cordis.patch.yml 的 dsh-plugin-weixin 段，55 名单，默认空=不裁剪）；实测 83 工具 66.6KB schema 是 81KB prompt 的大头（系统段仅 7.1KB，技能没真正注入微信）。实证挂下一轮真实微信 turn 的 request/header tools 数。
- **米家控灯已单进程化**：mi_bridge `light_set`（解析+在线+挑属性+写入一趟）；离线判定在 python 侧，TS 只透传。sleep_time 保持库默认 0.5（限速保守）。
- **hub 第一批退役已生效**：`retire.monitoring: true` 在 ~/.config/dock-hub/hub.yaml（/metrics|telemetry|power 404；snapshot/health/companion 不受影响）；回滚=翻 false+kickstart（脚本：岸亭 docs/t7-rollback-drill.sh）。retire 机制在 dock main 已跑（0d422c1 摘入），hub-slim 分支是平行线。
- **岸亭 push 授权仍只限 dsh-shorekeeper 仓库**；dsh-plugin-weixin 上游今天发了 1.5.x（1.4.3 不含消毒逻辑）——升级与否等漂泊者点头，升级则两个 patch 都要重做。
- **驱动生产实例会话的口子 = console API**：POST `:3090/api/dsh-console/cmd`（Bearer 用 ~/.dsh/dsh-console-token.json 的 token；body `{op, payload:{...}}`）。op：create（cwd）/send（sessionId+text，走 ctl.prompt 真会话轮）/detail（sessionId，返回 turns 含逐 turn tools 调用记录）/sessions/cancel 等。不用等微信消息就能在生产实例上验证 agent 级行为（Z4 实证）。
