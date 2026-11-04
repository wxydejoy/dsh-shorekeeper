# T4 · dsh-keeper-voice —— 克隆音色桥

```
状态: review（插件与客户端完工已合 main；语音链路联调=W9 待 keeper-tts 拉起） · owner: 值班 agent · 开始于: 2026-11-03 · 预估: 10–14 agent 小时 · 前置: T1（接入面确认）+ T3（人格就位后联调）
分支: T4-keeper-voice    （内容可与 T2 并行，联调依赖 T3）
```

## 目标

守岸人开口必须是她的声音：把自有 Qwen3-TTS 克隆服务（`:18100`，独立进程保留——用户拍板「语音大模型用独立程序」）注册为 dsh-voice-mode / dsh-tts 的 TTS provider，打通「说话中被打断立即停」的闭环，落地唤醒词链路。

## 背景

keeper-tts 是 Python 独立进程（`reference/tts/server.py` 快照），本任务在 keeper-tts 侧加 OpenAI 兼容端点，插件侧做 provider 注册与打断桥。打断时序对照岸亭 docs/companion.md：边写边念、打断停播、反问自动再听。

> **T1 前置结论已出（2026-11-03，D13）**：dsh-voice-mode 0.7.34 的 `ttsEngine` 为封闭枚举 `edge|vits|kokoro`（z.union 源码实锤），**无自定义/OpenAI 兼容 TTS provider 扩展点**。阶段一的问题已有答案——「注册为 voice-mode provider」此路不通。可行路线二选一：① fork voice-mode 加自定义引擎（保留其 STT/VAD/字幕/唤醒词全栈）；② 全量自写语音插件（STT/打断/字幕自己来，可参考 voice-mode 实现）。voice-mode 其余能力（流式 ASR、Silero VAD 帧级 barge-in、回声门控、让位语义）质量很高，倾向 ①。阶段一剩余工作：确认 fork 的维护成本与 voice-mode 更新跟进策略。

## 步骤

### 阶段一：接入面确认（2h）
- [x] 读 voice-mode 与 dsh-tts 源码：自定义 provider / openai-compatible 端点的扩展点深度（装包实测 `dsh-voice-mode@0.7.34`、`@goodandready/dsh-tts@0.4.37`）
- [x] 决策记录：接哪家、怎么接（`plugins/dsh-keeper-voice/docs/decisions-voice-provider.md`：主选 dsh-tts `custom` provider 纯配置接线；voice-mode 朗读引擎封闭三选一、无自定义口，不改它，两件叠装分工；不需要「全量自写」预案）

### 阶段二：keeper-tts 改造（3–4h）
- [x] 加 OpenAI 兼容 `POST /v1/audio/speech`（wav/pcm 整段返回；**未做 chunk 流式**——引擎在非本地播放路径本就整段合成，首包延迟按风险对策走插件侧分句直通，见验收记录）
- [x] 加 `POST /stop` 停播端点（打断用）（服务端本就有 `POST /v1/stop`——generation 计数线程安全，`/v1/audio/speech` 合成中被打断会以 `502 stopped` 收场，无需新增）
- [ ] 8bit 情绪 tag / 语速参数透传（语速 ✅ 路由层钳位 0.7–1.5 透传；8bit 情绪 tag → 拓展区，⏸）
- [x] LaunchAgent 自启配置不变，端口 `:18100` 不变（未动）

### 阶段三：插件实现（3–4h）
- [x] provider 注册 + 流式分句播放（修正：provider 是 **dsh-tts 的 custom provider 配置接线**，零代码；流式分句/播放/barge-in 由 dsh-tts 播放器承担；本插件出 `keeper.status` / `keeper.voice_test` / `keeper.stop` 三工具，11 条单测全绿）
- [x] `keeper.voice_test` 试听工具
- [x] barge-in 桥：voice-mode 打断事件 → `POST /stop`（第一层 dsh-tts 播放器自带 ✅；第二层 **Z9 已定论：voice-mode 0.7.34 无公开打断钩子，降级为手动停止工具**——keeper.stop 即该层，证据与将来接线条件见 plugins/dsh-keeper-voice/docs/barge-in-decision.md）
- [ ] 字幕联动：speak 时调 T2 的 `k20.caption`（⏸ 待 T1 真机后接 hooks；k20.caption 走 T2 的协议增补提案路由）

### 阶段四：唤醒词决策（2–4h）
- [ ] 对比：安卓端保留「小岸」唤醒→推文本 vs voice-mode 免提模式全接管（对比框架已成文 `docs/decisions-wakeword.md`；实测数据 ⏸ 待 T1 人工项 3）
- [ ] 决策记录 + 实现所选路径（可能涉及 android 端小改，走岸亭仓库另开分支）（⏸ 框架就绪，等实测填空）
- [ ] 打断闭环真机验收（⏸）

## 交付物
- keeper-tts 的 OpenAI 兼容端点（岸亭仓库 PR 或本地补丁 + 安装说明）
- `plugins/dsh-keeper-voice/` 完整实现
- 唤醒词决策记录

## 验收标准
- [ ] dsh 里守岸人用克隆音色说话，音色与 `:18100` 直连一致
- [ ] 说话中喊停，1 秒内真停
- [ ] 唤醒链路按决策落地：喊「小岸」→ 说话 → 她回话出声出字幕
- [ ] 断网/keeper-tts 未启动时优雅降级提示

## 拓展方向 / 未来方向
- 拓展：多音色（值班/低语）；播放速率进设置卡片
- 未来：云端情感 TTS 对比切换；全离线语音（VITS/Kokoro + 本地 STT）

## 风险与对策
| 风险 | 对策 |
|---|---|
| voice-mode 扩展点不满足 | 阶段一就确认；全量自写是预案不是失败 |
| 克隆音色流式合成延迟高 | 分句预合成 + 首句直通；对照岸亭「第一句写出就开始念」优化 |
| 打断时序竞态 | stop 幂等；以岸亭 companion.md 时序为准写集成测试 |

## 验收记录

### 2026-11-03 · 值班 agent · 阶段一/二/三（代码侧）完成
- **keeper-tts 侧**（dock 仓库 `tts-openai-endpoint` 分支 b80bc98）：`POST /v1/audio/speech` 落地——OpenAI 兼容形状（input/voice/speed/response_format），wav/pcm（`wave` 模块剥容器，不假设头长）、路由层语速钳位 0.7–1.5（与 `/v1/speak` 一致）、`allow_play=False` 只回字节不出本机喇叭、`InterruptedError → 502 stopped`（打断复用既有 `/v1/stop` generation 计数）。8 条单测（FakeEngine 鸭子类型，不加载真模型；测试解释器用服务 venv `.venv/bin/python`）。**未做 chunk 流式输出**：引擎非本地播放路径本就整段合成，首句延迟走插件侧分句直通（风险对策既定路线）。
- **插件侧**（本仓库 `T4-keeper-voice` 分支 c3c3cdd）：接入面决策 = dsh-tts `custom` provider（配置接线，profile 片段见决策记录）；`keeper.status` / `keeper.voice_test` / `keeper.stop` 三工具 + mock keeper-tts 单测 11 条全绿；`tsc --noEmit` 零错误。
- **SDK 实测新发现**：`@deepseek-ai/dsh-tools` 把 10 个兄弟包声明为 peer 且 npm legacy 模式不自动装——插件 devDeps 已显式钉全（reproducibility 顺带解决）；`dsh-voice-mode@0.7.34` 拖 0.2.0-rc.2 旧内部，与 0.2.1-rc.5 宿主同装会 ERESOLVE——**T1 兼容矩阵要专测 voice-mode 与 rc.5 的共装**。
- ⏸ 待 T1/真机：barge-in 桥第二层（voice-mode 事件面）、字幕联动 hooks（T2 提案路由）、唤醒词决策（阶段四）、打断闭环真机验收。
- 2026-11-04（W3 对齐）：分支 T4-keeper-voice 已合入 main（192b9a6）；人工项＝W9 音色对比；keeper-tts /health 已绿，OpenAI 兼容端点待 dock W8 合入后补测（W2 冒烟③挂起项）。

### 2026-11-05 · zcode · Z9 agent 侧收尾（分支 fix/z9-voice-bridge）
- **降级三分支单测补齐**（15/15 全绿）：端点 404（错路由 → status 404 归一化 + 工具层优雅降级）、超时（KeeperClientOptions.timeouts 可注入，mock hang 模式 60ms 实测 timeout 分支）、连接拒绝（:9 discard 端口 → network，工具层 degraded 文案）。原先只有「服务不在」一路。
- **barge-in 第二层定论**：voice-mode 0.7.34 无公开打断钩子（inject 纯消费、barge-in 内部闭环、subscribe 仅音频帧广播）——降级为手动停止工具（keeper.stop 已在位），将来上游长出事件面一行接上。决策记录：`plugins/dsh-keeper-voice/docs/barge-in-decision.md`。
- **8bit 情绪 tag**：服务端 speech 只消费 input/voice/speed/response_format/play/play_only，无 emotion 参数位——跳过透传（同决策记录附录）。
- **不做**（留 T4 原任务书）：真机打断闭环、唤醒词链路、字幕联动 hooks（全要真人真机）。
