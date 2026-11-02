#!/usr/bin/env python3
"""岸亭守岸人日记 → feiyu-memory 日记档案（T3/D15 迁移）。

源：~/.config/dock-hub/companion-diary.jsonl（{date, text, source, written_at}）
目标：~/.dsh/feiyu-diary/diary/YYYY-MM.jsonl（feiyu normalizeDiaryEntry 形状）
  {id, date, text, tags, kind, salience, created_at}
  - id = "dy-<date>"，幂等键：已存在的跳过，可重跑
  - summary 不写：feiyu recall 对无 summary 条目用正文兜底（recall.mjs 设计）
  - kind=chat, salience=0.5, tags=["岸亭日记"]

用法：
  python3 export_diary.py            # dry-run：只打印将要写什么
  python3 export_diary.py --write    # 实际写入（写前自动备份目标文件）
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

SRC_DEFAULT = Path.home() / ".config/dock-hub/companion-diary.jsonl"
DST_DIR_DEFAULT = Path.home() / ".dsh/feiyu-diary/diary"
TAG = "岸亭日记"


def load_src(path: Path) -> list[dict]:
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            print(f"跳过坏行：{line[:60]}", file=sys.stderr)
            continue
        if isinstance(row, dict) and row.get("date") and row.get("text"):
            rows.append(row)
    rows.sort(key=lambda r: str(r["date"]))
    return rows


def to_feiyu_entry(row: dict) -> dict:
    written = str(row.get("written_at") or "")
    try:
        created_ms = int(datetime.fromisoformat(written).timestamp() * 1000)
    except ValueError:
        created_ms = int(datetime.now().timestamp() * 1000)
    return {
        "id": f"dy-{row['date']}",
        "date": str(row["date"]),
        "text": str(row["text"]).strip(),
        "tags": [TAG],
        "kind": "chat",
        "salience": 0.5,
        "created_at": created_ms,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", type=Path, default=SRC_DEFAULT)
    ap.add_argument("--dst-dir", type=Path, default=DST_DIR_DEFAULT)
    ap.add_argument("--write", action="store_true", help="实际写入（默认 dry-run）")
    args = ap.parse_args()

    if not args.src.is_file():
        print(f"源不存在：{args.src}")
        return 1
    rows = load_src(args.src)
    if not rows:
        print("源里没有可迁移的日记。")
        return 0

    by_month: dict[str, list[dict]] = {}
    for row in rows:
        entry = to_feiyu_entry(row)
        by_month.setdefault(entry["date"][:7], []).append(entry)

    planned: list[tuple[Path, list[dict]]] = []
    skipped = 0
    for month, entries in sorted(by_month.items()):
        dst = args.dst_dir / f"{month}.jsonl"
        existing_ids: set[str] = set()
        if dst.is_file():
            for line in dst.read_text(encoding="utf-8").splitlines():
                try:
                    existing_ids.add(json.loads(line).get("id"))
                except json.JSONDecodeError:
                    pass
        fresh = [e for e in entries if e["id"] not in existing_ids]
        skipped += len(entries) - len(fresh)
        if fresh:
            planned.append((dst, fresh))

    mode = "WRITE" if args.write else "DRY-RUN"
    print(f"[{mode}] 源 {len(rows)} 条 → 新增 {sum(len(v) for _, v in planned)} 条，已有跳过 {skipped} 条")
    for dst, fresh in planned:
        print(f"  {dst}  <-  {', '.join(e['id'] for e in fresh)}")
    if not args.write:
        print("（dry-run，未写盘；确认后加 --write）")
        return 0

    for dst, fresh in planned:
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.is_file():
            backup = dst.with_suffix(".jsonl.bak")
            shutil.copy2(dst, backup)
            print(f"  备份：{backup}")
        with dst.open("a", encoding="utf-8") as fh:
            for entry in fresh:
                fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
        print(f"  写入：{dst}（+{len(fresh)}）")
    print("完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
