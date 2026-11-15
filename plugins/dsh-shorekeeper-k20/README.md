# dsh-shorekeeper-k20

> 状态：**实现中（T2）——阶段一/二代码完成，真机联调 ⏸ 待 T1** · 任务文档：[docs/tasks/T2-k20-display.md](../../docs/tasks/T2-k20-display.md)

k20 安卓横屏摆件的 DSH 驱动插件：把这块屏变成守岸人的「脸」——字幕、背景、模块编排、熄屏、媒体键，全部注册为 agent 可调用工具。

## 计划工具面

| 工具 | 职责 | 权限 |
|---|---|---|
| `k20.caption` | 推送/清除字幕（守岸人说话同步） | read-only |
| `k20.snapshot` | 读取屏状态：模块布局、背景、在线态 | read-only |
| `k20.wallpaper` | 上传/切换图片或视频背景 | 审批 |
| `k20.layout` | 模块显隐/样式/透明度 | 审批 |
| `k20.media` | 媒体键（上一首/播放暂停/下一首）+ 系统音量 | 审批 |
| `k20.lock` | 设备管理员熄屏 | 审批（高危） |

> 注：原计划的 dsh-desk-senses 已砍——室内温湿度由米家温湿度计提供，走 dsh-mihome 生态件读数，k20 只负责显示。

## 技术要点

- 协议客户端按 `reference/lan-protocol.md` 快照 TS 重实现：Bearer token、长轮询、断线重连
- Config（Schemastery）：k20 地址、token、字幕样式默认值
- Hub 离线时工具优雅降级（返回预览模式说明，不报错刷屏）
- 单测：mock k20 服务器；联调：真机 k20.lan

## 实现说明（2026-11-03 · 阶段一/二）

客户端分三面：

| 面 | 对端 | 依据 | 状态 |
|---|---|---|---|
| Hub v1 协议客户端 | 瘦身 Hub（:17890） | `reference/lan-protocol.md` | ✅ Bearer/长轮询(seq)/退避重连/超时分级；`SnapshotWatcher` 供 T3/T4 订阅 |
| BackgroundServer 客户端 | k20 安卓端（:17920） | dock 仓库 `BackgroundServer.kt` 实测 | ✅ cookie 会话、list/upload(即生效)/select/clear/remove、layout 只读 |
| 网关增补提案客户端 | 瘦身 Hub（待 T7 实现） | [docs/protocol-addendum.md](docs/protocol-addendum.md) | ⚠️ `/v1/caption`、`/v1/phone/layout`、`/v1/lock` 三条提案路由，落地前真机 404 → 工具层优雅降级 |
| **网关服务端**（T7 直链） | 本实例宿主 webServer | lan-protocol v1 + 增补提案 | ✅ `serve: true` 开启；`/health`、`/v1/snapshot`（长轮询）、`/v1/caption`、`/v1/phone/layout`、`/v1/lock`、`/v1/devices/*`（media 乐观应答）、`/v1/companion/announce\|stop`（**语音直连 keeper-tts :18100**，hub 退役第一步；ttsBaseUrl 置空则只回执不出声）、`/v1/companion/chat`（**书桌会话本地大脑**：companion-voice 驱动 dsh 会话轮，正文空才回兜底句——2026-11-14 实测；`memory/audio` 仍代理 companionUpstream，置空则 404）；单测 test/protocol-server.test.ts。宿主 `dsh web --host <局域网IP>` 才能被 k20 直连 |

- 工具定义用 `@deepseek-ai/dsh-tools` 的 `defineTool` DSL（`@deepseek-ai/dsh@0.2.1-rc.5` 实测）：参数根级平铺、required 是每属性注解
- 已知 TODO（T1 真机校准）：设置卡片接线（rc.5 SDK 未暴露 `installSection`）、高危工具的 host 审批接线（暂以 `lockEnabled` 配置闸门兜底）、watcher 随 fiber 卸载（SDK Events 无 dispose 事件）
- `npm run typecheck` 零错误；`npm test` 38/38（mock Hub + mock BackgroundServer + mock webServer）

## 侧栏「主屏布局」标签（含背景壁纸）

2026-11-15 起侧栏不再单独占一行：`client.js` 往 `keeper.tabs`（由 dsh-keeper-console
声明）注册 `k20-layout`（order 20），入口是侧栏「守岸人」→「主屏布局」。
上半部槽位拖拽，下半部「背景壁纸」——上传、切换、删除、恢复纯色。

预览板会把**当前壁纸的海报图铺满**（`?w=960` 那张，cover），磁贴半透明压在上面，
一眼就能看出磁贴压在脸的哪个位置；右上角「壁纸预览」可临时关掉看纯色效果。

| 走向 | 通道 | 说明 |
|---|---|---|
| 元数据（snapshot / save / backgrounds / limits / select / remove / clear） | `POST /k20-layout/<action>`（connection rpc 信封） | `src/index.ts` 的 `registerLayoutPanel` 直挂宿主 webServer，不经过 connection.rpc 的 fiber |
| 缩略图 | `GET /k20-bg/poster/<id>?w=320\|960` | ffmpeg 抽一帧缩到指定宽（默认 320，夹 160–1600），缓存到 `~/.dsh/k20-bg-posters/`，键含 bytes+modified+width |
| 视频预览、原图 | `GET /k20-bg/media/<id>` | 插件代持手机 cookie 转发 `:17920/api/backgrounds/<id>/media`，浏览器不直连手机 |
| 上传 | `POST /k20-bg/upload?name=&realname=[&kind=image\|video]`（body 为文件原字节） | 边收边转，200MB 视频不进内存做 base64 |
| 上传上限 | `GET /k20-bg/limits` | 面板先拿这张表做前端预检；curl 也能查 |

### 上传闸门（2026-11-15）

手机端 BackgroundServer 既不限大小也不验格式（43MB 视频照收），所以闸门在插件里，
转发到手机之前就拦（`src/upload-guard.ts`）：

| 关卡 | 规则 | 回 |
|---|---|---|
| 扩展名 | `jpg/jpeg/png/webp`（图）· `mp4/webm`（视频）；没后缀可加 `?kind=` | 415 |
| 大小 | 图 ≤`backgroundImageMaxMB`(20) · 视频 ≤`backgroundVideoMaxMB`(200) | 413（按 Content-Length 先拒，chunked 边转边数） |
| 魔数 | 前 12 字节认 JPEG/PNG/WebP/MP4/WebM，与后缀不符也拒 | 415 |
| 空体 | 没有字节 | 400 |

顺序是 `peekHead`（只读 12 字节）→ `assertContent` → 才开始连手机，内容不对不会在手机
那头留个 0 字节背景。curl 直传：

```sh
curl --data-binary @海边.jpg \
  'http://10.14.14.117:3090/k20-bg/upload?name=海边.jpg&realname=守岸人'
```

三个坑（2026-11-15 实测）：

- 手机端 `BackgroundServer.readForm` 用 `Content-Length` 限流读，**chunked 上传会被当空文件**（400）。所以转发时必须把
  「multipart 头 + 文件 + 尾」的总长度算出来显式带上；拿不到长度才退回整段缓冲。
- 上传要实名：手机校验 2–20 个字、不能带数字，面板默认填「守岸人」，改署名再传。
- 视频抽帧不能喂管道：`output_2k.mp4`（43MB / 2560×1440）的 moov 在尾部，stdin 不可 seek，
  ffmpeg 会读到 EOF 再报没帧。视频一律先落临时文件，`-ss` 放在 `-i` 前快进；图片才走管道。
  首次抽帧 = 一次整段下载（43MB 约 10s），之后命中缓存 0.1s。
- ffmpeg 依赖：默认找 `/opt/homebrew/bin/ffmpeg`（launchd 的 PATH 里有），也可用 `DSH_FFMPEG` 指路径。
