# k20 熄屏心跳：Windows 小软件直连网关

日期：2026-11-05

## 问题

k20 压黑只看快照里的 `pc.online`（`DockViewModel.noteDeskPc`）。约定是：Windows 开着就保持亮，关机或睡眠之后再等 `hubSleepDelaySec`（最少 15 秒）压黑。锁屏和离开座位不压黑。

这个位现在从旧 hub 长轮询进来，hub 再等 Windows 上 dock 探针的心跳。探针要管理员权限，并且绑在准备退役的 hub 上。探针不在报时，网关把 `pc.online` 收成 false，屏就一直压黑。

安卓端不改。它继续只看 `pc.online`。

## 做法

一台只报「Windows 还醒着」的小软件，直接把心跳打到 Mac 上的 k20 网关。网关用这颗心跳覆盖快照里的 `pc.online`。CPU、内存、GPU 仍用 hub 已有样本，只换在线位。

小软件还从没报过到时，网关保持今天的 hub 样本逻辑，避免程序没装上之前屏的行为就变。

## 信号

| 事件 | `pc.online` |
|---|---|
| 心跳在 20 秒内，且最后一拍是在线 | true，屏保持亮 |
| 收到 `{ "online": false }`（睡眠前补拍） | 立刻 false |
| 超过 20 秒没有新心跳（关机、睡眠、进程退出、网断） | false |
| 锁屏、键鼠闲置 | 不改变在线位 |
| 本进程从未收到过 `/v1/desk` | 沿用现有 hub 样本：60 秒内的样本原样透传，否则 `{ online: false }` |

安卓看到 false 之后，仍按自己的 `hubSleepDelaySec` 再压黑。心跳恢复成 true 后，安卓自己唤醒。

连续相同的在线结果不递增 snapshot 的 `seq`。只有新到的一拍让在线位变化，或并进来的 CPU 等指标变化，才 bump，避免 5 秒一拍把长轮询打醒。仅因超过 20 秒而变成离线，在下一次读取快照时算出来，不为此单独起定时器去 bump（与今天 hub 样本过期的做法相同）。安卓对 PC 另有约 3 秒的轮询，读到的就是过期后的 false。

`updated_at` 记最近一次在线位变化的时刻（UTC ISO-8601），包括「超时变成离线」这一次。在线位没变时不刷新这个字段。

## 网关

文件：`plugins/dsh-shorekeeper-k20/src/server.ts`

新路由 `POST /v1/desk`，鉴权与其它 `/v1` 路由相同（Bearer，插件 config 的 token）。

请求体：

- 空对象，或没有 `online` 字段：视为 `{ "online": true }`
- `online: true` 或 `online: false`
- `online` 不是布尔：400，`{ error: { code: "bad_request", message } }`
- 成功：`{ "ok": true }`

常量 `DESK_STALE_MS = 20_000`，不进配置。

`noteDesk` 记下 `{ online, at }`。`at` 是网关收到请求的本地毫秒时间，默认 `Date.now()`。请求体里的时间一律不采用。测试直接调用 `noteDesk` 时可以传入过去的 `at`。

`pcState()`：

- 从未 `noteDesk`：保持现有逻辑（`PC_STALE_MS` 60 秒）。
- 已接管：`online = (now - at <= 20_000) && online !== false`。hub 样本在 60 秒内时，把 `cpu` / `memory` / `gpu` / `fps` 抄到结果上；`online` 与 `updated_at` 以心跳为准。hub 样本过期时这两项仍以心跳为准，指标字段省略。

退出托盘里的小软件会停心跳，20 秒后按关机处理。这是预期行为。

## Windows 小软件

文件：`win/k20-desk/desk.ps1`，说明：`win/k20-desk/README.md`。

PowerShell，只用系统自带组件。不打包 exe，不请求管理员。

配置 `%APPDATA%\k20-desk\desk.json`：

```json
{
  "url": "http://10.14.14.117:3090/v1/desk",
  "token": "<与 k20 插件相同的 token>",
  "interval_sec": 5
}
```

`url` 和 `token` 必填。`interval_sec` 缺省 5，小于 1 时按 1。token 不进 git。网关地址写在配置里，脚本不写死 IP。当前 dsh 绑在局域网地址上，示例用 `http://10.14.14.117:3090/v1/desk`。

行为：

- 每 `interval_sec` 秒 `POST` `{ "online": true }`，头 `Authorization: Bearer <token>`，`Content-Type: application/json`。
- 订阅 `Win32_PowerManagementEvent`：EventType 4（进入睡眠）补一拍 `{ "online": false }`；EventType 7（唤醒）立刻补一拍 `{ "online": true }`，不等下一个间隔。订阅失败只记日志，循环继续，靠 20 秒过期兜底。
- 会话结束（注销、关机）时尽力补一拍 `{ "online": false }`。来不及发出去就靠过期。
- 不监听锁屏，不读键鼠闲置。
- 网络错误、401、其它非 200：托盘显示失败，按间隔重试，进程不退出。
- 配置文件不存在，或缺少 `url` / `token`：写一份带空字段的模板到该路径，记一行日志后退出，不空转。

界面：托盘图标（`System.Windows.Forms.NotifyIcon`）。文字显示「k20 屏：在线」或「k20 屏：上报失败」。菜单只有「退出」。

日志：`%LOCALAPPDATA%\k20-desk\desk.log`，追加。超过 256KB 时只保留末尾 64KB。

`-Install`：把脚本复制到 `%LOCALAPPDATA%\k20-desk\desk.ps1`，在启动文件夹写入 `k20-desk.vbs`，内容是用 `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File` 启动该副本。配置已就绪才写入启动项；否则先写模板并退出，提示填好再执行一次。

`-Uninstall`：删掉启动文件夹里的 vbs 和 `%LOCALAPPDATA%\k20-desk\desk.ps1`。配置和日志保留。

## 测试

`plugins/dsh-shorekeeper-k20/test/protocol-server.test.ts` 增加：

- 无鉴权或错 token 的 `POST /v1/desk` → 401
- `online` 非布尔 → 400
- 空体 → 200，随后 snapshot 的 `pc.online` 为 true
- `{ "online": false }` 且接收时间在 20 秒内 → `pc.online` 为 false
- `noteDesk({ online: true })` 的接收时间早于 20 秒 → `pc.online` 为 false（请求体不带时间）
- 先 `setPc` 一份带 `cpu` 且 `online: false` 的 hub 样本，再心跳在线 → snapshot 里 `online` 为 true 且 `cpu` 仍在
- 心跳已是 false 之后，hub 样本把 `online` 写成 true，盖不住
- 心跳曾接管、接收时间已超过 20 秒，同时 hub 样本仍新鲜且 `online: true` → snapshot 仍是 `online: false`
- 从未心跳时，现有「透传 hub 样本 / 过期变 false」测试保持通过
- 连续两拍在线且指标不变 → `seq` 不增加；在线变为 false → `seq` 增加

Windows 脚本不在 Mac 上做自动化测试。契约以网关单测和 README 里的请求形状为准。

## 不做

- 不改安卓 app，不改 `hubSleepDelaySec`
- 不根据锁屏或闲置压黑
- 不采集 CPU、温度，不替代 dock 探针的监控和启动程序
- 不改 keeper-watch（它仍读 hub 快照）
- 不在本任务停 hub
- 心跳过期时间不做成配置项
