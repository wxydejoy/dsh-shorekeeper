# migration/ · 岸亭数据迁移脚本

一次性 Python 脚本：把岸亭既有数据导出为新插件可吃的格式，写前备份、幂等可重跑。

- `export_books.py`：books.py 数据 → `reading` 插件 JSON（T5）
- `export_diary.py`：**已实现**——岸亭 `~/.config/dock-hub/companion-diary.jsonl` → feiyu-memory 日记档案（`~/.dsh/feiyu-diary/diary/YYYY-MM.jsonl`，id 幂等可重跑，写前备份）。原目标 dsh-calendar-diary 无同名包（T1 D5），日记归 feiyu（D15）；2026-11-03 已迁移 3 条（10/31–11/02）。
- `export_calendar.py`：calendar.py → CalDAV/ICS（T6 前置）
- `export_weekly.py`：weekly.py → markdown 归档
