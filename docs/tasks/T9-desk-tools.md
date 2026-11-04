# T9 · desk-mi 薄工具层 —— now 时钟 + 米家只读/受控工具

```
状态: done（desk-mi 四工具交付、B2 真控已验、check-all 全绿、已进 web profile） · owner: 值班 agent（ZCode，T1 会话）· 预估: 4–6 agent 小时 · 前置: T1（D12 米家结论）
分支: T9-desk-tools
```

## 目标

补上 T1/T3 实测暴露的两个工具缺口（refactor-map 原挂在 T2/T7 承接，两任务均已合入未含此项，故立此小任务）：

1. **时钟**：dsh 运行时上下文只有日期没有时钟，「现在几点」无法确定性报数（T3 校准 L4 实锤）→ `desk_now` 工具。
2. **米家只读面**：dsh-mijia-sidebar 无 agent 工具面（D12），「屋里多少度」无可调工具 → `desk_mi_list` / `desk_mi_sensor`（只读）；控灯 `desk_mi_light` 按红线做**默认关闭 + 配置闸门**。

## 步骤

- [x] 插件骨架：`plugins/dsh-shorekeeper-desk-mi/`（TS strict + vitest，对齐 k20 范式）
- [x] Python 桥 `py/mi_bridge.py`：list / state / set 三命令，JSON 单文档契约（退出码语义沿用 dsh-mijia-sidebar state.py，MIT）
- [x] `desk_now`：本地时钟（ISO + 中文口语两个字段）
- [x] `desk_mi_list`：设备列表（只读）
- [x] `desk_mi_sensor`：指定/默认温湿度计读数（只读）
- [x] `desk_mi_light`：开关/亮度（`controlEnabled` 默认 false，关时一律拒绝）
- [x] vitest：闸门/降级/读数摘要/离线拒绝/越界拒绝，9 条全绿
- [x] 真机验收：温度计真读数（25.4°C/58%）；控灯一次（2026-11-04 20:45 漂泊者点头开闸，21:21 微信「再试一下」→ desk_mi_light 真关台灯，米家回「台灯 已关闭」）

## 验收标准
- [x] 会话里「现在几点」「屋里多少度」都由工具确定性回答（证据：本文件验收记录 2026-11-03 端到端——desk_now「早上 6:52，周二」、desk_mi_sensor「不冷不潮，挺舒服。」25.4°C/58%；微信侧 2026-11-04 21:21 控灯同链路实证）
- [x] `desk_mi_light` 在 controlEnabled=false 时被拒且文案说明原因（证据：同上端到端——「需要你把米家插件的写入控制打开……开灯得你手动按一下」；单测 `desk_mi_light 闸门（红线）› controlEnabled=false：一律拒绝且不动桥` tools.test.ts:90）
- [x] 拔掉 auth.json 所有工具优雅降级不崩（单测已覆盖，引用测试名不重测：`desk_mi_sensor › 桥失败：降级不抛` tools.test.ts:79，mock `code:'auth-expired'`；未知传感器名同有降级用例 tools.test.ts:72）

## 风险与对策
| 风险 | 对策 |
|---|---|
| 米家写入走红线 | 控制工具默认关 + 闸门文案；开闸需漂泊者明确点头（记录进 T1 验收记录） |
| mijiaAPI 会话过期 | 桥复用 exit-code 契约（3/4/5），工具端翻译成人话 |

## 验收记录
- 2026-11-03：真机只读通过——`py/mi_bridge.py list` 22 台；`state --did blt.3.1mc438kgkcg00` → 25.4°C/58%。单元 9/9 绿（tsc strict 无告警）。
- 2026-11-03 端到端（shorekeeper-hl headless，工具注册后）：
  - `desk_now`：「早上 6:52，周二（2026 年 11 月 3 日）」——**时钟缺口闭合**（T3 校准 L4 的答案）
  - `desk_mi_sensor`：「不冷不潮，挺舒服。」（工具返回 25.4°C/58% 后人设化表达）
  - `desk_mi_light` 闸门：「需要你把米家插件的写入控制打开……开灯得你手动按一下」——**红线行为端到端成立**
- **踩坑两枚（对 T8 生效）**：① 自写 TS 插件 file: 链接进 profile 前必须先在插件目录 `npm install`（isolated linker 从插件自身路径解析，无本地 node_modules 即 failed to import 且 boot 静默降级）；② 运行时依赖必须在 `dependencies`（file: 依赖不装 devDeps）。已写进插件 README。
- 待办：控灯真机一次（等漂泊者点头开闸）。
- 2026-11-04（W3 对齐）：分支 T9-desk-tools 已合入 main（c5ba921）；控灯真机已由 B2 闭合（mijiaAPI 关/开各一次）；W1 将 desk-mi 纳入 check-all（12 项全绿），W2 迁移进 web profile 且米家只读冒烟过（21 台 + 卧室 24.8°C/62%）——**本任务书收口 done**。
