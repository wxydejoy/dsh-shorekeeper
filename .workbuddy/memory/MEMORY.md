# 守岸人项目 · 长期备忘（精简版；完整历史见 ARCHIVE-memory-full-2026-11-15.md 与 2026-11-*.md 日志）

## 拓扑
- Mac 本机 10.14.14.117：hub :17890（launchd `cn.weiekko.dock-hub`，配置 ~/.config/dock-hub/hub.yaml，改完 kickstart）；dsh web :3090（launchd `cn.weiekko.dsh-web`，profile web，patch ~/.dsh/profiles/web/cordis.patch.yml）；**:3093 HTTP 门卫 + :3092 HTTPS 门卫（同一脚本 scripts/web-lan-gate.js，后者 GATE_TLS_CERT/KEY 起 TLS），都自动补 token + 改写 Host/Origin/Referer（lan-gate2 / lan-gate-tls）**；:3091 回环转发。局域网设备永远用 `http://10.14.14.117:3093/`，手机开语音用 `https://10.14.14.117:3092/`，都不用带 token。
- dsh 登录 cookie 钉了 authority（签发时 Host:Port）→ 转发器不改 Host 就 401；python tls-forward.py 已退役。
- k20 屏：10.14.14.177，adb 5555，背景面 :17920，应用 `cn.weiekko.dock`（配置在 app datastore，su 可读）。
- Windows wrobot：10.14.14.170，`ssh weiek@10.14.14.170`（管理员，PowerShell 5.1）。远程 PS 必须 base64 `-EncodedCommand`（本地 /tmp/winps.sh）。schtasks/wmic/reg 被拦用 cmdlet。探针在 D:\Users\weiek\Documents\Github\dock\hub，靠计划任务 HelmDockHub 活（SSH 手动起的随会话死）。
- token 抓法：`grep -o "token=[A-Za-z0-9_-]*" ~/.dsh/logs/dsh-web.out.log | tail -1`；种 cookie：`curl -c jar "http://10.14.14.117:3090/?token=…"`。console API：POST :3090/api/dsh-console/cmd（op: create/send/detail/sessions/cancel/selectModel/delete；send 支持 busyMode:'steer'）。
- 微信：persona-modes.json / persona-active.json 现读现生效；路由 ~/.dsh/weixin/config.json 的 chatModel/proactiveModel 优先于全局默认（换模型两边一起改）。
- 插件约定：TS，`export const inject=['tools']`（挂面板路由要加 'webServer' 且用 connection.register(ctx,…)）；分支改、check-all 绿了合 main 可推（push 授权仅 dsh-shorekeeper 仓库）。
- **profile patch 按 entry id 命中，不是包名**：写完必须 `dsh --profile web --dump-config` 核对该 entry 上方有 `patched by …`、config 里有你写的键。教训：`- id: dsh-plugin-weixin` 一直静默失效（真实 entry id 是 `dsh-weixin`），导致 toolDenylist 与 busyMessageMode 从未生效；同理 `tools.restrict({deny})` 是精确名 Set，不支持通配。
- 侧栏只留一行「守岸人」：`dsh-keeper-console` 的 main 面板声明 `keeper.tabs`(list) 并做标签壳；k20(主屏布局,20)、reading(阅读,30)、console(设置,10) 各注册一格。**别再给新面板注册 sidebar.panellist**，加到 keeper.tabs；`children` 要写在 register entry 顶层，壳所需 props 走 `inject` 传。契约测试 plugins/dsh-keeper-console/test/sidebar-shell.test.mjs。
- **米家 = `@local/mijia-mcp` 守卫 + `@local/mijia-console` 面板**（`~/.dsh/local-bundles/dsh-mijia-console/`，改完要看它的 PATCHES.md）。白名单 5 台：挂灯 553687922 / 台灯 2052660114 / 空调 2007418912 + 两台温湿度计（卧室 blt.3.1mc438kgkcg00、耗材 blt.3.1mdoet55c4c01，`readOnly:true`）。`controlPerMinute:10` 按 did 分桶限流。**desk-mi 已于 2026-11-16 整套退役**（时间靠 dsh 内置 time-context，无需 desk_now）；微信灯控快路径随之消失，微信「开灯」多一次 LLM 往返。`dsh-mijia-sidebar` 同日删除（纯展示面板、无工具面，与 console 重复）。

## 规矩
- 进度记在仓库根 plan-2026-11-03-evening-two-agent.md 的「进度」区。一次一件事，不擅自 push 越权，高危（熄屏等）要他点头。
- 安卓端/dock 控制不深度思考，微信保留思考；禁止把 thinking disabled 焊到微信链路。
- 微信忙碌策略 = `busyMessageMode: interrupt`（我们 patch 的第三值，本意就是打断）；改 config.json 别覆盖这个键。dsh-plugin-weixin patch 覆盖 5 文件（agent-bridge/index/config-remote/session-reader/sessions），装回 18763B/3 文件说明 patch 被旧版覆盖。
- 微信「只发最终回答」判据 = turn/end 仅 `reason.kind==='completed'` 冻结正文，interrupted/aborted/disposed 一律静默。

## 环境坑
- 代理：shell 带 http_proxy=127.0.0.1:62841（WorkBuddy 沙箱代理，7890 已死），curl 本机/LAN 必须 `--noproxy '*'`。**git push 报 HTTP2 framing / Empty reply 是瞬时抖动，重试即可**（不要急着改 remote 或清代理）。
- **`dsh/node_modules/openai` 曾被升级事故砍成残包**（365 文件、无 package.json）→ 所有 LLM 调用 `PI_AI_ERROR Cannot find module './auth/workload-identity-auth.js'`。修法：按残包 `version.js` 版本 `npm pack` 后 rsync 覆盖。装/升 dsh 被打断必查 `node -e "require('openai')"`。
- console API 新建会话默认模型是 profile 的 `agent-default-model`（现在 `openrouter/free`，本机无 key）→ 报 400 `Reasoning is mandatory…` 别当成生产故障，先 `op:selectModel` 切 ark 再测。
- launchctl：WorkBuddy 进程内一律 error 5 → 走 `ssh localhost 'launchctl …'`（ZCode 侧改为关沙箱直跑）。bootout 后等 job 消失再 bootstrap，否则竞态 error 5。
- launchd plist 必须显式 EnvironmentVariables.PATH=/opt/homebrew/bin:…。
- 重启 :3090：`ssh localhost 'launchctl bootout gui/501/cn.weiekko.dsh-web; launchctl bootstrap gui/501 ~/Library/LaunchAgents/cn.weiekko.dsh-web.plist'`。**别用市场页「保存并重启」**（会写 disabled 把插件摘掉，还可能 EADDRINUSE 抢端口）。
- Bash 工具里 nohup & 的进程随命令死，用 run_in_background。内置 IAB 浏览器取不到 DOM（`dom_cua_get_visible_dom` 返回空）且截图超 10 MiB，手机视口验收走 Chrome headless + CDP（见下）。
- plist 写死 --host 10.14.14.117 → 127.0.0.1:3090 必拒连；`/` 的 403 是 DNS-rebinding 栅栏正常行为，API 面不拦。**/api 栅栏按 Origin/Referer/Host 判**，代理/门卫必须改写这三个头否则全 403。
- 工具名必须 `[A-Za-z0-9_-]`（火山 openai-completions 遇点号直接 400 tools.N.function.name）。
- pnpm patch 会从 registry 重拉覆盖 node_modules：先存档再 patch；patchedDependencies 在 pnpm-workspace.yaml（`pnpm add --force` 重跑整树后 patch 仍生效，已验证）。
- **`dsh-console-plugin` 的窄屏 CSS 会把 dsh 0.2.2 手机抽屉打散**（2026-11-17 已 patch）：它 `@media(max-width:520px)` 里裸用 `[role=dialog]{width:100vw}` + `> div{flex:1 1 auto;flex-direction:column}`，而**侧栏根节点就是 role=dialog** → 面板列表被 footer 挤掉、新会话按钮变竖条。已用 `div[class*="overlay"] > [role=dialog]` 限定作用域，patch 在 `profile/patches/dsh-console-plugin@0.5.62.patch`（install.sh 已登记）。**升该插件会丢 patch**（0.5.76/0.5.77 仍有此问题）。判据：手机视口下 `[class*="sidebarCol"]` 宽 338 但 `[class*="quietBars"]` 宽 393，或 `newSessionRow` 的 computed flexDirection 是 column 而祖先无 collapsed。
- **手机视口验收靠 Chrome headless + CDP**：dsh 内置浏览器 `dom_cua_get_visible_dom` 返回空、`tab_screenshot` 超 10 MiB。起 `Chrome --headless=new --remote-debugging-port=9333`（经 ssh localhost，否则沙箱拦），node 22 用全局 `WebSocket` 连 CDP，`Emulation.setDeviceMetricsOverride{width:393,height:852,deviceScaleFactor:3,mobile:true}` + `Page.captureScreenshot`。查某条 CSS 谁写的：`DOM.requestNode` → `CSS.getMatchedStylesForNode` → `CSS.getStyleSheetText`。
- **装/升 dsh 只能用 `/opt/homebrew/bin/npm`（node v25）**：WorkBuddy 自带 node 22 的 npm 全局前缀指向 `~/.workbuddy/binaries/node/…/bin`，rename bin 报 EIO 装不上；安装被打断后 `dsh` 软链会留在 `.dsh-XXXX` 临时名，补 `ln -sfn ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js /opt/homebrew/bin/dsh`。
- **dsh 0.2.2 起 engines.dsh 是硬闸**：不兼容的 profile bundle 直接 skipping（不再降级跑）。加/升生态插件先 `npm view <pkg>@latest engines.dsh`。当前 0.2.2-rc.3 + dsh-arrowkey-nav 0.5.10 / dsh-ops 0.5.5 / dsh-tui 0.20.1。
- pnpm `ERR_PNPM_EIO [symlinkAllModules]` = 虚拟目录只剩依赖软链、包本体没落地；删 `node_modules/.pnpm/<pkg>+<ver>_*` 后 `pnpm add --force`。

## 模型/provider
- 当前默认 = 火山 `ark/deepseek-v4-1-flash-261017`。scnet 2026-11-06 起账号级 431（402 是单模型余额，别混）。**切 provider 后必须扫存量会话钉定**（console op:selectModel 改），教训见 k20 语音事故：会话钉死挂掉的 provider → turn 无正文 → 前端兜底「没接住」。

## 已闭环事故（要点）
- **提醒去重必须落盘**：keeper-watch 的「同一件事一天一次」原来只存内存，dsh 一天重启六次就发了六条一样的 PM2.5（2026-11-16）。现落 `~/.dsh/keeper-watch-state.json`。判据：**journal 的 `out` 是发送前写的，不代表送达**；`outbox.json` 里 attempts≥8 = parked 永不再试，要手动 drop。
- k20 语音接不着 = 会话钉在 431 的 scnet；已钉火山，14.4s 真回复。链路：麦→VAD→app→/v1/companion/chat→书桌会话→字幕+TTS。遗留：休眠 wx-pro-11382a15e 仍钉 scnet；k20 reasoningEffort 未钉可再压延迟。
- keeper-tts 502 / 崩豆子 / 哑火 = PortAudio 流泄漏：callback 空缓冲静音不杀流、start_stream 先关旧流、失败退避重试；句柄失效时 kickstart `cn.weiekko.companion-tts`。诊断口 /reading-panel/status。
- 朗读音量 = 采样增益（volume/100），与系统音量解耦。系统默认输出被 NoMachine 劫持时用 `SwitchAudioSource -t output -s "Mac mini扬声器"`。
- 市场 dshmarket 已设 config.allowRestart:false。
- web profile 有 dsh-tavern（「酒馆默认」预设，守岸人人格）；注册表默认仍 standard（微信桥 mount 它，别改）。
- 微信 iLink 线曾整段失聪（getUpdates 超时、游标冻结），判据 sync.json mtime + accepted 日志；只能本人重扫。
