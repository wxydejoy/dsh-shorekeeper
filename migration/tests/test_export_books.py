"""export_books.py 单测（零依赖，Python unittest）。

跑法：python3 -m unittest discover -s migration/tests -v
fixture 全部自造（真实书架数据不在本仓库，真机回归见 migration/migration-report-real.md）。
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import export_books as eb  # noqa: E402


BOOK1 = (
    "开头的话，还没有进章节。\n"
    "第1章 开端\n"
    "你好，世界。这是第一章的内容，用来测试切句。风把窗帘吹起来了。\n"
    "第2章 风起\n"
    "第二章开始。主角出发了！路很长。\n"
)


def make_source(dirpath: Path, progress: dict | None, files: dict[str, str] | None = None) -> Path:
    dirpath.mkdir(parents=True, exist_ok=True)
    for name, text in (files or {"我合成了全世界(王自律).txt": BOOK1}).items():
        (dirpath / name).write_text(text, encoding="utf-8")
    if progress is not None:
        (dirpath / "progress.json").write_text(
            json.dumps(progress, ensure_ascii=False), encoding="utf-8"
        )
    return dirpath


class SplitChapterTests(unittest.TestCase):
    def test_fallback_chapters_with_head(self):
        chapters = eb.split_chapters_fallback(BOOK1)
        self.assertEqual([c["title"] for c in chapters], ["开头", "第1章 开端", "第2章 风起"])
        self.assertEqual(chapters[1]["start"], BOOK1.index("第1章 开端"))
        self.assertEqual(chapters[2]["end"], len(BOOK1))

    def test_fallback_no_chapters_single_chunk(self):
        chapters = eb.split_chapters_fallback("没有任何章节标题的一本书。")
        self.assertEqual(len(chapters), 1)
        self.assertEqual(chapters[0]["end"], len("没有任何章节标题的一本书。"))

    def test_fallback_special_titles(self):
        text = "楔子\n天黑了。\n第12卷 星海\n到了。\n番外1 番外的番外\n完。\n"
        titles = [c["title"] for c in eb.split_chapters_fallback(text)]
        self.assertEqual(titles, ["楔子", "第12卷 星海", "番外1 番外的番外"])

    def test_chapter_at_clamps_to_last(self):
        chapters = eb.split_chapters_fallback(BOOK1)
        # 越界 → 最后一章（对照 books.py _chapter_at）
        self.assertEqual(eb.chapter_at(chapters, len(BOOK1) + 999), chapters[-1])
        self.assertEqual(eb.chapter_at(chapters, 0), chapters[0])

    def test_split_chapters_fidelity_approx_without_pkg(self):
        chapters, fidelity = eb.split_chapters(BOOK1, fallback_title="某书")
        self.assertIn(fidelity, ("approx", "exact"))  # 装了 zh_chapter_splitter 的机器会是 exact
        self.assertTrue(chapters)


class TitleAuthorTests(unittest.TestCase):
    def test_half_width(self):
        self.assertEqual(eb.split_title_author("我合成了全世界(王自律)"), ("我合成了全世界", "王自律"))

    def test_full_width(self):
        self.assertEqual(eb.split_title_author("测试书（某某）"), ("测试书", "某某"))

    def test_no_author(self):
        self.assertEqual(eb.split_title_author("无作者的书"), ("无作者的书", None))


class LoadSourceTests(unittest.TestCase):
    def test_basic_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = make_source(Path(tmp) / "src", {
                "current_id": "我合成了全世界(王自律).txt",
                "timer_min": 30,
                "books": {"我合成了全世界(王自律).txt": {"offset": BOOK1.index("第2章 风起"), "updated_at": 1793629687}},
            })
            model = eb.load_source(src)
            self.assertEqual(len(model.books), 1)
            b = model.books[0]
            self.assertEqual(b["title"], "我合成了全世界")
            self.assertEqual(b["author"], "王自律")
            self.assertEqual(b["status"], "reading")
            self.assertEqual(b["migrated"]["offset"], BOOK1.index("第2章 风起"))
            self.assertEqual(b["migrated"]["updated_at_iso"], None or b["migrated"]["updated_at_iso"])
            self.assertIsNotNone(b["migrated"]["updated_at_iso"])
            # 回退切分能对上章
            self.assertEqual(b["current_chapter"]["title"], "第2章 风起")
            self.assertGreater(b["percent"], 0)
            self.assertLess(b["percent"], 100)
            self.assertEqual(b["chapters"][0]["title"], "开头")
            self.assertTrue(b["sha256"])
            self.assertFalse(b["oversize"])

    def test_offset_beyond_end_marks_finished(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = make_source(Path(tmp) / "src", {
                "timer_min": 15,
                "books": {"我合成了全世界(王自律).txt": {"offset": 10 ** 9, "updated_at": 100}},
            })
            model = eb.load_source(src)
            self.assertEqual(model.books[0]["status"], "finished")
            self.assertEqual(model.books[0]["percent"], 100.0)

    def test_book_without_progress_is_wishlist(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = make_source(Path(tmp) / "src", {"timer_min": 30, "books": {}})
            model = eb.load_source(src)
            self.assertEqual(model.books[0]["status"], "wishlist")
            self.assertIn("我合成了全世界(王自律).txt", model.no_progress_books)

    def test_orphan_progress_entry(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = make_source(Path(tmp) / "src", {
                "timer_min": 30,
                "books": {"不存在.txt": {"offset": 5, "updated_at": 1}},
            })
            model = eb.load_source(src)
            self.assertEqual(model.orphan_entries, ["不存在.txt"])
            self.assertFalse(any(b["source_file"] == "不存在.txt" for b in model.books))

    def test_dropped_bad_entries(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = make_source(Path(tmp) / "src", {
                "timer_min": 30,
                "books": {
                    "坏类型.txt": {"offset": "abc", "updated_at": 1},
                    "非对象.txt": "garbage",
                },
            }, files={"坏类型.txt": "内容", "非对象.txt": "内容"})
            model = eb.load_source(src)
            self.assertEqual(len(model.dropped_entries), 2)

    def test_unknown_fields_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = make_source(Path(tmp) / "src", {
                "timer_min": 30,
                "books": {"我合成了全世界(王自律).txt": {"offset": 10, "updated_at": 1, "mystery": 42}},
                "vendor_extra": {"a": 1},
            })
            model = eb.load_source(src)
            self.assertEqual(model.unrecognized_entry_fields["我合成了全世界(王自律).txt"], {"mystery": 42})
            self.assertEqual(model.unrecognized_top_fields, {"vendor_extra": {"a": 1}})

    def test_corrupt_progress_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "src"
            src.mkdir(parents=True)
            (src / "我合成了全世界(王自律).txt").write_text(BOOK1, encoding="utf-8")
            (src / "progress.json").write_text("{oops", encoding="utf-8")
            model = eb.load_source(src)
            self.assertFalse(model.progress_raw_ok)
            self.assertIn("解析失败", model.progress_parse_note)
            self.assertEqual(model.books[0]["status"], "wishlist")

    def test_missing_progress_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = make_source(Path(tmp) / "src", None)
            model = eb.load_source(src)
            self.assertIn("不存在", model.progress_parse_note)
            self.assertEqual(model.books[0]["status"], "wishlist")

    def test_missing_source_raises(self):
        with self.assertRaises(FileNotFoundError):
            eb.load_source(Path("/nonexistent-books-dir-xyz"))


class RenderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.src = make_source(Path(self.tmp.name) / "src", {
            "current_id": "我合成了全世界(王自律).txt",
            "timer_min": 45,
            "books": {"我合成了全世界(王自律).txt": {"offset": BOOK1.index("第2章 风起"), "updated_at": 1793629687}},
        })
        self.model = eb.load_source(self.src)

    def test_shelf_shape(self):
        shelf = eb.render_shelf(self.model)
        self.assertEqual(shelf["version"], 1)
        (b,) = shelf["books"]
        self.assertEqual(b["status"], "reading")
        self.assertEqual(b["progress"]["kind"], "char")
        self.assertEqual(b["progress"]["chapter_title"], "第2章 风起")
        self.assertEqual(b["migrated"]["source_file"], "我合成了全世界(王自律).txt")
        self.assertIsNone(b["finished_at"])

    def test_listen_state(self):
        ls = eb.render_listen_state(self.model)
        self.assertEqual(ls["timer_min"], 45)
        self.assertEqual(ls["current_id"], "我合成了全世界(王自律).txt")
        self.assertEqual(ls["books"]["我合成了全世界(王自律).txt"]["offset"], BOOK1.index("第2章 风起"))

    def test_listen_state_bad_timer_falls_back(self):
        self.model.timer_min = 999
        self.assertEqual(eb.render_listen_state(self.model)["timer_min"], 30)

    def test_archive_keeps_unknowns_and_sha(self):
        self.model.unrecognized_entry_fields["我合成了全世界(王自律).txt"] = {"mystery": 42}
        arch = eb.render_archive(self.model, self.src)
        self.assertEqual(arch["unrecognized_entry_fields"]["我合成了全世界(王自律).txt"], {"mystery": 42})
        self.assertEqual(len(arch["books"]), 1)
        self.assertTrue(arch["books"][0]["sha256"])

    def test_books_md_lists_book(self):
        md = eb.render_books_md(self.model, self.src)
        self.assertIn("我合成了全世界", md)
        self.assertIn("王自律", md)
        self.assertIn("在读", md)
        self.assertIn("第2章 风起", md)


class WriteTests(unittest.TestCase):
    def _model(self, root: Path):
        src = make_source(root / "src", {
            "current_id": "我合成了全世界(王自律).txt",
            "timer_min": 30,
            "books": {"我合成了全世界(王自律).txt": {"offset": 10, "updated_at": 1793629687}},
        })
        return src, eb.load_source(src)

    def test_write_and_idempotent_and_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src, model = self._model(root)
            out = root / "out"
            copied, backups1 = eb.write_outputs(model, src, out, dry_run=False, copy_books=True, now_tag="t1")
            self.assertEqual(copied, 1)
            self.assertEqual(backups1, [])  # 首次写入无备份
            first = {rel: (out / rel).read_bytes() for rel in eb.DATA_FILES}
            self.assertEqual((out / "books-txt" / "我合成了全世界(王自律).txt").read_text(encoding="utf-8"), BOOK1)

            # 重跑：数据产出字节级一致（幂等），旧文件进 backup/
            copied2, backups2 = eb.write_outputs(model, src, out, dry_run=False, copy_books=True, now_tag="t2")
            self.assertEqual(copied2, 1)
            self.assertEqual(len(backups2), len(eb.DATA_FILES) + 1)
            for rel, payload in first.items():
                self.assertEqual((out / rel).read_bytes(), payload, f"{rel} 非幂等")
            # 备份目录按「本次运行的 now_tag」归档（与模块 docstring 一致）：
            # 重跑一次，全部旧文件进 backup/t2/
            self.assertTrue((out / "backup" / "t2" / "shelf.json").is_file())
            self.assertTrue((out / "backup" / "t2" / "books-txt" / "我合成了全世界(王自律).txt").is_file())

    def test_dry_run_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src, model = self._model(root)
            out = root / "out"
            copied, backups = eb.write_outputs(model, src, out, dry_run=True, copy_books=True, now_tag="t1")
            self.assertEqual(copied, 1)
            self.assertEqual(backups, [])
            self.assertFalse(out.exists())


class MainTests(unittest.TestCase):
    def test_main_dry_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_source(root / "src", {
                "timer_min": 30,
                "books": {"我合成了全世界(王自律).txt": {"offset": 10, "updated_at": 1}},
            })
            out = root / "out"
            rc = eb.main(["--source", str(root / "src"), "--out", str(out), "--dry-run"])
            self.assertEqual(rc, 0)
            self.assertFalse(out.exists())

    def test_main_full_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_source(root / "src", {
                "timer_min": 30,
                "books": {"我合成了全世界(王自律).txt": {"offset": 10, "updated_at": 1}},
            })
            out = root / "out"
            rc = eb.main(["--source", str(root / "src"), "--out", str(out)])
            self.assertEqual(rc, 0)
            for rel in eb.DATA_FILES + ("migration-report.md",):
                self.assertTrue((out / rel).is_file(), rel)
            report = (out / "migration-report.md").read_text(encoding="utf-8")
            self.assertIn("书籍数：1", report)
            shelf = json.loads((out / "shelf.json").read_text(encoding="utf-8"))
            self.assertEqual(shelf["books"][0]["id"], "我合成了全世界")

    def test_main_missing_source_exit_1(self):
        rc = eb.main(["--source", "/nonexistent-books-dir-xyz", "--out", "/tmp/never-out-t5"])
        self.assertEqual(rc, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
