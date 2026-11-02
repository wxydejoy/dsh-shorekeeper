# books.py 存储格式逆向笔记（T5 前置）

> 来源：`reference/dock_hub/books.py`（快照，758 行）；辅证取自岸亭仓库（只读参考）：
> `hub/dock_hub/speech.py`（切句/估时）、`hub/dock_hub/config.py`（路径解析）、
> `hub/dock_hub/service.py`（Books 挂载点）。全文检索确认：**岸亭没有摘抄/随想存储**，
> 摘抄是 T5 新增能力，无历史数据要迁。

## 1. 存储位置与文件形态

- 书库根目录 = **hub.yaml 所在目录下的 `books/`**（service.py:221：`root = config.parent / "books"`）。
  本机默认即 `~/.config/dock-hub/books/`。
- 一本书 = 一个 `<书名>.txt`，无元数据文件；书名即文件名去 `.txt`。
- 进度 = 根目录下唯一的 `progress.json`。

`safe_book_id()` 校验规则（books.py:35）：必须 `.txt` 结尾、不含 `/` `\`、不得叫
`progress.json`、不含 `..`、必须等于 `Path(name).name`。单文件上限 32MB
（`MAX_BOOK_BYTES`，超出报「文件超过 32MB」）。

## 2. progress.json 格式

真实样例（2026-11-02 从本机只读抄录）：

```json
{"current_id": "我合成了全世界(王自律).txt", "timer_min": 30,
 "books": {"我合成了全世界(王自律).txt": {"offset": 455793, "updated_at": 1793629687}}}
```

| 字段 | 类型 | 语义与容错 |
|---|---|---|
| `current_id` | `string \| null` | 「当前在听/在看」的书 id（文件名）。指向不存在文件时 `list_books` 置 null；写盘时按盘上实际 `*.txt` 过滤 `books`（books.py:236） |
| `timer_min` | `int` | 听书定时（分钟），**只允许 0/15/30/45/60**（`TIMER_CHOICES`），非法值回落 30；0=不定时 |
| `books` | `map<id, {offset, updated_at}>` | 每本书的书签。entry 非 dict / offset、updated_at 非 int 时**整条丢弃**（books.py:69-77） |
| `books[id].offset` | `int` | **字符书签**：clean 后全文（各章 content 按序拼接）中的字符偏移。朗读时每句开口即持久化为该句起点（`_show_sentence → _persist_offset`），读完置 `len(text)`；越界 `>chars` 时夹到 chars 并写回（books.py:319-326） |
| `books[id].updated_at` | `int` | unix 秒，最后一次持久化书签的时间 |

损坏容错：progress.json 读不出（OSError/JSONDecodeError/UnicodeError）或非 dict →
整体回落 `{"current_id": null, "timer_min": 30, "books": {}}`（books.py:50-56）。

## 3. 章节切分（影响 offset 语义）

- 依赖外部包 **zh-chapter-splitter**（>=0.1.0）：`decode_bytes`（编码探测）→
  `clean_text`（清洗）→ `split_chapters_with_report`（章节识别）。
- `Chapter(index, title, volume, start, end, text)`；`start/end` 是**拼接后全文**的字符区间。
- 整本书识别不出章节 → 单章兜底（title=文件名）；单章且标题不在原文行里 → 改用文件名（books.py:156-159）。
- **offset 是 clean 后坐标**。没有 zh_chapter_splitter 就无法精确复现 clean_text，
  导出器只能按近似清洗估计章节归属 → 报告必须标注 fidelity（`exact`/`approx`）。

## 4. 听书业务规则（重生听书模式要对齐的）

切句与打包（speech.py，克隆音色经验值 37 字 / 9.5 秒）：

- `cut_sentences`：在 `。！？` 与换行处断句；`chunk_read_text(limit=120)` 长句再硬切。
- `pack_read_chunks(target=36, limit=52)`：按逗号（`，、；：`）拆短句再拼回参考长度，
  过短碎片合并，>52 硬切——**保证语速稳定**。
- `estimate_read_seconds = 口播字数 / 4.0`（界面估时用，非 TTS 真实语速）。

播放循环（books.py `Books`）：

- 每句：cue 当前句 → **预取下一句**进喇叭队列（避免句间空等合成）；等待时长 = 估时/语速。
- `voice_speed` 夹在 0.5–2.0。
- 定时：deadline 到点停（`stopped_by: "timer"`）；暂停冻结剩余时长，恢复续跑不重置。
- `skip(±1)` 句子级：播放中跳转复用 play 通道（倒计时不重给满）；未播放只挪书签。
- 打断/暂停 → `speaker.stop()` + interrupt 事件，播放线程 2s 内退出。
- `stopped_by` 取值：`user` / `timer` / `end` / `error`。
- 朗读中每句落盘 offset + `current_id=当前书`——天然就是「断点续读」。

## 5. 迁移映射（→ reading 插件数据格式）

| 岸亭 | reading 插件 | 说明 |
|---|---|---|
| 文件名去 `.txt` | `title` | 若尾部含 `(作者)` 括注则拆出 `author`（如「我合成了全世界(王自律)」） |
| `books[id].offset` | `progress.char_offset` | 原样保留；percent = offset/全文长（approx 时标注） |
| `books[id].updated_at` | `last_read_at` | unix 秒 |
| `current_id` 指向的书 | `status="reading"` | 其余有书签的书也是 `reading`（听过没听完）；offset>=全文长 → `finished` |
| `timer_min` | 听书状态（非书架字段） | 迁到 listening state，不进 shelf |
| `*.txt` 书文件 | 原样拷贝进新数据目录 | 听书/提问需要全文；manifest 记 sha256 证无损 |

未知字段对策（对应任务书风险「隐含字段」）：progress.json / book entry 里出现
已知集合之外的键 → **全部抄录进导出报告的 `unrecognized_fields`**，不静默丢弃。
