# T3 · 守岸人人格工程 —— 角色卡 + 世界书 + skill

```
状态: doing（阶段一/二完工+3条冒烟；27条全量跑批与web端调优待续）· owner: 值班 agent（ZCode，T1 会话）· 预估: 12–18 agent 小时 · 前置: T1（tavern 选型）
分支: T3-persona-card    （可与 T2 并行）
```

## 目标

persona.py / companion_flow.py / intents.py / companion_desk.py 的灵魂全部转写为 Tavern 生态资产：角色卡、世界书、多模式预设、周报/仪式 skill。人格一致性通过回归剧本校准——**零代码迁移**。

## 背景

守岸人的既定事实：第一人称（守岸人对漂泊者），官方口径「这个称呼就很好」——⚠️ 此句在两仓库快照（reference/dock_hub 与岸亭仓库）均搜不到，落卡前向漂泊者确认出处（人工对话定下的口径？）。素材在 `reference/dock_hub/`：persona.py（599）、companion_flow.py（902）、intents.py（859）、companion_desk.py（731）、**diary.py（睡前日记引导的对话脚本实证：build_material / diary_messages / impression_messages）**、weekly.py。宿主 dsh-tavern 2.7.26（T1 D14：V2 JSON 卡导入 ✓、预设/世界书/绑定 ✓、headless 组合实测 ✓）。

## 步骤

### 阶段一：素材提炼（3–4h）
- [x] 通读五份底料（persona / companion_flow / intents / companion_desk / diary，周报另加 weekly.py），提炼人格要素清单：口吻规则、称呼体系、情绪规则、禁忌话题
- [x] 提炼意图分流策略：控制类意图（灯/屏/媒体/熄屏）路由到工具，陪伴类进剧情语境（intents.py 为词面正则路由：_CONTROL_HINT / _CONTROL_DEVICES / _QUERY_*，查状态与执行分离的规矩一并提炼）
- [x] 提炼生活仪式流程：睡前日记引导（脚本在 diary.py）、周日晚周报（weekly.py + feiyu 档案）、晨间简报的对话脚本
- [x] 每条要素标注出处（xx.py 第几段），防编造

### 阶段二：内容产出（5–7h）
- [x] `content/shorekeeper-card/character.json`：Tavern V2 角色卡（人设、开场白、≥10 条示例对话）
- [x] `content/shorekeeper-card/worldbook.json`：书桌亭世界观、三机设备名录、生活仪式规则、意图分流规则（关键词触发省 token）
- [x] 多模式预设：值班（默认）/ 晚安 / 工作陪跑，切会话自动加载（dsh-tavern 预设/绑定管理台已验 ✓ D14；「切会话自动加载」的具体行为开工时对照 T1 验收记录）
- [x] 周报 skill：守岸人从 feiyu-memory 长期记忆回顾本周（读了什么/做了什么/心情，档案 `~/.dsh/feiyu-diary/`），生成周报的流程指令
- [x] 意图分流写入世界书全局常驻条目

### 阶段三：校准（4–7h）
- [ ] 人格回归剧本 ≥20 条：早安/陪聊/查监控/被喊名字/打断/敏感话题/控制类混合句
- [ ] 对照 Hub 原行为逐条校准（有差距改卡不改剧本）
- [ ] 记忆插件接入（T1 已选 **feiyu-memory 4.0.2**，D10：召回逐字 ✓、密钥硬拦 ✓、与 tavern 无冲突 ✓）：写入确认与检索调优
- [ ] 验收记录 + 卡片 git 版本化说明

## 交付物
- `content/shorekeeper-card/`（角色卡 + 世界书 + 3 预设）
- 周报/仪式 skill 文件
- 人格回归剧本与校准记录

## 验收标准
- [ ] 剧本 20 条全部通过（人格一致性 + 意图正确路由）
- [ ] 「小岸」称呼反应与 Hub 版一致
- [ ] 控制类指令不再触发剧情化回复
- [ ] 角色卡可导入导出（可分享的脱敏版另存）

## 拓展方向 / 未来方向
- 拓展：状态栏渲染「值班日志」；情绪多模式自动切换
- 未来：日记 → 长期记忆闭环；角色卡脱敏公开分享

## 风险与对策
| 风险 | 对策 |
|---|---|
| 人格漂移（卡写得美但演不像） | 剧本回归 + 出处标注 + 只改卡不改剧本 |
| 世界书膨胀吃上下文 | 关键词触发为主，常驻条目限 10 条内 |
| tavern 件与 voice-mode 冲突 | 职责已叠装分工（T4 决策：voice-mode 管全双工链路，TTS 面归 dsh-tts custom→keeper-tts）；共装有 ERESOLVE 信号（voice-mode 拖旧内部），T1 兼容矩阵专测 |
| dsh-tavern IAB 冻结 bug（T1 D14 记录） | 两个冻结场景待漂泊者 Chrome 复测定责；开工前先复测，冻结面避开相关操作 |

## 验收记录
（执行时追加）

## 文档审查（2026-11-03 · 值班 agent · 只审不改逻辑）

按 2026-11-03 定的约定对本任务书做了事实核查与修订（当日仓库现状：T1 已到 review 状态、T2/T4/T5/T6/T8 代码产出已合 main）：

1. **素材清单漏 diary.py**——已补。实证：睡前日记引导的对话脚本（build_material / diary_messages / impression_messages）就在 diary.py；「四份底料」改「五份」，weekly.py 在背景里本就列了。
2. **意图分流描述核实**——intents.py 确为词面正则路由（_CONTROL_HINT / _CONTROL_DEVICES / _QUERY_* 系），且「查状态不当进执行器」的规矩值得提炼进世界书条目。原文描述准确，已补机制注记。
3. **「这个称呼就很好」出处存疑**——两仓库快照全搜无此句。保留原文但加 ⚠️ 标注，落卡前向漂泊者确认出处。
4. **记忆选型归属对齐 T1 现状**——T1 已落锤 feiyu-memory 4.0.2（D10），阶段三直接点名；周报数据源写明档案路径。注意：docs/plans/dsh-plugins-v1.md §T3 仍写「记忆选型在本任务」——方案文档滞后于 T1 实况，未代改（方案文档归漂泊者维护）。
5. **宿主风险更新**——dsh-tavern 2.7.26 已由 T1 实测（D14），原「宿主是 T1 选定的 tavern 件」的悬置消除；新增 IAB 冻结 bug 风险行（T1 记录的两个 100% 冻结场景）。
6. **T4 决策回填**——「tavern 件与 voice-mode 冲突」风险行更新为叠装分工事实 + 共装 ERESOLVE 信号（voice-mode@0.7.34 拖 0.2.0-rc.2 旧内部，装包实测）。
7. 未动：目标、交付物、验收标准、预估（12–18h 对照 T2/T4/T5 实测吞吐合理）。
