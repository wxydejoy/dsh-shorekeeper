# T2 · dsh-shorekeeper-k20 —— 安卓屏驱动

```
状态: doing · owner: 值班 agent · 开始于: 2026-11-03 · 预估: 14–20 agent 小时 · 前置: T1
分支: T2-k20-display
```

## 目标

k20 安卓横屏摆件变成守岸人的「脸」：字幕、背景、模块编排、熄屏、媒体键，全部注册为 agent 工具，真机逐步生效。

## 背景

k20 只当「显示屏 + 麦克风」外设，大脑在 dsh。协议见 `reference/lan-protocol.md` 快照（鉴权、长轮询、时序）；背景上传链路对照 `reference/dock_hub/wallpaper.py`；媒体键对照 `media.py`。原 dsh-desk-senses 已砍——室内温湿度由米家温湿度计提供，走 dsh-mihome，k20 只显示。

## 步骤

### 阶段一：协议客户端（4–6h）
- [x] 插件包初始化：package.json（钉 dsh 版本）、tsconfig strict、vitest
- [x] TS 重实现 LAN 协议客户端：Bearer token、`/health`、长轮询订阅、断线重连、超时
- [x] Config 三件套：Schemastery schema（k20 地址/token/字幕样式）（设置卡片接线 ⏸ 待 T1：rc.5 SDK 未暴露 `installSection`）
- [x] mock k20 服务器（mock Hub + mock BackgroundServer）+ 单测覆盖协议层（24 条全绿）

### 阶段二：工具面（6–8h）
- [x] `k20.snapshot`：布局 + 背景 + 在线态
- [x] `k20.caption`：推/清字幕（守岸人说话同步的钩子留给 T4；走协议增补提案路由，真机 ⏸）
- [x] `k20.wallpaper`：图/视频上传与切换（对照 dock/android `BackgroundServer.kt` 实测路由，全链路可用）
- [x] `k20.layout`：模块显隐/样式/透明度（read 实路；apply 走提案路由 ⏸）
- [x] `k20.media`：媒体键（系统音量协议 v1 无路由 ⏸，Mini 音量走 keeper-tts `/v1/settings`）
- [x] `k20.lock`：设备管理员熄屏（高危审批，默认关闭：`lockEnabled` 闸门兜底 + host 审批接线 ⏸ T1）
- [x] 权限分级落地：读 read-only，写/控全走 sandbox_permissions 审批（审批接线 ⏸ T1 真机校准）

### 阶段三：联调与打磨（4–6h）
- [ ] 真机联调（k20.lan）：离线优雅降级（⏸ 待真机；降级路径已在工具层实现并单测）
- [x] 长轮询事件 → 工具回调（`SnapshotWatcher` 已具备；T3/T4 的事件订阅接口待其任务接入）
- [x] 完成插件 README 工具面表与验收记录

## 交付物
- `plugins/dsh-shorekeeper-k20/` 完整实现 + 单测
- mock k20 服务器（测试夹具，供后续任务复用）

## 验收标准
- [ ] 会话里「把这段话打到屏上，换这张背景图，最后熄屏」真机逐步生效
- [ ] 「现在屋里多少度」经 k20.snapshot 秒答
- [ ] 拔掉 Hub，所有工具优雅降级不崩
- [ ] 熄屏/换背景在未审批时被拒

## 拓展方向 / 未来方向
- 拓展：主动事件推屏（番茄钟倒计时、天气预警卡）；Web UI 全屏预览卡片
- 未来：e-ink 副屏同工具面接入；屏幕布局存档版本化

## 风险与对策
| 风险 | 对策 |
|---|---|
| 协议快照与真机有出入 | 以真机为准，差异记录回 lan-protocol 变更记录 |
| 长轮询在插件进程内的心跳管理 | 抽成独立 service，工具只是查询面 |

## 验收记录

### 2026-11-03 · 值班 agent · 阶段一/二完成
- **SDK 实测**（修正 README 规范里的猜测）：真包 `@deepseek-ai/dsh@0.2.1-rc.5`（npm 的 `dsh` 是无关旧库）；工具定义用 `@deepseek-ai/dsh-tools` 的 `defineTool` DSL——参数根级平铺、`required: true` 是每属性注解、output 走 `type:'json'` 宽松壳；Config 用 `@deepseek-ai/schemastery`（默认导出）。SDK Events 无 `dispose` 事件、未见 `installSection`，两处接线标 TODO 待 T1。
- **架构决策**：客户端分三面——① Hub v1 协议客户端（长轮询/断线重连/超时分级，`SnapshotWatcher` 备 T3/T4 订阅）；② k20 安卓端 BackgroundServer（:17920，按 dock 仓库 Kotlin 源码实测：cookie 会话 + 上传即生效）；③ 网关增补提案（`/v1/caption`、`/v1/phone/layout`、`/v1/lock`，契约见插件 `docs/protocol-addendum.md`，按协议 §13 先文档后代码的规矩，网关侧归 T7）。字幕/布局写入/熄屏在提案落地前，真机调用 404 → 工具层优雅降级。
- **验证**：`npx tsc --noEmit` 零错误；`npx vitest run` 24/24 通过（mock Hub 覆盖鉴权/长轮询唤醒/超时/错误归一化；mock BackgroundServer 覆盖登录/上传即生效/中文文件名 filename* 编码/select/clear/remove/会话过期重登/layout 503）。
- ⏸ 待真机（T1 后）：真机 k20.lan 联调、设置卡片与 host 审批接线、提案三条路由的网关侧实现（T7）与安卓渲染（dock/android）。
- 注：`k20.wallpaper` 的路由依据是 dock 仓库安卓源码，`reference/wallpaper.py` 实为「一句话壁纸」台词池（F39），与上传链路无关——原任务书表述有偏差，已在插件 README 修正。
