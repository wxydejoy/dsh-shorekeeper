# 守岸人项目 · 长期备忘（精简版；完整历史见 ARCHIVE-memory-full-2026-11-15.md 与 2026-11-*.md 日志）

## 拓扑
- Mac 本机 10.14.14.117：hub :17890（launchd `cn.weiekko.dock-hub`，配置 ~/.config/dock-hub/hub.yaml，改完 kickstart）；dsh web :3090（launchd `cn.weiekko.dsh-web`，profile web，patch ~/.dsh/profiles/web/cordis.patch.yml）；LAN 门卫 :3093（scripts/web-lan-gate.js，自动补 token）；:3091 回环转发、:3092 TLS 转发（安卓语音 secure context 用 https://10.14.14.117:3092），四者都挂 launchd 常驻。
- k20 屏：10.14.14.177，adb 5555，背景面 :17920，应用 `cn.weiekko.dock`（配置在 app datastore，su 可读）。
- Windows wrobot：10.14.14.170，`ssh weiek@10.14.14.170`（管理员，PowerShell 5.1）。远程 PS 必须 base64 `-EncodedCommand`（本地 /tmp/winps.sh）。schtasks/wmic/reg 被拦用 cmdlet。探针在 D:\Users\weiek\Documents\Github\dock\hub，靠计划任务 HelmDockHub 活（SSH 手动起的随会话死）。
- token 抓法：`grep -o "token=[A-Za-z0-9_-]*" ~/.dsh/logs/dsh-web.out.log | tail -1`；种 cookie：`curl -c jar "http://10.14.14.117:3090/?token=…"`。console API：POST :3090/api/dsh-console/cmd（op: create/send/detail/sessions/cancel/selectModel/delete；send 支持 busyMode:'steer'）。
- 微信：persona-modes.json / persona-active.json 现读现生效；路由 ~/.dsh/weixin/config.json 的 chatModel/proactiveModel 优先于全局默认（换模型两边一起改）。
- 插件约定：TS，`export const inject=['tools']`（挂面板路由要加 'webServer' 且用 connection.register(ctx,…)）；分支改、check-all 绿了合 main 可推（push 授权仅 dsh-shorekeeper 仓库）。

## 规矩
- 进度记在仓库根 plan-2026-11-03-evening-two-agent.md 的「进度」区。一次一件事，不擅自 push 越权，高危（熄屏等）要他点头。
- 安卓端/dock 控制不深度思考，微信保留思考；禁止把 thinking disabled 焊到微信链路。
- 微信忙碌策略 = `busyMessageMode: interrupt`（我们 patch 的第三值，本意就是打断）；改 config.json 别覆盖这个键。dsh-plugin-weixin patch 覆盖 5 文件（agent-bridge/index/config-remote/session-reader/sessions），装回 18763B/3 文件说明 patch 被旧版覆盖。
- 微信「只发最终回答」判据 = turn/end 仅 `reason.kind==='completed'` 冻结正文，interrupted/aborted/disposed 一律静默。

## 环境坑
- 代理：shell 带 http_proxy=127.0.0.1:7890，curl 本机/LAN 必须 `--noproxy '*'`。
- launchctl：WorkBuddy 进程内一律 error 5 → 走 `ssh localhost 'launchctl …'`（ZCode 侧改为关沙箱直跑）。bootout 后等 job 消失再 bootstrap，否则竞态 error 5。
- launchd plist 必须显式 EnvironmentVariables.PATH=/opt/homebrew/bin:…。
- 重启 :3090：`ssh localhost 'launchctl bootout gui/501/cn.weiekko.dsh-web; launchctl bootstrap gui/501 ~/Library/LaunchAgents/cn.weiekko.dsh-web.plist'`。**别用市场页「保存并重启」**（会写 disabled 把插件摘掉，还可能 EADDRINUSE 抢端口）。
- Bash 工具里 nohup & 的进程随命令死，用 run_in_background；Chrome/IAB 免谈。
- plist 写死 --host 10.14.14.117 → 127.0.0.1:3090 必拒连；`/` 的 403 是 DNS-rebinding 栅栏正常行为，API 面不拦。**/api 栅栏按 Origin/Referer/Host 判**，代理/门卫必须改写这三个头否则全 403。
- 工具名必须 `[A-Za-z0-9_-]`（火山 openai-completions 遇点号直接 400 tools.N.function.name）。
- pnpm patch 会从 registry 重拉覆盖 node_modules：先存档再 patch；patchedDependencies 在 pnpm-workspace.yaml。

## 模型/provider
- 当前默认 = 火山 `ark/deepseek-v4-1-flash-261017`。scnet 2026-11-06 起账号级 431（402 是单模型余额，别混）。**切 provider 后必须扫存量会话钉定**（console op:selectModel 改），教训见 k20 语音事故：会话钉死挂掉的 provider → turn 无正文 → 前端兜底「没接住」。

## 已闭环事故（要点）
- k20 语音接不着 = 会话钉在 431 的 scnet；已钉火山，14.4s 真回复。链路：麦→VAD→app→/v1/companion/chat→书桌会话→字幕+TTS。遗留：休眠 wx-pro-11382a15e 仍钉 scnet；k20 reasoningEffort 未钉可再压延迟。
- keeper-tts 502 / 崩豆子 / 哑火 = PortAudio 流泄漏：callback 空缓冲静音不杀流、start_stream 先关旧流、失败退避重试；句柄失效时 kickstart `cn.weiekko.companion-tts`。诊断口 /reading-panel/status。
- 朗读音量 = 采样增益（volume/100），与系统音量解耦。系统默认输出被 NoMachine 劫持时用 `SwitchAudioSource -t output -s "Mac mini扬声器"`。
- 市场 dshmarket 已设 config.allowRestart:false。
- web profile 有 dsh-tavern（「酒馆默认」预设，守岸人人格）；注册表默认仍 standard（微信桥 mount 它，别改）。
- 微信 iLink 线曾整段失聪（getUpdates 超时、游标冻结），判据 sync.json mtime + accepted 日志；只能本人重扫。
