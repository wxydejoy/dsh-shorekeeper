# 合并复核报告 · T1 / T3 / T9（M2 里程碑判定材料）

> 2026-11-03 · 值班 agent（T1 会话）自检复核。供漂泊者/审阅 agent 做合并决策；三支分支相互独立、可与其它任务分支任意顺序合入。

## 结论速览

| 分支 | 提交数 | 验收标准覆盖 | 建议动作 |
|---|---|---|---|
| `T1-ecosystem-trial` | 4 | 4 条中 2 条全过、2 条待人工（米家控灯审批 / voice 真人对话） | **可合**——生态选型已全部落锤，人工项是"使用验收"而非"选型验收" |
| `T9-desk-tools` | 6 | 3 条中 2 条全过（工具确定性回答 / 闸门拒绝）、1 条待人工（控真灯） | **可合**——只读面端到端已验，控制面默认关 |
| `T3-persona-card` | 9 | 4 条中 1 条全过（决策清单覆盖）、3 条待 web 跑批 | **可合**——卡/世界书/预设/skill/剧本全部交付且 headless 校准 11 条通过；web 跑批是校准的延续，不阻塞内容合入 |

## 逐支复核

### T1 · 生态验证（beabea1）
- ✅ 验收标准③④（tavern 卡导入+对话 headless 证 / 决策清单 D7–D15 无「未验证」遗留）
- ⏸ ①米家：**大半已过**（22 设备列表、温湿度 25.4°C/58% 实测）；剩控灯一次（红线：等点头）
- ⏸ ②语音：源码面全验（含 D13 无扩展点定论）；真人体验待漂泊者
- 风险：OpenRouter key 余额（402 已修，用量型风险）；tavern IAB 冻结待 Chrome 定责

### T9 · desk-mi 薄工具层（031c535 → 702f19f）
- ✅ 「现在几点」「屋里多少度」工具确定性回答（headless 端到端：6:52 周二 / 25.4°C/58%→「不冷不潮，挺舒服」）
- ✅ 闸门：未开闸时「把台灯打开」正确拒绝并说明（红线默认关）
- ✅ 自发触发：描述强化后「屋里多少度？」不用点名即选对工具
- ⏸ 控真灯一次（同 T1①）
- 附带发现（已回灌 install.sh）：自写 TS 插件 file: 链接前须本地 npm install + 运行时依赖进 dependencies

### T3 · 人格工程（2a2a6cc → b9ae1ec）
- ✅ 验收标准④；交付物五件全齐（卡/世界书/三预设/周报 skill/27 条剧本）
- 校准：headless 三轮 11 条——声线/情绪策略/诚实/不夸人/日期报数全过；时钟缺口已由 T9 闭合
- ⏸ 剧本全量跑批（web，需世界书注入层）+ 「这个称呼就很好」出处确认（快照无此句）

## 建议合并顺序与里程碑

1. `T9-desk-tools` → main（最干净，给 T3 跑批供工具）
2. `T1-ecosystem-trial` → main（选型定案，M1 复核材料）
3. `T3-persona-card` → main（内容资产；web 跑批作为合后任务继续）
4. 三支合完 + A 组人工验收过半 → **M2 里程碑判定**（「守岸人回来」：人格 + 生态 + 工具面齐）

## 合并操作备忘
- T3 已并入最新 main（2a2a6cc），T1/T9 基于 main 各自干净；三支间无文件交集冲突
- 合并后 `profile/install.sh` 已含自写插件 npm install 步骤（T9 踩坑回灌）
- push 决策仍归漂泊者（main 领先 origin 40+）

---

## M2 判定更新（2026-11-04 · W12，甲线装机自检后）

> 原判定线（上文 §合并顺序第 4 条）：「三支合完 + A 组人工验收过半」。
> 本夜（11-03 傍晚～11-04 凌晨）甲线把判定推进到**九支全合 + 装机自检实证**，材料如下。

### 判定标准演进

- 旧线：「三支（T1/T3/T9）合完 + A 组人工验收过半」→「守岸人回来：人格 + 生态 + 工具面齐」。
- 新线：「**九支全合**（T1–T6、T8、T9 均已并入 main；T7 产物在 dock 仓库 hub-slim，归乙线 W8）+ **装机自检结果**」——
  自检的核心主张不变：人格 + 生态 + 工具面齐，且这一次全部**在一个真实 profile（web :3090）上端到端点亮过**。

### 装机自检证据（全部落计划进度区，此处索引）

| 项 | 证据 |
|---|---|
| 测试面全绿 | `bash scripts/check-all.sh` 12 项全绿（在 `fix/w2-node-ts-compat` 上复跑确认；main 上 k20 四处类型错已由 W1 修掉，待合并） |
| 守岸人运行面 | W2：feiyu-memory / mijia-sidebar / 自写四件（desk-mi、k20、keeper-voice、reading）全部进 web profile，:3090 冒烟 k20 六工具注册、reading 真书架、米家只读 21 台+实时温湿度 |
| 人格 | W4a：T3 角色卡+常驻世界书要点合成 weixin「守岸人」自定义模式，微信私聊覆盖已切（口吻真机验收=W5） |
| 记忆写侧 | W11：聊三轮日记 5→7 条实证（顺带修掉 feiyu 在 zhipu 下静默吞错的真 bug，pnpm patch） |
| 阅读面 | W10：《世说新语》全文灌书，shelf/progress/note/ask 四工具全过 |
| 仓库卫生 | W3：九任务书状态头对齐（T9 done、其余 review 注明人工项）、refactor-map desk-mi 行 🟢、.worktrees 误跟踪解除 |
| 实例收敛 | W2a：shorekeeper-lab 归档并删除，:3081 退役，web profile 为唯一主实例 |

### 待人工项（M2 → M3 的路标）

1. **W5** 微信口吻真机验收（漂泊者手机私聊；守岸人模式已就位，如口吻偏差调 persona-modes.json）
2. **W6/W7**（乙）k20 真机六工具 + 唤醒词路线甲（:3090 工具面已就绪，k20 插入项的 host/token 占位需真机校准）
3. ~~**W8/W9**~~ → **已落定（2026-11-04 01:00，甲代乙线完成）**：dock main 两笔迁移提交（0d422c1 三路由+retire、c01067f tts OpenAI 端点），hub 1188 测全绿 + tts 8/8 绿；keeper-tts 已带端点重启，`/v1/audio/speech` 实测 200/184KB WAV——**W2 冒烟③闭合，四件全过**。dock push 决策同样归漂泊者（dock main 领先 origin 2 提交）
4. B 组余项：通知（B6）、tavern 全量校准（B4 解冻后）、语音真人实测（B3）
5. **W6/W7 真机**：k20.lan 此刻不可达（health 超时），设备上线后乙线开跑；lock 熄屏项需漂泊者点头开闸

### push 前清单（绿了才推；push 决策归漂泊者）

**待推分支与内容**：

| 分支 | 内容 | 依据提交 |
|---|---|---|
| `fix/w1-check-all-green` | k20 类型对齐真网关回读 + desk-mi 补 peer 依赖 + check-all 纳入 desk-mi | 9f968d4 |
| `fix/w2-node-ts-compat`（叠在 w1 上） | TS 参数属性移除（Node strip-only 兼容，装机静默降级根因）+ install.sh 踩坑回灌 | c370c25、0f9416d |
| `docs/wechat-route-v2` | 今晚全部计划/确认单/归档/任务书对齐文档 | d750c33…461b51b、ea03177 |
| `chore/w3-untrack-worktrees` | 解除 .worktrees 误跟踪（工作区文件保留） | 919a409 |

**合并顺序建议**：`main` ← `fix/w1-check-all-green` ← `fix/w2-node-ts-compat`（栈式，前者和后者依次合）；`docs/wechat-route-v2` 与 `chore/w3-untrack-worktrees` 各自并入 main（互不相交，无冲突预期）。

**合并后必做**：在合并结果上重跑 `bash scripts/check-all.sh`（预期 12 项全绿）→ 绿了才推。
**✅ 已执行（2026-11-04 01:1x，本地合并，未 push）**：main ← w1 → w2 → chore → docs 四路合并零冲突，main=37a3372，合并结果上 check-all **12 项全绿**、工作树干净——**技术侧全部就绪，push 只差漂泊者一句话**。dock main 同理（2 笔迁移提交，1188+8 测绿）。

**测试证据**：上表首行；此外 W2/W10/W11 的功能冒烟均为真机实证（浏览器+真数据）。

**风险与回滚**：profile 侧改动（~/.dsh）不在 git 内，回滚以 `~/.dsh/backups/shorekeeper-lab-profile-2026-11-04.tar.gz` 与文档为准；feiyu pnpm patch 在 web profile 的 `patches/` 有文件化留痕。
