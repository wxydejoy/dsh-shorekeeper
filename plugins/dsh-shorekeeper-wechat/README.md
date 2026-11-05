# dsh-shorekeeper-wechat

> 状态：**实现中（T6）——路线已定（wcferry 主选，签字区待漂泊者）+ 插件三工具完成；桥实现与真机验证 ⏸** · 任务文档：[docs/tasks/T6-wechat.md](../../docs/tasks/T6-wechat.md) · 路线决策：[docs/decisions-wechat-route-v2.md](../../docs/decisions-wechat-route-v2.md) · 桥契约：[docs/bridge-contract.md](docs/bridge-contract.md)

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

## 实现说明（2026-11-03 · 阶段二）

- 插件与桥 **HTTP 解耦**：桥（Windows 挂机侧 wcferry 小服务，契约 [docs/bridge-contract.md](docs/bridge-contract.md)）崩了可重启不丢状态；桥不可达 → 工具层优雅降级
- 三工具落地：`wechat.digest`（分组摘要 + 人名脱敏默认开，稳定别名不漂）/ `wechat.read`（验证码/转账类整条隐藏只提示）/ `wechat.send`（三重闸门：总闸默认关 → 白名单硬拒 → host 审批 ⏸ T1；拟发内容也过红线）
- 安全层纯函数（`src/safety.ts`）：脱敏/敏感识别/白名单各自单测；全部 15 条测试绿，`tsc --noEmit` 零错
- ⏸ 待办：桥实现（Windows 侧，按契约）+ PoC（wcferry/donut 两条，真机）+ 事件注入（digest 进上下文的频率策略，待 T1 后按 voice-mode 集成面设计）+ 通知兜底叠装说明
