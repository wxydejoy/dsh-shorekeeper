# dsh-shorekeeper-k20

> 状态：**未开工（T2）** · 任务文档：[docs/tasks/T2-k20-display.md](../../docs/tasks/T2-k20-display.md)

k20 安卓横屏摆件的 DSH 驱动插件：把这块屏变成守岸人的「脸」——字幕、背景、模块编排、熄屏、媒体键，全部注册为 agent 可调用工具。

## 计划工具面

| 工具 | 职责 | 权限 |
|---|---|---|
| `k20.caption` | 推送/清除字幕（守岸人说话同步） | read-only |
| `k20.snapshot` | 读取屏状态：模块布局、背景、**室内温湿度**（手机上报）、在线态 | read-only |
| `k20.wallpaper` | 上传/切换图片或视频背景 | 审批 |
| `k20.layout` | 模块显隐/样式/透明度 | 审批 |
| `k20.media` | 媒体键（上一首/播放暂停/下一首）+ 系统音量 | 审批 |
| `k20.lock` | 设备管理员熄屏 | 审批（高危） |

> 注：原计划的 dsh-desk-senses 已砍——室内温湿度传感器在手机上，数据经 k20 上报，归入本插件（`k20.snapshot` 与 `k20.sensors`）。

## 技术要点

- 协议客户端按 `reference/lan-protocol.md` 快照 TS 重实现：Bearer token、长轮询、断线重连
- Config（Schemastery）：k20 地址、token、字幕样式默认值
- Hub 离线时工具优雅降级（返回预览模式说明，不报错刷屏）
- 单测：mock k20 服务器；联调：真机 k20.lan
