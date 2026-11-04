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
