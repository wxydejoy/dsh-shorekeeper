# T9 · desk-mi 薄工具层 —— now 时钟 + 米家只读/受控工具

```
状态: doing · owner: 值班 agent（ZCode，T1 会话）· 预估: 4–6 agent 小时 · 前置: T1（D12 米家结论）
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
- [ ] 真机验收：温度计真读数（已验 25.4°C/58%）；控灯一次（需漂泊者当场点头）

## 验收标准
- [ ] 会话里「现在几点」「屋里多少度」都由工具确定性回答
- [ ] `desk_mi_light` 在 controlEnabled=false 时被拒且文案说明原因
- [ ] 拔掉 auth.json 所有工具优雅降级不崩

## 风险与对策
| 风险 | 对策 |
|---|---|
| 米家写入走红线 | 控制工具默认关 + 闸门文案；开闸需漂泊者明确点头（记录进 T1 验收记录） |
| mijiaAPI 会话过期 | 桥复用 exit-code 契约（3/4/5），工具端翻译成人话 |

## 验收记录
- 2026-11-03：真机只读通过——`py/mi_bridge.py list` 22 台；`state --did blt.3.1mc438kgkcg00` → 25.4°C/58%。单元 9/9 绿（tsc strict 无告警）。
