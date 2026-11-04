# T3 · 守岸人人格工程 —— 角色卡 + 世界书 + skill

```
状态: review（阶段一/二完工已合 main；Z7 回归自动化落地：headless 26/27 条可跑全绿+改卡三处；web 端纪律条款/多轮/真工具层仍待人工跑批） · owner: 值班 agent（ZCode，T1 会话）· 预估: 12–18 agent 小时 · 前置: T1（tavern 选型）
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
- 2026-11-04（W3 对齐）：分支 T3-persona-card 已合入 main（967acb7）；人工项＝人格全量校准；微信侧人格已先以 weixin 自定义模式承载（W4a），tavern 全量卡待 B4 解冻。

### 2026-11-05 · zcode · Z7 回归自动化（分支 fix/z7-persona-regression）
- **执行器**：`scripts/persona-regression.mjs`——headless 一枪逐条喂，三类断言（control 不剧情化 / persona 称呼声线 / leak 零脚手架）+ 全局红线（无感叹号、无 `<weixin_`、无工具记号）。剧本机器可读版：`content/shorekeeper-card/regression/scenarios.json`（27 条=REGRESSION.md 镜像 + Z7 补充 6 条；打断连发两条为 web 专属）。
- **关键破解**：headless 的 persona 注入点是 `system-prompt.personaPrefix`（--dump-config 实证）——hl/T3 时代的 `- id: persona` 覆盖**从未生效**（目标行不存在，id 覆盖静默无效），此前 headless 的人格响应是模型裸即兴。执行器直接从仓库 `character.json`+`worldbook.json` **程序化合成 tavern 等价注入**（常驻条款全量+关键词触发按条命中，JSON 形态 YAML 避开 T3 的缩进坑；{{char}}/{{user}} 展开为实名）——回归测的是卡与书的当前真身，改卡下一轮立即生效。
- **回归 profile**：`shorekeeper-reg`（headless 模板 + zhipu glm-4.5-flash 生产同路由 + desk-mi/glass-weather/tavern；tavern 2.7.26/2.7.27 均因 headless 无 webServer 而 pending——卡注入由执行器承担，插件面板层仍归 web）。
- **全量结果**：headless 可跑 26 条全绿（跳过 1 条 web 专属）。过程发现并修复：断言 3 处伪失败（多行回复 `.` 不过行、中文数字钟点、断言对打包语义的误解）；glm-4.5-flash 两处真实漂移已按「改卡不改剧本」收口——①求夸场景进了夸赞模式 → 卡补「你说件事，我照着写」示例；②烦躁场景客服式共情 → 世界书情绪条款补「不说我了解你/令人沮丧这类客服话」；③连问两句 → 问句预算补「问号至多一个」。B6/E23/F24 各遇一次 glm 瞬时抽风（思考原文当回复/进程失败），重试即过——与 21:25 journal 观察的「GLM 弱模型偶发泄漏」同源，J2 巡查盯。
- **headless 边界（如实）**：tavern 面板层（世界书 token 预算触发、示例对话 few-shot 的精确注入格式）、feiyu 记忆注入、多轮会话（打断剧本 Z7x1）不在 headless 覆盖内，归 web 端人工跑批；E19 在 headless 无记忆工具时模型会诚实说明记不住（生产有 feiyu 不受影响）。
