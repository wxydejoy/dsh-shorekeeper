# T6 · dsh-shorekeeper-wechat —— 微信接入

```
状态: review（桥本体交付已合 main；v2 路线定案后由 dsh-plugin-weixin 承担入口，自写桥不再迁移） · owner: 值班 agent · 开始于: 2026-11-03 · 预估: 12–16 agent 小时 · 前置: T1
分支: T6-wechat
```

## 目标

> ⚠️ **2026-11-03 下午：目标已改口径。** 下面这段「读个人微信 + 摘要 + 代读 + 代发」作废——
> 漂泊者拍板不碰真账号，改走官方合规入口（企业微信智能机器人）。
> 新口径、插件选型与验收线见 [../decisions-wechat-route-v2.md](../decisions-wechat-route-v2.md) §4；
> 本文件的阶段/交付物/风险表在按该节重写前**不要照着执行**。

守岸人知道微信里发生了什么：新消息摘要进上下文、按需代读、经确认代发。**默认只读不发**。

## 背景

生态无现成个人微信接入件。接入路线需真机选型验证（能力覆盖 × 风控风险 × 维护成本）。

## 步骤

### 阶段一：路线选型（3–5h）
- [x] 候选调研：企业微信/公众号合规 API · wechaty（各 puppet）· wechatferry/wcferry（Windows 挂机）
- [ ] 各写 200 行内 PoC：收一条消息、发一条消息到文件传输助手（⏸ 待 Windows 真机；按决策记录只做 wcferry + wechaty-donut 两条，企微路线已否决）
- [x] 决策记录：覆盖面、封号风险、部署形态（挂哪台机器）、维护成本（`docs/decisions-wechat-route.md`：主选 wcferry，备选 donut/padlocal，否决企微；**签字区待漂泊者填写后才接真账号**）
- [ ] 若选 Windows 挂机：复用 win.lan 探针机器，出部署文档（⏸ 随阶段二实现产出）

### 阶段二：插件实现（5–7h）
- [x] 消息桥：接入层收消息 → 归一化事件（会话/发送人/类型/摘要）（桥契约 `docs/bridge-contract.md` + **桥本体已实现** `bridge/`：HTTP 面/发送节流/白名单二次校验 12 测绿；wcferry 真身适配器收窄四方法 ⏸ 真机接线）
- [x] `wechat.digest`：未读摘要按会话分组，人名脱敏可配（稳定别名，默认开）
- [x] `wechat.read`：指定会话最近 N 条（验证码/转账类只提示不代读全文——红线在工具层整条隐藏）
- [x] `wechat.send`：审批 + 联系人白名单 + 内容预览确认，白名单外硬拒（总闸 `sendEnabled` 默认关；host 审批接线 ⏸ T1）
- [ ] 事件注入：新消息摘要进上下文/推 k20 字幕，频率保守（⏸ 待 T1 后按 voice-mode/dsh 事件面设计）

### 阶段三：安全与打磨（4h）
- [x] 红线清单逐条落实（见下）+ 渗透自测（伪造发送人、超权发送）（单测覆盖：脱敏不泄真名/敏感整条隐藏/白名单外硬拒/总闸默认关/桥断降级——15 条全绿；真机渗透自测 ⏸）
- [ ] 通知兜底：叠 dsh-mobile-notify（⏸ 待 T1 装机后出叠装说明）
- [x] 单测（mock 微信桥）+ 真机验收记录（单测 ✅；真机验收 ⏸）

## 交付物
- `plugins/dsh-shorekeeper-wechat/` 完整实现
- 路线决策记录 + 接入层部署文档
- 安全红线清单与自测记录

## 验收标准
- [ ] 真实收一条微信消息 30 秒内摘要可见
- [ ] 代发走审批；白名单外联系人被硬拒
- [ ] 验证码/转账类消息不被代读全文
- [ ] 接入层崩掉时插件优雅降级，不影响 dsh 其他能力

## 拓展方向 / 未来方向
- 拓展：群消息 @我 优先级排序；重要联系人专属提示语
- 未来：快递/日程类消息自动归入生活流；守岸人代拟回复草稿

## 风险与对策
| 风险 | 对策 |
|---|---|
| 个人微信自动化封号 | 只读为主；发送极克制；决策记录里量化风险并由漂泊者签字 |
| 接入层不稳定 | 桥与插件解耦，桥崩可重启不丢状态 |
| 隐私 | 脱敏默认开；消息只存摘要，全文即时取即用不落盘 |

## 验收记录

### 2026-11-03 · 值班 agent · 阶段一路线选型
- 三路线调研完成（2026 现状核实）：wcferry 活跃维护但锁微信 3.9.11.25（4.0 不支持），hook 类有封号风险；wechaty web 协议基本废，可用 puppet（padlocal/donut）均收费；企微/公众号读不到个人微信收件箱，与目标错位，否决。
- 产出 `docs/decisions-wechat-route.md`：主选 wcferry（免费/活跃/覆盖全/复用 win.lan 挂机），备选 donut·padlocal（付费 Plan B）；桥做独立小服务与插件 HTTP 解耦。
- ⏸ 待真机：wcferry + wechaty-donut 两条 PoC（收一条消息、发一条到文件传输助手）；Windows 挂机部署文档随阶段二产出。
- ⚠️ 决策记录含风险签字区，接真账号前必须由漂泊者本人填写。

### 2026-11-03 · 值班 agent · 阶段二插件实现
- 插件与桥 HTTP 解耦（任务书风险对策）：桥契约成文（`plugins/dsh-shorekeeper-wechat/docs/bridge-contract.md`：/api/health、/api/digest、/api/read、/api/send + 409 wechat_offline + 桥侧白名单二次校验纵深防御），Windows 侧桥按契约实现即可，无需改插件。
- 安全红线全部落进代码：脱敏默认开（SHA-256 稳定别名，跨次调用不漂）；验证码/转账类整条隐藏只提示（词表含「转了 500」类口语）；发送三重闸门（总闸默认关 → 白名单精确匹配硬拒 → host 审批 ⏸ T1）；拟发内容同样过红线。
- 验证：`tsc --noEmit` 零错误；vitest 15/15（safety 纯函数 6 条 + mock 桥全链路 9 条：脱敏开关、红线隐藏、总闸、白名单、桥断降级）。
- ⏸ 待办：桥本体实现（Windows/真机）、两路线 PoC、事件注入设计（待 T1）、渗透真机自测、dsh-mobile-notify 叠装。

### 2026-11-03 · 值班 agent · 桥本体实现（二次补充）
- `bridge/wechat_bridge.py`：stdlib HTTP 面（health 免鉴权 / digest 截断 120 字 / read limit 钳位 1–50 / send 节流 ≥3s + 桥侧白名单 403 纵深防御 + 409 wechat_offline）；适配器接口隔离微信交互。
- `bridge/wcferry_adapter.py`：真身骨架，集成面收窄到 online/account/digest_groups/recent_messages/send 四方法，全部真机 TODO 标注；wcferry 不可导入时明确报错不静默。
- `bridge/tests/test_bridge.py` 12 条全绿（health/digest/401/409/钳位/白名单 403/节流时长/坏体校验）；部署 README（锁版本/NSSM/同源白名单）。
- ⏸ 剩余：wcferry 四方法真机填实（Windows + 微信 3.9.11.25）、两路线 PoC、事件注入、渗透自测。
- 2026-11-04（W3 对齐）：分支 T6-wechat 已合入 main（4dade16）；18:30/18:33 定案：微信入口改个人微信扫码（dsh-plugin-weixin@1.4.3 已装 web profile 并打通），自写桥归档不再装机；真机验收并入 W5。
