# migration/ · 岸亭数据迁移脚本

一次性 Python 脚本：把岸亭既有数据导出为新插件可吃的格式，写前备份、幂等可重跑、源目录只读。

## 现状

- `export_books.py` ✅：books.py 数据 → `reading` 插件 JSON/Markdown/归档（T5）。**已真实数据回归**（2026-11-03，本机真书架导出+幂等+备份验证）；格式逆向笔记见 `books-format.md`，测试 `tests/`。
- `export_diary.py` ✅：岸亭 `~/.config/dock-hub/companion-diary.jsonl` → feiyu-memory 日记档案（`~/.dsh/feiyu-diary/diary/YYYY-MM.jsonl`，id 幂等可重跑，写前备份）。去向改判依据 T1 D15（dsh-calendar-diary 判死）；2026-11-03 已迁移 3 条（10/31–11/02）。
- `export_calendar.py` ❌ 未实现——dsh-calendar 走 CalDAV，岸亭 calendar.py 的本地数据是否要迁（ICS 导入）待定。
- `export_weekly.py` ❌ 未实现——周报已改为从 feiyu 记忆 + 台账生成（T3 周报 skill），独立归档脚本可能不再需要。

## 用法

```bash
python3 export_books.py [--source ~/.config/dock-hub/books] [--out $DSH_HOME/data/reading] [--dry-run] [--no-copy-books]
python3 export_diary.py [--src ~/.config/dock-hub/companion-diary.jsonl] [--write]   # 缺省 dry-run
```

源目录永远只读；写前自动备份到 `<out>/backup/<时间戳>/`（books）/ `.jsonl.bak`（diary）；幂等可重跑。
