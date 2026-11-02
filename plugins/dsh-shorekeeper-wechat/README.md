# dsh-shorekeeper-wechat

> 状态：**未开工（T6）** · 任务文档：[docs/tasks/T6-wechat.md](../../docs/tasks/T6-wechat.md)

微信接入：让守岸人知道微信里发生了什么——新消息摘要进上下文、按需代读、经确认代发。

## 计划工具面

| 工具 | 职责 | 权限 |
|---|---|---|
| `wechat.digest` | 最近未读消息摘要（按会话分组，人名脱敏可配） | read-only |
| `wechat.read` | 读指定会话最近 N 条 | read-only |
| `wechat.send` | 经审批发送文本到指定会话（默认白名单联系人） | 审批（高危） |
| 事件注入 | 新消息事件 → 摘要注入上下文/推 k20 字幕，频率保守可配 | — |

## 接入路线（T6 首步做选型验证）

| 路线 | 优点 | 风险 |
|---|---|---|
| 企业微信 / 微信公众号合规 API | 官方通道，稳 | 覆盖个人微信有限 |
| wechaty + pad/协议 puppet | 覆盖全 | 封号风险，puppet 质量参差 |
| wechatferry / wcferry（Windows） | 能收能发 | 需挂一台 Windows，同样有风控风险 |

**红线**：默认只读不发；`wechat.send` 必须审批 + 联系人白名单；敏感词/转账/验证码类消息只提示不代读全文；凭据只进本机配置。

## 与其他件的关系

- 新消息 → 守岸人可决定是否打断/推屏（和 voice-mode、k20 联动）
- 通知兜底可叠 dsh-mobile-notify（Bark/ntfy）
