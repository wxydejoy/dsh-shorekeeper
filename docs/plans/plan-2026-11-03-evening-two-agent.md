# 待办更新 · 双人分工（2026-11-03 傍晚）

> 输入：确认单 [confirmations-2026-11-03.md](../confirmations-2026-11-03.md)（提交 30239d4，A 组全部拍板）、
> [decisions-wechat-route-v2.md](../decisions-wechat-route-v2.md)（18:30 更新：主路线改个人微信扫码）。
> 取代 [plan-2026-11-03-night.md](./plan-2026-11-03-night.md) 的 P0–P3 顺序——那份的「明确不做」「漂泊者答复」部分仍有效，冲突处以确认单为准。
> **本轮只落文档，不动代码、不装插件。**

---

## 一、待办总表（拍板后的全集）

| # | 待办 | 来源 | 验收线 | 依赖 |
|---|---|---|---|---|
| W1 | k20 测试 4 处类型错修红；`check-all.sh` 补进 desk-mi，全绿 | 夜计划 P0 | `bash scripts/check-all.sh` 输出全部绿色 | 无 |
| W2 | **守岸人运行面迁移**：把 shorekeeper-lab 上在用的插件迁装进 **web profile（:3090）**——feiyu-memory、dsh-mijia-sidebar（desk-mi 工具）、自写 k20 / keeper-voice / reading（~~wechat~~ 跳过，入口已由 dsh-plugin-weixin 承担）、按需 calendar；迁移后 :3090 冒烟：k20 工具面可见、reading 能读书、`/v1/audio/speech` 出音频、米家只读正常 | 18:35 漂泊者：收敛到 web profile | 四件冒烟各过，web profile 的守岸人功能面 ≥ 迁移前 | W1 |
| W2a | **删除 shorekeeper-lab profile**：删除前先归档——已装 bundle 清单、cordis.patch.yml、迁移用到的配置写进 docs/profile-shorekeeper-lab-archive.md；确认无独占数据（凭据在 ~/.dsh 全局、日记迁移已做、会话不保留）后删除 profile 并停掉 :3081 实例 | 18:35 漂泊者：删多余 profile | 归档文档落 docs、:3081 不再监听、web profile 不受影响 | W2（迁完才删） |
| W3 | 任务书状态头对齐 + 清 `.worktrees` 误跟踪文件 + refactor-map 状态列 | 夜计划 P2 | 状态与 git log 一致，`git status` 干净 | 无 |
| W4 | **T6 装前体检**：`dsh-wechat@0.15.0` 装进实验 profile，看 boot log 有无 disable/报错；不过则依次试 dsh-plugin-weixin@1.4.3 → dsh-wechat-plugin@0.47.0 | v2 路线 18:30 更新 | 体检报告落 docs：加载成功/失败 + 原因 | ✅ **已完成（漂泊者，18:3x）**：实装 **dsh-plugin-weixin@1.4.3** 进 **web profile**（:3090）并扫码打通——体检结论：iLink 个人微信路线可用，选型落地即此包 |
| W4a | ~~装进 shorekeeper-lab~~（已取消）→ **人格绑定**：在 web profile 上把 T3 守岸人角色卡/预设绑到微信会话，让微信那头的会话以守岸人口吻说话 | 18:33 漂泊者拍板：不用独立 profile，就用 sessions 里的微信会话当守岸人对话 | 微信私聊回复是守岸人口吻（角色卡/世界书生效） | 无 |
| W5 | **T6 接线验收**：联系人 allowlist → 工具审批链路验证 | 确认单 A1/D5、C4 | 手机微信私聊她按**守岸人**口吻回；白名单外不答；重启会话续 | W4a |
| W6 | **k20 真机联调**：k20.lan（管理员授权已给）——字幕、屏状态、背景/布局/媒体键/熄屏六工具真机各过一遍 | 确认单 C3 | 六工具真机各出一次可观察效果 | W2 |
| W7 | **唤醒词路线甲落地**：k20 本地「小岸」唤醒 → 推文本进会话 | 确认单 A2 | 真机喊「小岸」→ 屏上出字并进入会话 | W6 |
| W8 | **dock 手动迁移**（两分支不合，按 A3）：从 `hub-slim` 摘 caption/layout/lock 三条路由；从 `tts-openai-endpoint` 摘 keeper-tts 的 OpenAI 兼容端点；分支保留原样 | 确认单 A3 | 摘出的改动以独立提交落在 dock main，dock 测试全绿 | 无 |
| W9 | **keeper-tts 拉起 + 音色对比**：用 `dock/companion/tts/voices`（C1）做素材，keeper-voice 三工具过一遍 | 确认单 C1；B3 编码完成即可不真人实测 | TTS provider 注册成功、能合成出音频 | W8（OpenAI 兼容口）或 W2 |
| W10 | **阅读灌书**：随便找一本公版小说，从第一章灌进书库（C2：不用记录真实书库路径） | 确认单 C2 | 书架可见、进度/摘抄/检索四工具对这本书各过一次 | W2 |
| W11 | **feiyu 写侧自验**（B5）：驱动 :3081 聊一轮，看 `~/.dsh/feiyu-diary/日记.md` 长不长条目，结果回填确认单 | 确认单 B5 | 确认单 B5 区块落「已验 + 证据」 | W2 |
| W12 | P3 里程碑材料：M2 判定更新 + push 前清单 | 夜计划 P3 | 材料落 docs，push 按「绿了才推」执行 | W1–W3 |

不做（已拍板）：F17 灯带变色（A4 关闭）、宣传片 429 横幅（A5 先不做）、CalDAV（B1 先空着）、dsh-im 一步到位（v2 §6）。

---

## 二、分工

按「**仓库实例** vs **真机外部**」切，两人互不踩同一台机器上的同一层：

### 甲 · 仓库与实例线（Mac 本机，dsh-shorekeeper 仓库 + :3090）

负责：**W1 → W2 → W2a → W4a → W5**，以及 **W10、W11、W12**。

- 特点：全在仓库和 profile 里打转，改代码、装插件、跑测试、写文档。
- 关键产出：全绿的 check-all、守岸人运行面收敛到 web profile、shorekeeper-lab 删除且归档在案、微信会话人格绑定与验收、确认单 B5/W11 回填。
- 交接物：W2 完成后冒烟记录（四件各一行证据），给乙的 W6 用。

> **profile 收敛（18:35 定案）**：**web profile（:3090）是守岸人唯一主实例**，微信（dsh-plugin-weixin）与桌面客户端都指它。
> shorekeeper-lab（:3081）**迁完即删**（W2a），不再是实验实例；以后实验需求直接在 web profile 上用会话隔离，或另开一次性 profile，不再常驻。

### 乙 · 真机与外部线（k20 真机 + dock 仓库 + TTS）

负责：**W6 → W7**（k20 全链）、**W8 → W9**（dock 迁移与语音）。

- 特点：动的是 k20.lan 真机和 dock 仓库，不碰 shorekeeper-lab profile。
- 关键产出：k20 六工具真机验收记录、唤醒词路线甲的可运行落地、dock main 上的两块手动迁移提交。
- 交接物：W6 验收记录给甲的 W12；W8/W9 完成后 dock 测试全绿证明。

### 依赖与并行关系

```
甲：W1 ──▶ W2 ──▶ ┬─▶ W4 ──▶ W5（等扫码）   ┬─▶ W12
                  ├─▶ W10                   │
                  ├─▶ W11                   │
                  └─▶ W3                    │
乙：W8 ──▶ W9          W6（等甲的 W2）──▶ W7  │
                                            ▼
                                    全部收口 → W12 push 清单
```

- **开跑即并行**：甲从 W1 开始，乙从 W8 开始（互不依赖）。
- **乙的 W6 等 W2**：k20 插件没进实例前真机联调无意义；甲完成 W2 在本文档「进度」区写一行，乙再动。
- **W5 卡人**：扫码必须漂泊者本人，甲做到「插件待配置」即暂停挂起，不空转。

---

## 三、纪律（与夜计划一致，重申三条）

1. 各自在自己的任务分支上改，合 main 前 `check-all.sh` 必须全绿；绿了可推（既有授权仍有效）。
2. 凭据只进 `~/.dsh/.credentials.yaml`（D6）；个人微信**只挂非主力号**（D5 附带条件）。
3. 每完成一项 W，把一行结论追加到本文末尾「进度」区——**进度区是两人的唯一交接板**，别只在对话里说。

## 四、进度（两人逐项追加，格式：`W# · 时间 · 谁 · 一行结论`）

- W4 · 2026-11-03 18:32 · 漂泊者 · 部分完成但装错位置：dsh-plugin-weixin 装进了 web profile 并扫码打通（体检结论：iLink 路线可用）；**shorekeeper-lab 未装**，需 W4a 纠偏 + W5 重接，web profile 那份去留待定（默认保留，与守岸人线互不影响）
- 定向 · 2026-11-03 18:33 · 漂泊者 · **不再用独立 profile**：就用 web profile 里 sessions 的微信会话作为守岸人对话；W4a 从「装进 shorekeeper-lab」改为「web profile 上做人格绑定」，W2 跳过自写 wechat 插件，shorekeeper-lab 降级为实验实例（不拆）
- 修向 · 2026-11-03 18:35 · 漂泊者 · **删掉多余 profile**：shorekeeper-lab 不再保留，改为「迁移 → 冒烟 → 归档 → 删除」四步（W2 + W2a）；全部收敛到 web profile，:3081 实例退役
- W1 · 2026-11-03 23:12 · 甲 · 修红全绿：k20 四处类型错修掉（caption 回读 scale、snapshot.lock.requested_at、布局写入改部分矩形补丁型——集成测试曾对真网关 8/8 过，类型过期测试未动）；desk-mi 补齐 dsh-tools 三枚 peer 依赖后入 check-all；`bash scripts/check-all.sh` 12 项全绿（分支 fix/w1-check-all-green 9f968d4，未推）
- W2 · 2026-11-03 23:45 · 甲 · **迁移装机完成，冒烟三过一挂**：feiyu-memory@4.0.2、dsh-mijia-sidebar@1.0.1 + 自写四件（link: 链接）进 web profile，:3090 起实例；冒烟 ①k20 六工具全注册 ✅ ②reading 真书架《我合成了全世界》17.87%/第223章 ✅ ④米家只读 21 台真设备 + 卧室 24.8°C/62% ✅ ③`/v1/audio/speech` ⏸ keeper-voice 三工具注册且 keeper-tts /health 绿（shorekeeper 克隆就绪），但该端点在 dock `tts-openai-endpoint` 分支未合 main（A3 定 W8 手动迁移），**W8 落地后重测补证**。踩坑已回灌 install.sh（file:→link:，TS 参数属性禁令），插件代码修复在 fix/w2-node-ts-compat（c370c25、0f9416d，未推）。calendar 按需未装（暂无需求）。**W6（乙）可开工：k20 工具面已就绪**；踩坑另录：ShelfStore 启动时读盘，灌书后须重启实例
- W11 · 2026-11-04 00:15 · 甲 · **feiyu 写侧打通并修一真 bug**：:3090 聊三轮日记 5→7 条（含青岛行程 salience 0.60），B5 已回填确认单。根因链：feiyu 固化 `reasoningEffort:"off"` 被 zhipu/GLM-4-Flash 拒（UNSUPPORTED_REASONING_EFFORT 以 finish chunk 到达）+ feiyu 错误识别读错字段（`finish.kind` ≠ `finish.reason.kind`）→ 兜底重试死代码、写侧全静默（lab 走 openrouter 无碰撞故未暴露）。修复：web profile 对 feiyu@4.0.2 打 pnpm patch（chunk 形态失败识别 + 触发既有退档重试），证据与 mitm 抓包在确认单 B5；**待办：给 feiyu 上游提 issue**。补总结 backfill 待下次启动自跑，未逐条验
- W2a · 2026-11-04 00:18 · 甲 · **shorekeeper-lab 已退役**：归档先行——[docs/profile-shorekeeper-lab-archive.md](../profile-shorekeeper-lab-archive.md)（bundle 清单、cordis.patch.yml 全文、迁移去向映射、独占数据核查七项全过）+ 配置备份包 `~/.dsh/backups/shorekeeper-lab-profile-2026-11-04.tar.gz`；kill PID 85541 → rm profile 目录 → 复核 :3081 无监听、:3090 web 完好（HTTP 303 正常）。tavern/music/voice-mode 等 9 件生态插件随 profile 退役（数据在全局未动）；守岸人三预设 persona 文本已存档供 W4a 取用。shorekeeper-hl 不在 W2a 范围、未动
- W4a · 2026-11-04 00:30 · 甲 · **人格绑定装配完成，待真机口吻验收**：dsh-tavern 因 B4 冻结且随 lab 退役，改走 weixin 插件自带的自定义模式通道——T3 角色卡（character.json description/personality）+ 世界书两条常驻（意图分流/问句预算）合成「守岸人」自定义模式写入 `~/.dsh/weixin/persona-modes.json`（16 模式，UI 个性化页签已见卡），私聊覆盖键 `339bb4cde726@im.bot|` 由「女友」切到 shorekeeper（原值备份 /tmp/persona-*.backup.json，微信里 `/mode 默认` 可随时退回）。**W5 验收时若口吻偏差，调 persona-modes.json 的 prompt 即可**；tavern 全量卡/世界书待 B4 解冻后再上（资产在 .worktrees/t3/content/shorekeeper-card/，T3 分支）
- W10 · 2026-11-04 00:40 · 甲 · **灌书完成，四工具全过**：公版志人小说集《世说新语》（刘义庆，南朝宋）从第一章「德行第一」起全文灌入（古诗文网取文，36 门 78,508 字，sha256 记于 shelf migrated 段）；书架两本可见、progress 记到德行第一 2%、note 摘抄「陈仲举言为士则…」落盘、ask 检索「陈仲举」命中原文。踩坑：书架文本源站点多被网络策略拦截（wikisource/gutenberg/marxists 全灭），gushiwen.cn 可达遂选之。C2 约定遵守（未记录岸亭真实书库路径）。ShelfStore 启动读盘：灌书后重启了一次实例
- W12 · 2026-11-04 00:45 · 甲 · **M2 判定材料更新 + push 前清单落档**（merge-review-m2.md 新增章节）：判定线从「三支合完+A组过半」推进为「九支全合+装机自检实证」，证据索引表七行；待人工项四组（W5 口吻真机 / W6·W7 真机 / W8·W9 dock 与 TTS / B 组余项）；push 前清单列四分支（fix/w1 → fix/w2 栈式、docs、chore）+ 合并后重跑 check-all（fix/w2 上已复跑 12 项全绿）→ **绿了才推，push 点头归漂泊者**。甲线到此收口：W1✅ W2✅（③挂起等W8） W2a✅ W4a✅（口吻待W5） W3✅ W10✅ W11✅ W12✅；**W5 挂起等手机私聊**
- W12 · 2026-11-04 00:45 · 甲 · **M2 判定材料更新 + push 前清单落档**（merge-review-m2.md 新增章节）：判定线从「三支合完+A组过半」推进为「九支全合+装机自检实证」，证据索引表七行；待人工项四组（W5 口吻真机 / W6·W7 真机 / W8·W9 dock 与 TTS / B 组余项）；push 前清单列四分支（fix/w1 → fix/w2 栈式、docs、chore）+ 合并后重跑 check-all（fix/w2 上已复跑 12 项全绿）→ **绿了才推，push 点头归漂泊者**。甲线到此收口：W1✅ W2✅（③挂起等W8） W2a✅ W4a✅（口吻待W5） W3✅ W10✅ W11✅ W12✅；**W5 挂起等手机私聊**
- W8 · 2026-11-04 01:00 · 甲（代乙线起步）· **dock 手动迁移完成（A3，两笔独立提交落在 dock main，分支原样保留）**：0d422c1 hub-slim 摘入——/v1/caption、/v1/phone/layout、/v1/lock 三条路由 + retire 五组闸门（server.py 同 diff 交织拆开会造未测变体，A3 原批注即整包）+ lan-protocol/openapi 同步；c01067f tts-openai-endpoint 摘入——keeper-tts OpenAI 兼容 POST /v1/audio/speech + 8 单测。测试：hub 1188 全绿（uv run，CI 同款跑法）+ tts 端点 8/8 绿。两分支相对 main 已无独有内容（残差为对方基线交叉噪声）。**注：dock 工作树里别人的未提交改动（android/console 若干文件）全程未碰**；00:59:42 :18100 被同伴进程重启（PID 38430，吃进新代码）——**乙线同伴在线，W8/W9 勿重复做**
- W9 · 2026-11-04 01:05 · 甲 · **keeper-tts 拉起 + 合成实证，验收过**： keeper-tts 已带 W8 端点重启（/health ready:true，shorekeeper 克隆音色）；POST /v1/audio/speech 实测 HTTP 200、184,364 字节有效 WAV（RIFF PCM 16bit mono 24kHz，3.3s）——「能合成出音频」实证；音色对比真人项按 B3（编码完成即可不真人实测）豁免。keeper-voice 三工具在会话内多轮真实调用（15 轮 17 步，无工具报错），但 GLM-4-Flash 三轮把调用记号当回复贴、未能展开结果对象——工具薄客户端所打端点与上述 curl 同路径，分层证据成立；模型复述习惯问题留给后续调优
- W2 · 2026-11-04 01:05 · 甲 · **冒烟③补测通过——四件全过**：keeper-tts 带新端点重启后，POST /v1/audio/speech 200（184KB WAV）——原挂起项闭合，W2 验收线（四件冒烟各过）达成
- W6 · 2026-11-04 01:05 · 甲 · **挂起：k20.lan 不可达**（health 5s 超时 000）——真机设备此刻离线/休眠，六工具真机各过一遍需设备在线（lock 熄屏项还需漂泊者点头开闸）；工具面与占位配置已就绪（W2），乙线设备就绪即可开跑
