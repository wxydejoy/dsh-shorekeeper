# T8 · 集成、发布与端到端验收

```
状态: review（install.sh 钉版清单已填实并随实况修正——dsh-plugin-weixin 入厂、自写 wechat 撤出、消毒 patch 入厂流程；README 快速开始 30 分钟版成稿；全新目录演练与十条场景留人工） · owner: 值班 agent · 预估: 10–12 agent 小时 · 前置: T2–T7 全部完成
分支: T8-integrate
```

## 目标

新机器 30 分钟内从零到「完整亭子」；十条生活场景端到端全绿；岸亭 v1.0 发布。

## 步骤

### 阶段一：一键安装（3–4h）
- [x] `profile/install.sh`：装 dsh（钉版本）→ 装生态插件清单 → 装 4 个自写插件 → 写入 cordis.patch.yml 默认值（**2026-11-04 钉版清单已填实**：T1 清单 10 件 + dsh-plugin-weixin@1.4.3（微信入口，2026-11-04 21:21 全链路实证）；自写 wechat 按 v2 决策撤出链接清单；新增消毒 pnpm patch 应用步骤（profile/patches/dsh-plugin-weixin@1.4.3.patch，防中毒循环复发）；~~占位符~~ 已清）
- [ ] 全新目录演练安装（模拟新机器），问题回写脚本（⏸ 真机演练留人工）
- [x] README「快速开始」补 30 分钟装机流程（草稿成文：根 README「快速开始（30 分钟目标）」段；演练校准留人工）

### 阶段二：端到端剧本（4–5h）
十条场景逐条真机走查，每条留证据（草案成文 `docs/e2e-scenarios.md`，链路与判据已映射到各任务产出）：
- [ ] ① 起床问天气（她答 + 推屏）（⏸ 真机）
- [ ] ② 「把台灯调暗一点」（mihome）（⏸）
- [ ] ③ 闲聊陪跑（人格一致性抽查 5 条）（⏸ T3）
- [ ] ④ 「放点白噪音/来首歌」（music）（⏸）
- [ ] ⑤ 「我看到 217 页了」（reading）（⏸）
- [ ] ⑥ 微信进来一条重要消息（摘要 + 提示）（⏸ T6 桥真机）
- [ ] ⑦ 睡前仪式（日记引导 → 周报 → 听书 → 晚安）（⏸ T3/T5）
- [ ] ⑧ 「晚安，帮我熄屏」（k20.lock 审批）（⏸）
- [ ] ⑨ 全链路打断（说话中喊停立即停）（⏸ T4 真机）
- [ ] ⑩ 断网降级（Hub 停机，插件不崩）（⏸ 降级路径已单测覆盖）

### 阶段三：发布（3h）
- [x] 兼容矩阵：当前 dsh 版本 × 4 自写插件，写入 README（框架落盘 `docs/compat-matrix.md`：版本钉 + 已实测行 + 两个 ❌ 已知缺口 + 升级流程）
- [ ] 打 tag：`M1` `M2` `v1.0`；GitHub Release + 发布说明（⏸ 全绿后）
- [ ] 决策记录：是否提交 DSH Plugin Hub（脱敏 + 英文 README 的工时另估）（⏸）
- [ ] 岸亭仓库 v1.0 发布说明联动（shoreting 版本号语义协调）（⏸）

## 交付物
- `profile/install.sh` + 快速开始文档
- 十条场景验收记录
- v1.0 Release

## 验收标准
- [ ] 新机器 30 分钟装机达标
- [ ] 十条场景全绿
- [ ] Release 发布且可从零复装

## 拓展方向 / 未来方向
- 拓展：console Vite web 演化 DSH 仪表盘卡片
- 未来：见 docs/vision.md（主动值班、e-ink、插件上架）

## 风险与对策
| 风险 | 对策 |
|---|---|
| 生态插件更新破坏一键安装 | 清单钉 commit/版本；install.sh 按清单锁死 |
| 场景⑨打断时序不稳 | T4 已有集成测试；此处只回归不新调 |

## 验收记录

### 2026-11-03 · 值班 agent · 阶段一骨架 + 阶段三矩阵框架
- `profile/install.sh`：dsh 钉 0.2.1-rc.5 → profile 建立（--from-default-profile web）→ 自写 4 插件 file: 链接 → cordis.patch.yml 写入（带 OVERWRITE_PATCH 保护）；生态插件段为显式 TODO 占位，注明「以 T1《替代决策清单》钉版本后解锁」。
- `profile/cordis.patch.yml` 草案：四自写插件全字段（安全默认值：wechat.sendEnabled=false / k20.lockEnabled=false）+ dsh-tts custom provider 接线注释段（T4 决策）。
- `docs/e2e-scenarios.md`：十条场景（与任务书 ①–⑩ 一一对应）× 期望链路 × 通过判据 + 三条兜底走查 + 走查记录区。
- `docs/compat-matrix.md`：版本钉死表 + 兼容矩阵（✅ 已实测：defineTool DSL / tools.register / Schemastery；⚠️ voice-mode 共装；❌ 两个已知缺口：dispose 事件、installSection——均来自 T2/T4 的 SDK 实测）+ 四步升级流程。
- ⏸ 全部真机项等待 T1《替代决策清单》落锤；本任务的真机走查零虚标。
- 2026-11-04（W3 对齐）：分支 T8-integrate 已合入 main（73f2c88）；人工项＝全新目录演练 + 十条场景；W2 踩坑已回灌 install.sh（file:→link:、TS 参数属性禁令）。

### 2026-11-04 · zcode · 阶段一收口（Z11 文档收口）
- install.sh 生态清单从「占位」转「填实」并随实况修正三处：①生态清单补 `dsh-plugin-weixin@1.4.3`（现役微信入口，T6 v2 定案 + 21:21 实证）；②自写插件链接清单撤出 `dsh-shorekeeper-wechat`（v2 决策归档不装机）；③新增 pnpm patch 应用步骤——把 `profile/patches/dsh-plugin-weixin@1.4.3.patch` 拷进 profile patches 并登记 pnpm-workspace.yaml（主动消息消毒，防中毒循环随全新装机复发；同 feiyu@4.0.2 先例）。
- README 快速开始改写为 30 分钟节奏版（0-5 装 / 5-10 链接 / 10-15 配置 / 15-25 凭据 / 25-30 启动冒烟），演练校准留人工。
- 剩余人工：全新目录演练装机、十条 e2e 场景、M1/M2/v1.0 tag。
