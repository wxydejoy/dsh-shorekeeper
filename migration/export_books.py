#!/usr/bin/env python3
"""岸亭 books.py 数据 → dsh-shorekeeper-reading 插件数据 一次性导出器（T5）。

对照格式逆向笔记：migration/books-format.md（来源 reference/dock_hub/books.py）。

产出（写入目标目录，默认 $DSH_HOME/data/reading，无 DSH_HOME 时 ~/.dsh/data/reading）：
  shelf.json           书架（reading 插件直接可吃的格式）
  notes.json           摘抄（岸亭无此数据，写空骨架保持落盘完整）
  listen-state.json    听书状态（progress.json 的 timer/current_id/offset 原样承接）
  books-archive.json   岸亭原始数据快照（含未识别字段，审计用，含 sha256 manifest）
  books-export.md      人类可读的书架 Markdown
  books-txt/<书>.txt   书文件原样拷贝（--no-copy-books 可跳过）
  migration-report.md  本次运行报告（含未识别字段/孤儿条目/fidelity/备份记录）

特性：
  - 写前备份：目标目录里将被覆盖的文件先拷进 backup/<时间戳>/
  - 幂等可重跑：源不变 → 数据产出（除 migration-report.md 外）字节级一致
  - 源目录只读：本脚本绝不写 ~/.config/dock-hub（运行中的岸亭）
  - 章节归属：优先用 zh_chapter_splitter（与岸亭同源，fidelity=exact）；
    没有则用内置正则切分（fidelity=approx）。offset/percent 的 clean 坐标
    在 approx 模式下是估计值，报告与 shelf 里都带标注。

用法：
  python3 export_books.py [--source DIR] [--out DIR] [--dry-run] [--no-copy-books]
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any

EXPORT_VERSION = 1
MAX_BOOK_BYTES = 32 * 1024 * 1024  # books.py 的 MAX_BOOK_BYTES

DEFAULT_SOURCE = Path.home() / ".config" / "dock-hub" / "books"

KNOWN_PROGRESS_TOP_FIELDS = {"current_id", "timer_min", "books"}
KNOWN_BOOK_ENTRY_FIELDS = {"offset", "updated_at"}

SHELF_SCHEMA_VERSION = 1


def default_out() -> Path:
    dsh_home = os.environ.get("DSH_HOME")
    base = Path(dsh_home) if dsh_home else Path.home() / ".dsh"
    return base / "data" / "reading"


# --------------------------------------------------------------------------
# 章节切分
# --------------------------------------------------------------------------

# 内置回退切分：第X章/卷/节/回/部/集 与 序章/楔子/引子/番外 等，独占一行视为章节标题。
# 标题部分排除句末标点：避免把「第二章开始。主角出发了！」这类正文行误判成章节标题。
_CHAPTER_LINE = re.compile(
    r"^[\s　]*("
    r"第[0-9零一二三四五六七八九十百千万两〇]+[章卷节回部集][^。！？!?；;\n]{0,60}"
    r"|[序幕楔]章|楔子|引子|引言|前言|自序|后记|尾声|终章|番外[^。！？!?；;\n]{0,50}"
    r")[\s　]*$",
    re.M,
)


def split_chapters_fallback(text: str) -> list[dict[str, Any]]:
    chapters: list[dict[str, Any]] = []
    matches = list(_CHAPTER_LINE.finditer(text))
    if not matches:
        return [{"title": "", "start": 0, "end": len(text)}]
    # 正文早于第一个章节标题的部分算「开头」
    if matches[0].start() > 0:
        head = text[: matches[0].start()].strip()
        if head:
            chapters.append({"title": "开头", "start": 0, "end": matches[0].start()})
    for i, m in enumerate(matches):
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        chapters.append({"title": m.group(1).strip(), "start": start, "end": end})
    return chapters


def try_zh_splitter() -> tuple[Any, Any] | None:
    """拿到与岸亭同源的 clean_text + split_chapters_with_report 就能 exact 对齐。"""
    try:
        from zh_chapter_splitter import clean_text, split_chapters_with_report  # type: ignore

        return clean_text, split_chapters_with_report
    except Exception:
        return None


def split_chapters(text: str, fallback_title: str) -> tuple[list[dict[str, Any]], str]:
    """返回 (chapters, fidelity)。chapters: [{title, start, end}]，坐标是传入 text 的。"""
    pair = try_zh_splitter()
    if pair is not None:
        clean_fn, split_fn = pair
        try:
            cleaned = clean_fn(text)
            found, _report = split_fn(cleaned)
            rows = [item for item in (found or []) if isinstance(item, dict)]
            if rows:
                chapters: list[dict[str, Any]] = []
                cursor = 0
                for item in rows:
                    content = str(item.get("content") or "")
                    title = str(item.get("title") or "").strip() or fallback_title
                    chapters.append(
                        {"title": title, "start": cursor, "end": cursor + len(content)}
                    )
                    cursor += len(content)
                return chapters, "exact"
        except Exception:
            pass
    return split_chapters_fallback(text), "approx"


def chapter_at(chapters: list[dict[str, Any]], offset: int) -> dict[str, Any] | None:
    """offset 落在哪个章节（books.py _chapter_at 的等价实现，越界落最后一章）。"""
    if not chapters:
        return None
    for ch in chapters:
        if ch["start"] <= offset < ch["end"] or (ch["end"] == ch["start"] and offset == ch["start"]):
            return ch
    return chapters[-1]


# --------------------------------------------------------------------------
# 书名 / 作者
# --------------------------------------------------------------------------

_AUTHOR_PAREN = re.compile(r"[\(（]([^\)）]{1,30})[\)）]\s*$")


def split_title_author(stem: str) -> tuple[str, str | None]:
    """「我合成了全世界(王自律)」→ (我合成了全世界, 王自律)。无括注 → author=None。"""
    m = _AUTHOR_PAREN.search(stem)
    if m:
        author = m.group(1).strip()
        title = stem[: m.start()].strip()
        if title and author:
            return title, author
    return stem, None


# --------------------------------------------------------------------------
# 源数据装载（容错规则对照 books.py load_progress，但不静默丢未知字段）
# --------------------------------------------------------------------------


def decode_text(raw: bytes) -> tuple[str, str]:
    """zh_chapter_splitter.decode_bytes 不可用时的编码探测：utf-8 → gb18030 → big5。"""
    for enc in ("utf-8", "gb18030", "big5"):
        try:
            return raw.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace"), "utf-8(replace)"


class ExportModel:
    def __init__(self) -> None:
        self.books: list[dict[str, Any]] = []
        self.timer_min: int | None = None
        self.current_id: str | None = None
        self.unrecognized_top_fields: dict[str, Any] = {}
        self.unrecognized_entry_fields: dict[str, dict[str, Any]] = {}
        self.orphan_entries: list[str] = []  # 有进度但盘上无书文件
        self.no_progress_books: list[str] = []  # 盘上有书但从未有进度
        self.dropped_entries: list[str] = []  # entry 非 dict / 字段类型坏（对照 books.py 会丢）
        self.progress_raw_ok: bool = False
        self.progress_parse_note: str = ""

    def to_report(self) -> dict[str, Any]:
        return {
            "unrecognized_top_fields": self.unrecognized_top_fields,
            "unrecognized_entry_fields": self.unrecognized_entry_fields,
            "orphan_entries": self.orphan_entries,
            "no_progress_books": self.no_progress_books,
            "dropped_entries": self.dropped_entries,
            "progress_raw_ok": self.progress_raw_ok,
            "progress_parse_note": self.progress_parse_note,
        }


def load_progress_raw(path: Path, model: ExportModel) -> dict[str, Any]:
    """读 progress.json；容错对照 books.py load_progress，未知字段保留上报。"""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        model.progress_parse_note = "progress.json 不存在（书库从未被听过/看过）"
        return {}
    except (json.JSONDecodeError, UnicodeError) as exc:
        model.progress_parse_note = f"progress.json 解析失败，按空进度处理: {exc}"
        return {}
    if not isinstance(raw, dict):
        model.progress_parse_note = "progress.json 顶层不是对象，按空进度处理"
        return {}
    model.progress_raw_ok = True
    model.unrecognized_top_fields = {
        k: v for k, v in raw.items() if k not in KNOWN_PROGRESS_TOP_FIELDS
    }
    current = raw.get("current_id")
    model.current_id = str(current) if current is not None else None
    try:
        model.timer_min = int(raw.get("timer_min", 30))
    except (TypeError, ValueError):
        model.timer_min = None
    books_in = raw.get("books")
    return books_in if isinstance(books_in, dict) else {}


def load_source(source: Path, *, with_text: bool = True) -> ExportModel:
    model = ExportModel()
    if not source.is_dir():
        raise FileNotFoundError(f"书库目录不存在: {source}")
    progress_path = source / "progress.json"
    books_in = load_progress_raw(progress_path, model)

    txt_files = sorted(p for p in source.glob("*.txt") if p.is_file())
    on_disk = {p.name for p in txt_files}

    for name in sorted(books_in.keys()):
        entry = books_in[name]
        if not isinstance(entry, dict):
            model.dropped_entries.append(f"{name}: entry 非对象")
            continue
        try:
            offset = int(entry.get("offset", 0))
            updated_at = int(entry.get("updated_at", 0))
        except (TypeError, ValueError):
            model.dropped_entries.append(f"{name}: offset/updated_at 类型坏")
            continue
        unknown = {k: v for k, v in entry.items() if k not in KNOWN_BOOK_ENTRY_FIELDS}
        if unknown:
            model.unrecognized_entry_fields[name] = unknown
        if name not in on_disk:
            model.orphan_entries.append(name)
            continue
        model.books.append(
            _build_book(source, name, offset, updated_at, with_text=with_text)
        )

    seen = {b["migrated"]["book_id"] for b in model.books}
    for path in txt_files:
        if path.name not in seen:
            model.no_progress_books.append(path.name)
            model.books.append(_build_book(source, path.name, None, None, with_text=with_text))

    model.books.sort(key=lambda b: b["migrated"]["book_id"])
    return model


def _build_book(
    source: Path, name: str, offset: int | None, updated_at: int | None, *, with_text: bool
) -> dict[str, Any]:
    path = source / name
    raw = path.read_bytes() if with_text else b""
    size = path.stat().st_size if with_text else 0
    stem = name[: -len(".txt")]
    title, author = split_title_author(stem)
    book: dict[str, Any] = {
        "id": title,
        "title": title,
        "author": author,
        "source_file": name,
        "bytes": size,
        "sha256": hashlib.sha256(raw).hexdigest() if with_text else None,
        "oversize": size > MAX_BOOK_BYTES,
    }
    book["migrated"] = {
        "book_id": name,
        "offset": offset,
        "updated_at": updated_at,
        "updated_at_iso": (
            _dt.datetime.fromtimestamp(updated_at, _dt.timezone.utc).isoformat()
            if updated_at
            else None
        ),
    }
    if offset is None:
        # 盘上有书但从未听过/看过：书架状态记「想读」（books-format.md §5）
        book["status"] = "wishlist"
        book["encoding"] = None
        book["chars"] = None
        book["chapters"] = []
        book["fidelity"] = None
        book["percent"] = None
        book["current_chapter"] = None
        return book
    if with_text:
        text, enc = decode_text(raw)
        chapters, fidelity = split_chapters(text, fallback_title=title)
        book["encoding"] = enc
        book["chars"] = len(text)
        book["chapters"] = chapters
        book["fidelity"] = fidelity
        # 岸亭 books.py:319-326 把越界 offset 夹到全文长——percent 同规则夹到 100
        book["percent"] = round(min(offset, len(text)) / len(text) * 100, 2) if len(text) else 0.0
        cur = chapter_at(chapters, offset)
        book["current_chapter"] = (
            {"index": chapters.index(cur), "title": cur["title"]} if cur else None
        )
        book["status"] = "finished" if len(text) > 0 and offset >= len(text) else "reading"
    else:
        book["encoding"] = None
        book["chars"] = None
        book["chapters"] = []
        book["fidelity"] = None
        book["percent"] = None
        book["current_chapter"] = None
        book["status"] = "reading"
    return book


# --------------------------------------------------------------------------
# 渲染产出（确定性：同样输入 → 同样字节）
# --------------------------------------------------------------------------


def render_shelf(model: ExportModel) -> dict[str, Any]:
    return {
        "version": SHELF_SCHEMA_VERSION,
        "imported_from": "dock-hub books (migration/export_books.py)",
        "books": [
            {
                "id": b["id"],
                "title": b["title"],
                "author": b["author"],
                "status": b["status"],
                "source": "migration",
                "added_at": b["migrated"]["updated_at"],
                "last_read_at": b["migrated"]["updated_at"],
                "finished_at": b["migrated"]["updated_at"] if b["status"] == "finished" else None,
                "progress": {
                    "kind": "char",
                    "char_offset": b["migrated"]["offset"] or 0,
                    "percent": b["percent"],
                    "chapter_index": (b["current_chapter"] or {}).get("index"),
                    "chapter_title": (b["current_chapter"] or {}).get("title"),
                    "fidelity": b["fidelity"],
                }
                if b["status"] != "wishlist"
                else None,
                "migrated": {
                    "book_id": b["migrated"]["book_id"],
                    "source_file": b["source_file"],
                    "sha256": b["sha256"],
                    "bytes": b["bytes"],
                    "oversize": b["oversize"],
                },
            }
            for b in model.books
        ],
    }


def render_notes(model: ExportModel) -> dict[str, Any]:
    return {"version": SHELF_SCHEMA_VERSION, "notes": []}


def render_listen_state(model: ExportModel) -> dict[str, Any]:
    books: dict[str, Any] = {}
    for b in model.books:
        if b["migrated"]["offset"] is not None:
            books[b["migrated"]["book_id"]] = {
                "offset": b["migrated"]["offset"],
                "updated_at": b["migrated"]["updated_at"],
            }
    return {
        "version": SHELF_SCHEMA_VERSION,
        "timer_min": model.timer_min if model.timer_min in (0, 15, 30, 45, 60) else 30,
        "current_id": model.current_id,
        "books": books,
    }


def render_archive(model: ExportModel, source: Path) -> dict[str, Any]:
    return {
        "source_dir": str(source),
        "books": model.books,
        "unrecognized_top_fields": model.unrecognized_top_fields,
        "unrecognized_entry_fields": model.unrecognized_entry_fields,
        "orphan_entries": model.orphan_entries,
        "no_progress_books": model.no_progress_books,
        "dropped_entries": model.dropped_entries,
        "current_id": model.current_id,
        "timer_min": model.timer_min,
    }


def _fmt_ts(ts: int | None) -> str:
    if not ts:
        return "—"
    local = _dt.datetime.fromtimestamp(ts).astimezone()
    return local.strftime("%Y-%m-%d %H:%M")


def render_books_md(model: ExportModel, source: Path) -> str:
    lines = [
        "# 书架迁移导出（岸亭 books → reading）",
        "",
        f"- 源目录：`{source}`",
        f"- 书籍数：{len(model.books)}",
        "",
        "| 书名 | 作者 | 状态 | 进度 | 当前章 | 最近阅读 | 源文件 |",
        "|---|---|---|---|---|---|---|",
    ]
    status_cn = {"reading": "在读", "finished": "读完", "wishlist": "想读"}
    for b in model.books:
        progress = "—"
        if b["percent"] is not None:
            progress = f"{b['percent']}%（offset {b['migrated']['offset']}/{b['chars']} 字）"
        chapter = (b["current_chapter"] or {}).get("title") or "—"
        lines.append(
            "| {title} | {author} | {status} | {progress} | {chapter} | {ts} | `{file}` |".format(
                title=b["title"],
                author=b["author"] or "—",
                status=status_cn[b["status"]],
                progress=progress,
                chapter=chapter[:40],
                ts=_fmt_ts(b["migrated"]["updated_at"]),
                file=b["source_file"],
            )
        )
    return "\n".join(lines) + "\n"


def render_report(
    model: ExportModel,
    source: Path,
    out: Path,
    *,
    dry_run: bool,
    copied_books: int,
    backups: list[str],
    fidelity: str | None,
) -> str:
    counts: dict[str, int] = {"reading": 0, "finished": 0, "wishlist": 0}
    for b in model.books:
        counts[b["status"]] += 1
    now = _dt.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %z")
    lines = [
        "# books 迁移报告",
        "",
        f"- 运行时间：{now}{'（dry-run，未写盘）' if dry_run else ''}",
        f"- 源目录：`{source}`",
        f"- 目标目录：`{out}`",
        f"- 书籍数：{len(model.books)}（在读 {counts['reading']} / 读完 {counts['finished']} / 想读 {counts['wishlist']}）",
        f"- 书文件拷贝：{copied_books} 本",
        f"- 章节切分 fidelity：{fidelity or '—'}（exact=与岸亭同源 zh_chapter_splitter；approx=内置正则，offset 坐标是估计）",
        f"- progress.json 解析：{'正常' if model.progress_raw_ok else model.progress_parse_note or '空'}",
        f"- timer_min：{model.timer_min}（合法值 0/15/30/45/60）",
        f"- current_id：{model.current_id or '—'}",
        f"- 写前备份：{('；'.join(backups)) if backups else '无（首次写入或 dry-run）'}",
        "",
        "## 未识别字段（原样保留在 books-archive.json，未丢弃）",
        "",
    ]
    if model.unrecognized_top_fields:
        lines.append(f"- 顶层：{json.dumps(model.unrecognized_top_fields, ensure_ascii=False)}")
    for name, fields in model.unrecognized_entry_fields.items():
        lines.append(f"- {name}: {json.dumps(fields, ensure_ascii=False)}")
    if not model.unrecognized_top_fields and not model.unrecognized_entry_fields:
        lines.append("- 无")
    lines += ["", "## 异常条目", ""]
    for label, items in (
        ("孤儿进度（有进度无书文件，已跳过）", model.orphan_entries),
        ("从未开始的 book 条目（entry 损坏被丢弃）", model.dropped_entries),
        ("无进度记录的书（状态记为想读）", model.no_progress_books),
    ):
        lines.append(f"- {label}：{('、'.join(items)) if items else '无'}")
    lines += [
        "",
        "## 迁移映射约定",
        "",
        "- 见 `migration/books-format.md` §5；从未开始的书记为「想读」。",
        "- offset 为岸亭 clean 后全文的字符偏移；approx 模式下 percent/章节归属为估计值。",
        "",
    ]
    return "\n".join(lines)


# --------------------------------------------------------------------------
# 写盘（备份 + 幂等）
# --------------------------------------------------------------------------

DATA_FILES = ("shelf.json", "notes.json", "listen-state.json", "books-archive.json", "books-export.md")


def _dump_json(payload: Any) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def write_outputs(
    model: ExportModel,
    source: Path,
    out: Path,
    *,
    dry_run: bool,
    copy_books: bool,
    now_tag: str,
) -> tuple[int, list[str]]:
    """返回 (拷贝书数, 备份记录)。dry_run=True 时只统计不写。"""
    files: dict[str, bytes] = {
        "shelf.json": _dump_json(render_shelf(model)),
        "notes.json": _dump_json(render_notes(model)),
        "listen-state.json": _dump_json(render_listen_state(model)),
        "books-archive.json": _dump_json(render_archive(model, source)),
        "books-export.md": render_books_md(model, source).encode("utf-8"),
    }
    book_sources: dict[str, Path] = {}
    if copy_books:
        for b in model.books:
            src = source / b["source_file"]
            if src.is_file():
                book_sources[f"books-txt/{b['source_file']}"] = src

    backups: list[str] = []
    existing: list[tuple[str, Path]] = []
    for rel in files:
        p = out / rel
        if p.is_file():
            existing.append((rel, p))
    for rel, src in book_sources.items():
        p = out / rel
        if p.is_file():
            existing.append((rel, p))

    if not dry_run and existing:
        backup_dir = out / "backup" / now_tag
        for rel, p in existing:
            target = backup_dir / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, target)
            backups.append(f"{rel} → backup/{now_tag}/{rel}")

    if dry_run:
        return len(book_sources), backups

    for rel, payload in files.items():
        p = out / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(payload)
    for rel, src in book_sources.items():
        p = out / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, p)
    return len(book_sources), backups


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="岸亭 books 数据 → reading 插件导出器")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="岸亭书库目录（默认 ~/.config/dock-hub/books）")
    parser.add_argument("--out", type=Path, default=None, help="目标目录（默认 $DSH_HOME/data/reading 或 ~/.dsh/data/reading）")
    parser.add_argument("--dry-run", action="store_true", help="只算不写")
    parser.add_argument("--no-copy-books", action="store_true", help="不拷贝书 txt 文件")
    args = parser.parse_args(argv)

    source: Path = args.source
    out: Path = args.out if args.out is not None else default_out()
    try:
        model = load_source(source)
    except FileNotFoundError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        print("用 --source 指定书库目录（hub.yaml 同级的 books/）", file=sys.stderr)
        return 1

    fidelity = next((b["fidelity"] for b in model.books if b["fidelity"]), None)
    now_tag = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    copied, backups = write_outputs(
        model, source, out, dry_run=args.dry_run, copy_books=not args.no_copy_books, now_tag=now_tag
    )
    report = render_report(
        model, source, out, dry_run=args.dry_run, copied_books=copied, backups=backups, fidelity=fidelity
    )
    if not args.dry_run:
        (out / "migration-report.md").write_text(report, encoding="utf-8")
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
