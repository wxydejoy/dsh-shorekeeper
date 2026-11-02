# migration/ · 岸亭数据迁移脚本

一次性 Python 脚本：把岸亭既有数据导出为新插件可吃的格式，写前备份、幂等可重跑、源目录只读。

## 现状

- `export_books.py` ✅：books.py 数据 → `reading` 插件 JSON/Markdown/归档（T5）。**已真实数据回归**（2026-11-03，本机真书架导出+幂等+备份验证）；格式逆向笔记见 `books-format.md`，测试 `tests/`。
- `export_diary.py` ❌ 未实现——**去向已改判**（T1 D15：日记归 feiyu-memory 的 `~/.dsh/feiyu-diary/`，dsh-calendar-diary 判死）；是否还需要导出待漂泊者定。
- `export_calendar.py` ❌ 未实现——dsh-calendar 走 CalDAV，岸亭 calendar.py 的本地数据是否要迁（ICS 导入）待定。
- `export_weekly.py` ❌ 未实现——周报已改为从 feiyu 记忆 + 台账生成（T3 周报 skill），独立归档脚本可能不再需要。

## 用法

```bash
python3 export_books.py [--source ~/.config/dock-hub/books] [--out $DSH_HOME/data/reading] [--dry-run] [--no-copy-books]
```

源目录永远只读；写前自动备份到 `<out>/backup/<时间戳>/`；幂等可重跑（源不变 → 产出字节级一致）。
