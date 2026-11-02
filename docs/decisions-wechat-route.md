# T6 决策记录 · 微信接入路线选型（草案，待漂泊者确认）

> 2026-11-03 · 调研完成 · 结论就绪，**未拍板**——封号风险必须由漂泊者本人签字接受后才动真账号。

## 0. 需求回顾

守岸人知道**漂泊者本人的个人微信**里发生了什么：新消息摘要进上下文、按需代读、经审批代发。默认只读不发。这意味着「读个人微信收件箱」是硬需求——凡读不到个人微信的路线直接出局。

## 1. 三路线对比

| | ① 企业微信/公众号合规 API | ② wechaty（puppet 生态） | ③ wechatferry/wcferry（Windows hook） |
|---|---|---|---|
| **读个人微信** | ❌ 读不到。只能覆盖企微侧联系人与公众号粉丝互动 | ✅（取决于 puppet） | ✅ 个人微信收发全量 |
| **可用子方案** | 企微自建应用（个人可建未验证企业，能力受限）；公众号客服消息（48h 互动窗口） | web 协议基本废（新号无法扫码）；padplus 已宣布下线；padlocal 商业收费（7 天试用）；donut（Windows 个人微信，收费）；paddle（免费 pad 协议，维护不透明） | wcferry 39.3.3.2，配套微信 3.9.11.25 |
| **风控/封号** | 官方合规，零风险 | hook/逆向类同源风险；web 协议无风险但不可用 | hook 类官方不支持，测试号有封号风险；多次临时封可能升级永久封 |
| **部署形态** | 云端/本机皆可 | donut 需 Windows；padlocal 需网关 | Windows 挂机（**可复用 win.lan 探针机器**） |
| **维护成本** | 低（官方） | padlocal 付费随协议变动；paddle 不透明 | 项目活跃（lich0821/WeChatFerry），但微信升级需等适配、版本锁死 |
| **与 dsh(TS/Node) 集成** | HTTP | Node 原生最好 | Python 客户端 → 桥做独立小服务（HTTP 回调），插件走 HTTP 解耦 |

来源：
- [WeChatFerry（GitHub）](https://github.com/lich0821/WeChatFerry)、[版本兼容 FAQ（腾讯云社区）](https://developer.cloud.tencent.com/article/2474159)、[2025 部署教程（火山引擎）](https://developer.volcengine.com/articles/7535311023759163418)
- [Wechaty puppet 架构演进](https://lijianfei.com/post/wechaty-conversational-rpa-puppet-architecture)、[官方 puppet 列表](https://wechaty.js.org/docs/puppet-providers)、[puppet-padlocal](https://github.com/wechaty/puppet-padlocal)
- [企业微信发送应用消息（官方文档）](https://developer.work.weixin.qq.com/document/path/90236)、[微信客服 API](https://kf.weixin.qq.com/api/doc/path/94291)

## 2. 结论（推荐，待签字）

- **主选：wechatferry**。免费、活跃、个人微信覆盖全量、可复用 win.lan 探针机器挂机；配套把「桥」做成独立小服务，插件与桥 HTTP 解耦（桥崩可重启不丢状态，符合任务书风险对策）。
- **硬约束**：微信客户端必须锁 3.9.11.25（禁用官网最新版/4.0），版本不匹配是最常见故障；微信大版本升级后适配空窗期会断联——桥设计成可重连、插件侧优雅降级。
- **备选（Plan B）：wechaty-puppet-donut 或 padlocal**（付费）。wcferry 因微信升级长期失效时切换。
- **否决：企微/公众号合规 API**。读不到个人微信收件箱，与本任务目标错位（企微机器人适合 outward 通知场景，不是本任务）。

## 3. 风险签字区（漂泊者填完才许接真账号）

- [ ] 挂机用主号还是小号：______
- [ ] 接受的封号风险等级（只读低频能否接受临时封号）：______
- [ ] 发送白名单初始名单：______
- [ ] 默认只读不发的红线确认：______

## 4. 对任务书的影响

- 阶段一「各写 200 行内 PoC」→ 只对 wcferry + wechaty-donut 两条做（企微路线已否决）；PoC 需 Windows 真机 ⏸ 待真机。
- 阶段二「消息桥」→ 归一化事件接口按「桥无关」设计：插件只认 `wechat.brief` 事件（会话/发送人/类型/摘要），wcferry 适配器是桥的第一个实现。
- 部署文档：出《Windows 挂机部署手册》（微信锁版本、桥常驻、win.lan 网络打通）。
