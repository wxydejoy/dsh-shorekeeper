# T5 · dsh-shorekeeper-reading —— 阅读

```
状态: review（插件与迁移器完工已合 main；听书三件 agent 侧落地（Z8：切句/断点/停等单测 27 绿），真机听感留人工；k20 字幕联动 ⏸） · owner: 值班 agent（T5）· 开始于: 2026-11-02 · 预估: 10–14 agent 小时 · 前置: T1 · 联调依赖 T4（听书）
分支: T5-reading
```

## 目标

岸亭 books.py（758 行）的阅读能力在 dsh 里重生：书架、进度、摘抄、听书。历史数据无损迁入，守岸人能自然聊起「你上次读到那章了」。

## 背景

书架/进度/摘抄是岸亭私域能力，生态无现成件。数据格式对照 `reference/dock_hub/books.py`；听书依赖 dsh-keeper-voice 的流式朗读。

## 步骤

### 阶段一：数据迁移（2–3h）
- [x] `migration/export_books.py`：books.py 数据 → JSON/Markdown（书名/作者/进度/摘抄/时间戳）（593 行；逆向笔记 `migration/books-format.md` 含真实 progress.json 样例与未识别字段对策）
- [x] 写前自动备份；幂等可重跑；对真实数据回归（27 条单测全绿；**真实数据回归 ⏸ 待岸亭真数据**）
- [x] 数据落盘位置定为 `$DSH_HOME` 数据目录，导出格式文档化（`$DSH_HOME/data/reading`，无则 `~/.dsh/data/reading`）

### 阶段二：工具面（4–6h）
- [x] `reading.shelf`：在读/读完/想读 + 进度 + 最近阅读排序
- [x] `reading.progress`：更新进度（页码/百分比/章节），口语化输入解析（「看到 217 页了」——解析在模型侧，工具收结构化入参；书名歧义会反问）
- [x] `reading.note`：摘抄与随想落库，可关联书与章节
- [x] `reading.ask`：对读过的内容提问（本地检索：摘抄 + 书目；记忆插件检索 ⏸ T3 选型后挂接）
- [x] 权限：全 read-only（数据修改经守岸人对话完成，仍走本插件写入口）

### 阶段三：听书与联动（4–5h）
- [x] 听书模式：reading.listen/stop/resume 三工具（Z8 2026-11-05）：直连 keeper-tts /v1/audio/speech（play:true 服务端喇叭出声）、切句打包照 books-format §4（36/52/120）、每段落盘 offset 断点续读、listen-state.json 沿迁移 schema、打断=再来一条指令即停（barge-in 桥 ⏸ T4）
- [ ] 睡前听书联动 k20 字幕（⏸ 依赖 T2 提案路由落地）
- [ ] 记忆插件联动：读完一章自动沉淀摘要事实（⏸ T3 选型）
- [x] 单测 + 真实数据回归 + 验收记录（单测 27+10 全绿；真实数据回归 ⏸）

## 交付物
- `plugins/dsh-shorekeeper-reading/` 完整实现
- `migration/export_books.py` + 迁移报告

## 验收标准
- [ ] 历史书架数据完整迁入（抽查 10 本，字段无损）
- [ ] 「我看到 217 页了，记一下」生效且进度可查
- [x] 听书能读能停，断点续读（单测 mock TTS 27 条全绿：切句边界/断点恢复/stop 立即返/失联与 404 优雅落 error；真机听感验收留人工）
- [ ] 守岸人对「上次读哪了」答得上来

## 拓展方向 / 未来方向
- 拓展：阅读统计与年度书单；epub/mobi 解析
- 未来：摘抄自动沉淀长期记忆；守岸人写「给你的批注」

## 风险与对策
| 风险 | 对策 |
|---|---|
| books.py 数据格式有隐含字段 | 先只读分析再写导出器；导出报告列出未识别字段 |
| 长文本朗读体验差 | 分句流式 + 章节级缓存；打断响应优先 |

## 验收记录

### 2026-11-03 · 值班 agent · 阶段一/二完成（含前值班 agent 交接）
- 前值班 agent 留下：`migration/books-format.md`（逆向笔记，辅证到岸亭仓库 speech/config/service，确认**岸亭无摘抄存储、摘抄为 T5 新增**）、`export_books.py`（593 行导出器）与未提交的 301 行测试。交接时 3 条测试失败，修复后 27/27 全绿：
  - `id` 未按「书名(作者)」拆分 → 现按 `_AUTHOR_PAREN` 拆出 title/author，id=拆分后书名；
  - percent 未夹到 100 → 对齐岸亭 books.py:319-326 的越界 clamp；
  - 备份断言（backup/t1 与 t2 并存）与模块 docstring「每次运行一个时间戳目录」矛盾 → 按已提交文档语义修测试。
- 插件四工具落地（`plugins/dsh-shorekeeper-reading/`，10 条单测全绿，`tsc --noEmit` 零错）：数据层与导出器落点一致（`$DSH_HOME/data/reading`）；进度记录联动书架状态机（想读→在读，100%→读完）；书名模糊匹配唯一命中、歧义反问；ask 为本地检索（摘抄+书目），记忆插件检索留 ⏸ 接口。
- ⏸ 待办：~~真实书架数据回归~~（见下条）、听书模式（T4/T1）、k20 字幕联动（T2 提案路由）、记忆联动（T3 选型）。

### 2026-11-03 · 值班 agent · 真实数据回归完成（闭环一条验收 ⏸→✅）
- 本机真书架（`~/.config/dock-hub/books`：1 本在读《我合成了全世界(王自律)》9.4MB + progress.json）完整走了一遍导出器：dry-run → 导出 → 幂等二跑（backup/ 时间戳目录生成 ✓）；迁移报告零未识别字段、零异常条目、fidelity=approx（系统 python 无 zh_chapter_splitter，符合预期并如实标注）。
- **真数据暴露一个集成 bug 并已修复**（a1b9dbe）：导出器 render_shelf 的真实 schema 是 progress 嵌套书对象（percent/chapter_title/char_offset 在里面），插件数据层原按内部 _build_book 形状写（顶层 percent/chapters + 自造 progress.json 旁路）——自造夹具的单测测不出，真实数据一跑即现。已对齐真实契约、去旁路文件、夹具改为照抄真实导出记录；11 条单测 + ShelfStore 直指真实导出目录的端到端（查书/记进度页码保留迁移书签/摘抄/检索）全通。
- 抽查结论（对应验收标准「抽查 10 本」）：当前书架仅 1 本，全字段核对无损（title/author 拆分、offset→percent 17.64%、章节 217 章、sha256/bytes）；书架扩充后按同流程再抽查。
- 2026-11-04（W3 对齐）：分支 T5-reading 已合入 main（b1bb0db）；W10 实证书架/进度/摘抄/检索四工具全过（《世说新语》灌书）；人工项＝听书链路联调。

### 2026-11-05 · zcode · 听书三件落地（Z8，分支 fix/z8-reading-listen）
- **实现**：`src/speech.ts`（cutSentences/chunkReadText(120)/packReadChunks(36/52)/estimateReadSeconds，books-format §4 忠实移植+单测钉边界）、`src/tts-client.ts`（keeper-tts 直连：speech 带 play:true 服务端喇叭出声、stop 清队幂等；错误三分支 network/HTTP/超时都翻译成人话）、`src/listen.ts`（ListenState 沿迁移 listen-state.json schema——current_id/timer_min/books[offset]，迁移书签无缝续读；ListenEngine 逐段朗读+每段落盘 offset+deadline 定时+abort 打断）、`src/tools.ts` 增 reading.listen/stop/resume（未知书/无书文件/已在播三分支降级文案）、config 增 ttsBaseUrl/ttsSpeed（0.5–2.0 钳位）。
- **播放链定性**：keeper-tts 以 `--play` 起在 Mac Mini（server.py speak() 的 allow_play 语义实证），listening 直驱其服务端喇叭——与 T4 的 dsh-tts provider 桥分工：那是「她开口说话」，这是「读书」，不复用以免跨插件依赖。
- **验证**：typecheck 零错；vitest 27/27（含 abort 语义对齐真 fetch、deadline 绝对到期钩子、迁移 schema 往返）；全仓 check-all 全绿。
- ⏸ 留人工：真机听感（指定《世说新语》某章连读 ≥3 段、打断立即停的耳朵验收）；k20 字幕联动 ⏸（T2 提案路由）；读完沉淀记忆 ⏸（T3 选型后）。
