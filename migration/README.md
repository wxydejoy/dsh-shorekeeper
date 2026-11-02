# migration/ · 岸亭数据迁移脚本

一次性 Python 脚本：把岸亭既有数据导出为新插件可吃的格式，写前备份、幂等可重跑。

- `export_books.py`：books.py 数据 → `reading` 插件 JSON（T5）
- `export_diary.py`：diary.py → dsh-calendar-diary 的 DesktopCal 两列 xlsx（T6 前置）
- `export_calendar.py`：calendar.py → CalDAV/ICS（T6 前置）
- `export_weekly.py`：weekly.py → markdown 归档
