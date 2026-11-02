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

- 工具定义用 `@deepseek-ai/dsh-tools` 的 `defineTool` DSL（`@deepseek-ai/dsh@0.2.1-rc.5` 实测）：参数根级平铺、required 是每属性注解
- 已知 TODO（T1 真机校准）：设置卡片接线（rc.5 SDK 未暴露 `installSection`）、高危工具的 host 审批接线（暂以 `lockEnabled` 配置闸门兜底）、watcher 随 fiber 卸载（SDK Events 无 dispose 事件）
- `npm run typecheck` 零错误；`npm test` 24/24（mock Hub + mock BackgroundServer）
