# 决策记录 · Shorekeeper

> T1 产出之一：dsh 版本、安装方式、各项选型与理由。方向性决策一律落在这里，不许口头定案（协作规则 §7）。
> 格式：`[D{n}] 日期 · 决策 · 理由 · 证据`

## 0. 环境基线

| 项 | 值 | 备注 |
|---|---|---|
| dsh CLI | `@deepseek-ai/dsh@0.2.1-rc.2` | npm 全局（/opt/homebrew），2026-11-02 已在机 |
| 最新 CLI | `0.2.1-rc.5`（2026-10-29 发布） | 暂不升，见 [D2] |
| DeepSeek Harness 桌面版 | `0.2.0-rc.2` | 漂泊者日常在用（profile `desktop`），与 CLI 互不影响（桌面版自带 runtime） |
| 实例布局 | 桌面版=日常 · `shorekeeper-lab` :3081=T1 实验场 · `web` :3080=预留日常亭子实例（T1 期间不启动，避免与桌面版混淆） | |
| 凭据面 | `~/.dsh/.credentials.yaml`（全局共享，各 profile 继承） | 米家/CalDAV/网易云登录待漂泊者提供 |

## 决策

### [D1] 2026-11-02 · 实验 profile 命名与创建方式
**决策**：T1 实验实例用独立 profile `shorekeeper-lab`，由 `dsh --profile shorekeeper-lab --from-default-profile web` 从官方 web 模板克隆；日常 `web` profile 保持零插件不动。
**理由**：实验崩了重建即可，不污染日常；`--dump-config` 可干跑验证。
**证据**：`~/.dsh/profiles/shorekeeper-lab/` 已建，:3081 正常启动（见 T1 验收记录 §阶段一）。

### [D2] 2026-11-02 · dsh 版本暂锁 0.2.1-rc.2，bundles 不写版本号
**决策**：CLI 保持 0.2.1-rc.2；profile 的 `dsh.profile.bundles` 保持 versionless（`@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app`）。
**理由**：versionless bundle 在启动时从 dsh 全局安装解析，天然与 CLI 同版本线，这是官方模板的姿势。实测显式写 `@deepseek-ai/dsh-base@0.2.1-rc.2` 反而无法解析（bundle 解析按名字匹配 profile node_modules 或 dsh 安装，带版本号两处都找不到）。
**证据**：/tmp/dsh-lab-3081.log「cannot resolve profile bundle "@deepseek-ai/dsh-base@0.2.1-rc.2"」；还原 versionless 后干净启动。
**遗留**：rc.3–rc.5 存在，升级决策留到 T8（升完跑一遍兼容矩阵）。

### [D3] 2026-11-02 · profile pnpm linker 改 isolated（兼容配方）
**决策**：profile 的 `pnpm-workspace.yaml` 删掉模板默认的 `nodeLinker: hoisted`（保留 `autoInstallPeers: false`），即用 pnpm 默认 isolated linker。
**理由**：hoisted 会把生态插件依赖的老版 `@deepseek-ai/*` 包（如 dsh-weather 依赖的 dsh-tools@0.0.1-rc.1）提升到顶层，**劫持 base 的 tools 行解析**，导致整个 profile 的基础工具行被禁用；isolated 下老依赖嵌套在各自插件目录内，base 从 dsh 安装解析，其余行全部正常。
**证据**：hoisted 装入 dsh-weather 后 boot log 出现 `disabling profile plugin row "tools"`；改 isolated 后仅 weather 自身行报错，base 完好。
**影响**：`profile/` 一键安装脚本必须带上这份 pnpm-workspace.yaml（T8）。

### [D4] 2026-11-02 · dsh-weather 0.1.0 判死刑（0.1.x 线产物）
**决策**：弃用 `dsh-weather@0.1.0`，候选替换：`dsh-tool-weather@0.2.3`（模型侧工具）+ `dsh-weather-panel@1.8.0`（侧边栏面板，含中央气象台预警/台风路径）。实测后定稿。
**理由**：dsh-weather 0.1.0（2026-08-14 发布，唯一版本）依赖 `@deepseek-ai/dsh-tools@^0.0.1-rc.1`，该老版 dsh-tools 从运行时 dsh-llm import `CallId`——0.2.1-rc.2 已无此导出，import 即崩。isolated linker 也救不了插件本体。
**证据**：boot log `SyntaxError: The requested module '@deepseek-ai/dsh-llm' does not provide an export named 'CallId'`。
**教训**：2026-08 中旬发布的插件一律怀疑是 0.1.x 线产物，装前先看依赖里的 `@deepseek-ai/*` 版本线。

### [D5] 2026-11-02 · 方案 v1 插件名单与 npm 实情对账（部分名字不存在）
**决策**：以 npm registry 为准修订名单。方案 v1 §1 里下列包名在 npm 上**不存在**（404，2026-11-02 查证）：
- `dsh-pc-manager` → 待定（监控候选只剩 dsh-vitals，见 T1 验证记录）
- `dsh-calendar-diary` → 无同名包；日记候选改为实测 `dsh-diary-memory` / `dsh-zdiary-kit` / `feiyu-memory` / `dsh-diary` 中符合「一天一条、可导入」的一个
- `dsh-mobile-notify` → npm 无包，目录缓存（awesome-dsh-plugin）里有 GitHub 源：`dsh plugin add github:zjhaaa042-cloud/dsh-mobile-notify`（0 star，谨慎）；Bark 专用件 `dsh-notify-bark@0.1.4` 在 npm
- `dsh-memory-center` / `dsh-full-life-memory` → 均不存在；记忆候选改为 `memsearch@0.0.3` / `feiyu-memory@4.0.2` / `dsh-diary-memory@0.2.10` / `dsh-daoing-memory@0.1.20`
- `dsh-system-hud` → 不存在（方案里本就是顺带一提）
**理由**：插件目录缓存（awesome-dsh-plugin，2026-10-22 快照，6378 条）里也查无 dsh-mihome / dsh-voice-mode / @doitian/dsh-music——方案调研来源与该目录不一致，但 npm 实查这几个存在。以 npm 实查为安装准绳，目录缓存只作发现渠道。
**证据**：npm view 404 输出（T1 验证记录）。

### [D6] 2026-11-02 · 米家路线候选修正：直连件是 dsh-mijia-sidebar，不是 dsh-mihome
**决策**：米家候选重排——`dsh-mijia-sidebar@1.0.1`（echochan，2026-11-02 发布，走 mijiaAPI Python 库直连米家云，扫码登录）为主候选；`dsh-mihome@0.1.3`（loki888666，走 Home Assistant REST + Xiaomi Miot Auto）为 Plan B。方案 v1 里「dsh-mihome（siriuswj，MIT）直连米家云，内置演示模式」的描述与 npm 实情不符：npm 的 dsh-mihome 是 HA 桥、无演示模式（只有 mock 冒烟脚本）。
**理由**：直连路线不养 HA，凭据由 mijiaAPI 自管（`~/.config/mijia-api/auth.json`）；HA 路线稳但要多养一个服务。
**待验证**：mijia-sidebar 是「面板不经大模型」，是否同时暴露 agent 工具（守岸人要能用嘴控灯、读温湿度计）→ 源码确认中；若无 agent 工具面，则需评估 mihome(HA) 或自写薄工具层。
**风险**：米家扫码登录必须漂泊者本人操作（T1 验收记录标注）。

## 2026-11-03 追加（T1 阶段二/三，本会话）

### [D7] 2026-11-03 · CLI 实况已是 0.2.1-rc.5，[D2]「暂锁 rc.2」被超越，升格为基线
**决策**：不回滚 rc.2，以 rc.5 为 T1 基线继续；升级评审仍留 T8。
**理由**：全局 npm 实测 `@deepseek-ai/dsh@0.2.1-rc.5`（何时升的未考，2026-11-02 晚已如此）。lab profile 全部 12+1 插件在 rc.5 上零报错加载（boot log `grep -icE 'error|disabling'` = 0），[D3] isolated 配方在 rc.5 上依然成立。
**证据**：`dsh --version` → 0.2.1-rc.5；/tmp/dsh-lab-3081.log。
**顺带实锤**：versionless bundle 解析地= `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（306 包，含 dsh-base/dsh-web-app/dsh-headless），不在 profile node_modules。

### [D8] 2026-11-03 · profile 模型凭据机制：llm-pi-ai 服务 + refs 命名条目 + apiKeyEnv 按名解析
**决策**：web profile 的自定义模型 provider 由 `llm-pi-ai`（`@deepseek-ai/dsh-llm-pi-ai`）服务管理：设置 UI「添加模型提供商」= 写 profile `cordis.patch.yml` 受管条目（`providers.<id>.apiKeyEnv`）+ 把密钥写进 `~/.dsh/.credentials.yaml` 的 `refs.<名>`；`apiKeyEnv` 只存**变量名**，解析源是 refs（headless profile 不读凭据库，只认进程环境变量）。agent 请求 max_tokens 默认取模型元数据上限，OpenRouter 余额不足即 402——**必须用 `modelOverrides.<modelId>.maxTokens` 压顶**（本 lab 配 16384）。
**理由**：一开始 patch 到 `llm` 服务无效；UI 保存动作揭示真实归属。lab 实例已用 refs 机制跑通 OpenRouter `deepseek/deepseek-v4.1-flash-1017`。
**证据**：UI 保存后 cordis.patch.yml 出现 `llm-pi-ai` 条目；refs 覆写前后对比；402 报文与 override 后成功（16.1K tok / 408 tok/s）。
**教训**：①refs 是 UI 的密钥落点，**改前先备份**——本次测试假 key 一度覆写真 key，靠运行中进程 env 才恢复；②凭据值永不进仓库/文档/agent 上下文，一律文件内 sourcing。

### [D9] 2026-11-03 · 天气终选：dsh-glass-weather + dsh-weather-panel 双装
**决策**：装 `dsh-glass-weather@0.3.0`（顶栏玻璃胶囊 + `get_weather` agent 工具）与 `dsh-weather-panel@1.8.0`（侧栏面板，预警）；`dsh-tool-weather@0.2.3` 不装（工具面与 glass-weather 重复）；[D4] 对 dsh-weather 0.1.0 的死刑维持。
**理由**：实测 get_weather 上海/北京真实实况+多日预报（免密钥数据源），胶囊实况同步（霾 8° 黄色预警与实况一致）；双装各管 UI 与工具面，无冲突。
**证据**：agent 三轮工具实测返回（T1 验收记录 §天气）。

### [D10] 2026-11-03 · 记忆终选：feiyu-memory@4.0.2
**决策**：记忆插件选 `feiyu-memory@4.0.2`；`memsearch@0.0.3` 死刑（npm 误会——它是堆快照查重的调试 CLI，非记忆插件，已从 lab 卸载）；`dsh-daoing-memory@0.1.20`、`dsh-diary-memory@0.2.10` 不装（前者审计账本/经验体系超出岸亭需求，后者「百炼检索」存云依赖嫌疑，均未实测）。
**理由**：召回闭环实测逐字通过（种一条「青色灯塔」日记 → 新会话「我最喜欢什么？」→「你最喜欢海边的灯塔，尤其是青色的光」）；密钥硬拦实测有效（「口令是××」被 [已拦截] 打码——按设计工作）；本地 jsonl 档案格式公开可迁移，与 tavern 无冲突。人格+日记+索引+遗忘降权的哲学与岸亭周报（数据源=memory，见 a90fdb2）天然衔接。
**边界**：写侧（轮末固化「你想记什么」）在 headless 一枪模式不触发（进程即退），需 web 会话——真机写侧验证移交漂泊者（一条浏览器对话 + 看 `~/.dsh/feiyu-diary/日记.md`）。

### [D11] 2026-11-03 · 通知终选：dsh-notify-me 单件
**决策**：通知选 `dsh-notify-me@1.17.0`；`dsh-notify-bark`、`github:dsh-mobile-notify` 不装（notify-me 内建 Bark/Discord/Gotify/飞书/Server酱/WxPusher/Webhook 全渠道外部推送 + 审批快捷裁决）。
**理由**：README 实证覆盖 D5 全部通知候选能力；本机系统通知与「试一试」测试按钮移交漂泊者验收（需 macOS 通知权限）。

### [D12] 2026-11-03 · 米家定案：mijia-sidebar（面板）+ 自写薄工具层，mihome(HA) 仍为 Plan B
**决策**：`dsh-mijia-sidebar@1.0.1` 保留为设备面板；**它没有 agent 工具面**（源码实锤：node 壳 + `state.py` 一次性调 mijiaAPI CLI，描述自认「no model round-trip」，无任何工具注册）——守岸人「用嘴控灯/读温湿度计」由自写薄工具层承接（直调 mijiaAPI，与 k20 网关同批，T2/T7 落地）；`dsh-mihome@0.1.3`（HA 桥）维持 Plan B。
**理由**：[D6] 待决问题「是否有 agent 工具」答案为否；直连路线凭据与面板共享 `~/.config/mijia-api/auth.json`，薄工具层零额外凭据。未装 mijiaAPI、未扫码——真机控灯验收移交漂泊者。
**证据**：`node_modules/dsh-mijia-sidebar/lib/index.js` 无工具注册；`parse.js` exit code 3/4/5 引导装依赖/扫码。

### [D13] 2026-11-03 · voice-mode 无自定义 TTS 扩展点，T4 预案触发
**决策**：`dsh-voice-mode@0.7.34` 的 `ttsEngine` 是封闭枚举 `edge | vits | kokoro`（z.union 源码实锤），**没有**自定义/HTTP/OpenAI 兼容 TTS provider 接入面。keeper-tts（Qwen3-TTS 克隆音色）无法按方案 v1 的「注册为 provider」路径接入 → T1 风险表预案触发：T4 改为全量自写语音链路，或 fork voice-mode 加引擎（二选一由 T4 决策）。
**理由**：voice-mode 其余能力优秀（流式 ASR zipformer2+SenseVoice、Silero VAD 帧级 barge-in、字幕浮层、唤醒词、让位语义、免密钥默认路径），若 T4 自写只换 TTS 腿，STT/打断/字幕可参考其实现或保留其前端。全双工语音对话的真人体验验收移交漂泊者。
**证据**：`node_modules/dsh-voice-mode/lib/index.js` 两处 `z.union([z.const("edge"), z.const("vits"), z.const("kokoro")])`；无 custom/openai TTS 端点代码。

### [D14] 2026-11-03 · 角色卡宿主保留 dsh-tavern@2.7.26；声明机制与冻结 bug 记录
**决策**：dsh-tavern 保留（roleplay / pmp-dsh-tavern 不再对比安装：tavern 工具面+管理台+组合机制已充分验证，且 T3 依赖其世界书触发/开场白注入能力）。**本版 DSH 已不读 `.agent-presets/` 目录**——酒馆预设要出现在顶部选择器，必须在 profile `cordis.patch.yml` 写声明行（`- insert: [{id: preset-<id>, name: '@deepseek-ai/dsh-agent-preset', config: {..., plugins: <组合>}}]`，出厂四预设同款）。组合本体（persona 写作要求 + 工具组）在 headless 无浏览器实测有效（守岸人测试卡人设回复逐字命中）。
**Bug 记录**：ZCode 内置浏览器（IAB）中 dsh-tavern 2.7.26 两次 100% 冻结渲染进程（「声明为 DSH 预设」预览环节、选中酒馆预设开新会话时），服务端无异常（CPU 1.1%，log 干净）——是否 IAB 特有待漂泊者在真实 Chrome 复测；浏览器流程不可用时声明可手工补写（本次即手工完成）。
**证据**：tavern 源码注释（2026-09-27 查证 dsh-agent-preset SKILL.md「Nothing reads that directory any more」）；手工声明后选择器出现「酒馆默认」；headless 回复「我是守岸人，一款来路不明的测试用酒馆助手」。

### [D15] 2026-11-03 · 日记归属：记忆承担，dsh-diary 仅备选
**决策**：不装独立日记插件。传统「一天一条」日记由 feiyu-memory 的日记档案承担（`~/.dsh/feiyu-diary/diary/YYYY-MM.jsonl`，格式公开、可导入——岸亭 diary.py 的 xlsx 迁移在 T3/migration 时写入该格式）；`dsh-diary@0.1.1`（markdown 逐日）与 `dsh-zdiary-kit@1.0.0`（zk 知识库）记录为备选，均不装。`dsh-calendar-diary` 维持 [D5] 无同名包结论。
**理由**：周报数据源已改为 memory（a90fdb2）；feiyu 日记即记忆本体，避免双份记忆系统。

## 待决清单（T1 结束前清零）
- [x] 天气：glass-weather + weather-panel 双装，tool-weather 不装（D9）
- [x] 监控：dsh-vitals macOS 可用（CPU/内存/GPU ✓，温度/功耗 Linux-only 优雅降级）
- [x] 米家：mijia-sidebar 无 agent 工具面 → 面板+自写薄工具层（D12）
- [x] 记忆：feiyu-memory（D10；memsearch 系误会判死）
- [x] 语音：voice-mode 无 TTS 扩展点 → T4 全量自写或 fork（D13）
- [x] 角色：dsh-tavern 保留，声明机制摸清（D14）
- [x] 通知：dsh-notify-me 单件（D11）
- [x] 日记：feiyu 日记承担，dsh-diary 备选（D15）
