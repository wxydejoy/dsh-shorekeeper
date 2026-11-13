# 微信接入路线选型 v3 · 全面重审（调研报告）

> 2026-11-14 · **调研完成，未拍板未实施**。起因：漂泊者提出「接入个人微信，找合适途径」，叠加现桥 11-13 23:04 起失聪。
> 取代 [decisions-wechat-route-v2.md](decisions-wechat-route-v2.md) 的通道对比部分；v1（git 历史 318218a，真账号 hook 路线）的部分结论经 2026-11 现状校验后**重新有效**。
> 只做选型，修活/装件/换绑等动作另开任务。

---

## 0. 一句话结论

**iLink Bot API（现桥所在线）2026-03 起已被腾讯官方化**（微信客户端 ClawBot 插件 + `Tencent/openclaw-weixin` 官方维护），是「个人微信对话入口」的正解且风险最低。建议：**主路线不变，先修活**；hook 线降级为能力扩展可选项（要群聊/收件箱代读时再议）；企微线只作零风险通知/备用出口。换路线没有收益——瓶颈不在路线在运维。

## 1. 背景校正：v2 文档的两个前提已过时

| v2 判断（2026-11-03） | 2026-11-14 校验 |
|---|---|
| iLink 是「第三方网关，非对外合规接口，灰色，不采用」 | **过时**。2026-03-22 微信客户端上线 **ClawBot 官方插件**，底层即 iLink 协议（`ilinkai.weixin.qq.com`，weixin.qq.com 域）；官方开发文档在 [developers.weixin.qq.com](https://developers.weixin.qq.com/doc/aispeech/knowledge/openapi/Clawbotrelated.html)，GitHub 连接器由 **`Tencent/openclaw-weixin`** 官方组织维护。官方口径「正常使用不封号」，但服务条款 7.2 保留对第三方 AI 接入**限流/拦截/阻断**的权利 |
| 「个人微信无官方接口，合规路线下不可能」 | 同上作废。个人微信 1v1 私聊官方 API 已存在 |

现桥（`dsh-plugin-weixin` → openclaw-weixin channel → iLink）**已经站在官方路线上**——11-03 当时的「接受灰线」实际落点比预期好。

## 2. 现桥健康度快照（2026-11-14 上午实测）

- **链路形态**：dsh web profile 内嵌 openclaw 网关的 `openclaw-weixin/dsh-weixin` channel → iLink Bot API 长轮询（getUpdates，服务端 hold ≤35s，客户端 timeoutMs=35s）。
- **版本**：本地 `dsh-plugin-weixin@1.4.3` + pnpm patch（5 文件：agent-bridge/index/config-remote/session-reader/sessions）；上游已到 **1.5.12**（1.5.x 含消毒逻辑）；仓库躺有未落地的 `profile/patches/draft-dsh-plugin-weixin@1.5.10.patch.md`。
- **bot 对端**：`e7a07db451f1@im.bot`（11-04 扫码，小号侧），sender 白名单一人（`o9cq80yuRn0nE2YUa0WOXfBQD5WA@im.wechat`）。
- **失聪现象**：11-13 17:25 最后一条 accepted message；23:04 起 getUpdates 连续 35s 超时（对照 11-12 全天仅 2 次，异常）；11-14 全天**零日志**。此刻 dsh 有两条 ESTAB 到 `ilinkai.weixin.qq.com`（CNAME aewebpodproxy.weixin.qq.com）——**轮询在跑但零收信**。网关本身可达（curl 200 / 79ms，直连与代理皆通），非本地网络问题。
- **疑似故障类**：**残留绑定 / 服务端下行路由失效**（[openclaw-weixin#268](https://github.com/Tencent/openclaw-weixin/issues/268) 一类：消息从未送达，用户侧重装/换号/干净重绑均无效，需微信开放社区发帖请官方清绑定缓存）。另一类已知坑：一个微信号残留绑定旧 bot 后报「暂不支持连接多个 OpenClaw」。
- **验证手法（修活第一步）**：给 bot 发一条消息 → 看 `~/.dsh/weixin/logs/openclaw-*.log` 是否出现 accepted；不发不看，死活没法定性。

## 3. 候选路线盘点（2026-11-14 校验）

### A. iLink Bot API / ClawBot（现桥）——官方个人微信 1v1
- **能力**：1v1 私聊收发；媒体全支持（图片/语音/文件/视频，媒体走 AES-128-ECB + 预签名 URL）；`group_id` 字段存在但群聊**疑似需额外权限、未确证开放**；无历史消息 API（只有 get_updates_buf 游标）；`context_token` 必须原样回传。
- **风险**：官方背书不封号；但生态年轻（2026-03 上线，3 月底「龙虾只活 2 天」生态断裂事件已发生过一次），7.2 条款可随时限流；残留绑定类故障用户侧无解。
- **运维**：零机器依赖（Mac 上随 dsh 跑）；掉线即轮询超时，重扫/社区清绑定两级恢复。
- **与 dsh 对接**：现成（dsh-plugin-weixin 全家桶三选一：`dsh-plugin-weixin@1.5.12` / `dsh-wechat@0.16.2`（更新最勤，11-09）/ `dsh-wechat-plugin@0.47.0`（停滞））。

### B. Windows hook（wcferry / wxhelper / puppet-xp）——能力天花板，风险天花板
- **能力**：个人微信收发全量 + 群聊 + **读收件箱**（v1 的原初需求「她知道你微信里发生了什么」只有这条线能做到）。
- **现状**：wcferry 锁微信 **3.9.12.17**（64 位 Win），**无 4.0 适配公开版**；维护状态说法不一（「因不可抗力停止维护」vs 活跃，2026-07 仍有提交）；2025-04 封号风暴实测风险真实。
- **依赖**：Windows 挂机——**wrobot（10.14.14.170）在位**，v1 当初主选它正因为这台机器；版本锁死运维（禁升级、适配空窗断联）。
- **判**：**默认不启动**。仅当「群聊/收件箱代读」被重新确认为硬需求时再议，且必须重签 v1 的风险签字区（挂小号、只读低频起步）。

### C. 协议类（padlocal iPad 协议付费 / Mac 协议社区实现 / web 协议）
- web 协议：2017 起大部分账号无法登录，废。
- padlocal：付费 token，风控加强下非官方协议固有风险；padplus 2020 年已下线。
- **判**：**不采用**。能力不比 A 强、风险比 A 高、还收费——没有存在理由。

### D. 企业微信智能机器人（合规平行 IM）——不是个人微信，但零风险
- **现状**：个人可注册未验证组织；未认证企业 API 模式机器人可直接用 IP 回调（[openclawchina 指南](https://openclawchina.com/guides/wecom-ai-bot)）；**但官方机器人只覆盖企微内部成员/群，碰不到个人微信**。
- **判**：**只作备用/通知出口**（`dsh-wecom-bot@1.2.2` 现成，无 peer 冲突）。对话主入口不换到这——那等于换个 IM，不是「接入个人微信」。

### E. 只发通知（Server酱 / WxPusher / 企微群机器人 webhook）
- 只发不收。keeper-watch 的 notify 桥已在用同类思路。作为补充通道可随时加，不构成路线。

### F. 公众号客服消息 / 微信客服 API
- 服务号需企业主体、客服消息 48h 互动窗口。维持 v2 结论：不采用。

## 4. 对比总表

| | A. iLink（现桥） | B. Windows hook | C. padlocal 等 | D. 企微智能机器人 |
|---|---|---|---|---|
| 个人微信 1v1 收发 | ✅ 官方 | ✅ | ✅ | ❌（另一个 IM） |
| 群聊 | ⚠️ 字段在、开放未确证 | ✅ | ✅ | ✅（仅企微群） |
| 读收件箱/代读 | ❌ | ✅ | ❌ | ❌ |
| 媒体（图/语音/文件） | ✅ 官方支持 | 部分 | 部分 | ✅ |
| 合规/封号风险 | 低（官方，7.2 条款兜底） | 高（hook 检测+封号风暴实录） | 中高（非官方协议） | 零 |
| 版本锁定运维 | 无 | 锁 3.9.12.17，禁升级 | token 依赖 | 无 |
| 机器依赖 | 无（Mac 随 dsh） | wrobot 挂机 | 网关 | 无 |
| 生态活跃 | 腾讯官方维护，年轻 | 维护存疑 | 收费+风控收紧 | 官方 |
| 当前阻塞 | **失聪待修活**（§2） | 无 4.0 适配 | 付费 | 无主体（个人可注册） |

## 5. 推荐

1. **主线留 A，先修活**：实测发消息 → 无效则重扫码 → 再无效走微信开放社区发帖清残留绑定（用户侧无解的那类）。修活同时评估升级 `dsh-plugin-weixin` 1.5.x（消毒逻辑）+ 把 draft patch（1.5.10）移植到 1.5.12，或改试 `dsh-wechat@0.16.2`（更新最活跃）——换包前先在小号上体检。
2. **B 不启动**，写成预案：触发条件=「群聊 @ 她」或「收件箱代读」重新成为硬需求。启动则重签 v1 风险签字区，wrobot 挂机，只挂小号。
3. **D 按需并行**：想要一条「永不失联」的通知/备用入口时装 `dsh-wecom-bot`（半小时级成本），不作为对话主入口。
4. **C/E/F 不采用**。

## 6. 待拍板（漂泊者）

| # | 事项 | 建议口径 |
|---|---|---|
| 1 | 主力号要不要接上来（v1 红线是只挂小号） | 官方化后风险已大降，但 ClawBot 对「一号多绑/多 OpenClaw」有限制（残留绑定故障多发于此）；**建议先小号稳定跑 1–2 周再议**，届时实测一号能否双挂 |
| 2 | 修活是否现在做 | 建议现在：发消息实测 → 重扫 → 社区清绑定，三级递进（另开任务） |
| 3 | 插件是否升 1.5.12 | 建议升（消毒逻辑），但需重做 patch；或先试 dsh-wechat@0.16.2 平行体检 |

## 7. 对 v2 文档的作废/保留清单

- 作废：§1 对比表「iLink 灰色不采用」行、§2 三个人微信插件「❌ 灰色」判、§0「合规路线里不存在读个人微信」的表述（改：「收件箱代读仍不可能，但 1v1 对话入口已官方合规」）。
- 保留：企微路线全部分析（D 的依据没变）；「不碰真账号 hook」红线（B 未重新启动前仍有效）；D1/D3 等审批红线。

## 8. 参考资料

- [clawbot 相关接口 · 微信开放文档](https://developers.weixin.qq.com/doc/aispeech/knowledge/openapi/Clawbotrelated.html)（官方）
- [Tencent/openclaw-weixin · weixin-bot-api.md 技术解析](https://github.com/hao-ji-xing/openclaw-weixin/blob/main/weixin-bot-api.md)（iLink 协议细节/限制）
- [openclaw-weixin#268 · 消息从未送达（残留绑定类故障）](https://github.com/Tencent/openclaw-weixin/issues/268)
- [微信开放社区 · ClawBot 解绑/残留绑定置顶帖](https://developers.weixin.qq.com/community/)（用户侧无解，需官方清缓存）
- [InfoQ · 微信龙虾只活 2 天（2026-03 生态断裂事件）](https://www.infoq.cn/news/TMy3gaCUrUBemME0wWaV)
- [IT之家 · 微信新增 ClawBot 官方插件](https://www.ithome.com/0/931/382.htm)
- [WeChatFerry 版本兼容（锁 3.9.12.17）](https://wcferry.netlify.app) · [2025-04 封号风暴数据](https://developer.cloud.tencent.com/article/2474159)
- [wechaty puppet 列表](https://wechaty.js.org/docs/puppet-providers) · [puppet-padlocal](https://github.com/wechaty/puppet-padlocal)
- [企业微信 AI 机器人搭建指南（未认证主体/IP 回调）](https://openclawchina.com/guides/wecom-ai-bot) · [企微 API 模式机器人官方文档](https://developer.work.weixin.qq.com/document/path/101468)
- [腾讯云 · 官方机器人无法对接个人微信](https://cloud.tencent.com/developer/article/2684021)
