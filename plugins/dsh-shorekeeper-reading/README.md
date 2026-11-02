# dsh-shorekeeper-reading

> 状态：**未开工（T5）** · 任务文档：[docs/tasks/T5-reading.md](../../docs/tasks/T5-reading.md)

守岸人的书架：岸亭 `books.py` 的阅读能力在 dsh 里重生——书架管理、阅读进度、听书、摘抄。

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
