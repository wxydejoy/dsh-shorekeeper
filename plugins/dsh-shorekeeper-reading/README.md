# dsh-shorekeeper-reading

> 状态：**实现中（T5）——阶段一/二完成（导出器 27 测 + 插件 10 测全绿）；听书/字幕/记忆联动 ⏸** · 任务文档：[docs/tasks/T5-reading.md](../../docs/tasks/T5-reading.md)

守岸人的书架：岸亭 `books.py` 的阅读能力在 dsh 里重生——书架管理、阅读进度、听书、摘抄。

## 实现说明（2026-11-03 · 阶段一/二）

- 数据迁移：`migration/export_books.py`（写前备份、幂等、源只读、未识别字段全量进报告）+ 逆向笔记 `migration/books-format.md`；数据落 `$DSH_HOME/data/reading`
- 工具面：`reading.shelf`（状态过滤）、`reading.progress`（页码/百分比/章节，状态机联动）、`reading.note`（摘抄/随想，可关联书与章节）、`reading.ask`（本地检索）
- ⏸：真实数据回归（迁移报告抽查）、听书（T4 keeper-voice 联调）、睡前字幕（T2 提案路由）、记忆联动（T3 选型）

## 计划工具面

| 工具 | 职责 | 权限 |
|---|---|---|
| `reading.shelf` | 列书架：在读/读完/想读、进度、最近阅读 | read-only |
| `reading.progress` | 更新进度（页码/百分比/章节），守岸人可代记「看到 217 页了」 | read-only |
| `reading.note` | 摘抄与随想落库，可关联书与章节 | read-only |
| `reading.ask` | 对读过的内容提问（结合记忆/摘要） | read-only |
| 听书模式 | 调 dsh-keeper-voice 朗读书籍内容（分段流式，可打断） | 审批 |

## 数据来源

- `reference/dock_hub/books.py`（758 行）的既有书架数据 → `migration/` 脚本一次性导出为 JSON/Markdown
- 新数据本地落盘（`$DSH_HOME` 数据目录），格式稳定可导出

## 与其他件的关系

- 守岸人可主动聊「你上次读到那章了」→ 结合记忆插件
- 睡前听书 = reading 听书 + k20 字幕同步（可选）
- 阅读进展可由守岸人主动记入 memory；周报中的「本周读了什么」由 memory 记忆支撑
