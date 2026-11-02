# 岸亭 → DSH 原生替代 · 计划 v1

> 2026-11-02 · 状态：**当前版本，取代 [v0](dsh-plugins-v0.md)（桥接方案已废弃）**
> 核心转变：**不做桥接。** 岸亭的「大脑、人格、感知、生活仪式」全部搬进 DSH 插件原生实现；只有「语音大模型、传感器采样」这类必须独立进程的，保留为外部程序由插件驱动。凡 DSH 生态已有插件的，优先复用生态件，不重复造轮子。

---

## 1. 生态检索结论（2026-11-02 实测调研）

以下插件全部检索自 DSH 插件目录与 awesome 列表，安装命令均为社区标准形式。**复用优先级：✅ 直接用 / 🔧 改造或补桥 / ❌ 自写。**

### 1.1 能直接替代岸亭现有功能的

| 岸亭原功能 | 生态插件 | 要点 | 结论 |
|---|---|---|---|
| 米家控制（mijia_bridge ~1000 行） | **dsh-mihome**（siriuswj，MIT） | 直连米家云，列设备/读状态/控制（自带审批闸门）/状态轮询/Web 仪表盘，内置演示模式可无账号开发 | ✅ 首选；备选 dsh-homeassistant（走 HA 的 Xiaomi Miot Auto，更稳但要多养一个 HA） |
| 室外天气 | **dsh-weather**（QianLuo-Ly） | Open-Meteo 免费、无 API key、多城市管理、恶劣天气提醒、每日简报 | ✅ |
| PC 监控（mini + win 探针的监控部分） | **dsh-vitals** / **dsh-system-hud** / **dsh-pc-manager** | CPU/内存/温度/GPU/磁盘/进程表，Linux/macOS/Windows 全支持；dsh-vitals 有会话头部小部件 | ✅ 替代两个探针的**上报**用途 |
| 音乐播放 | **@doitian/dsh-music**（网易云 + AI DJ，7 个 agent 工具）/ dsh-music-dock / dsh-netease-music | 比 dock 主屏三个按钮强一个数量级 | ✅ |
| 守岸人对话全双工（听完→念→打断→字幕） | **dsh-voice-mode**（qishuilalala） | 流式本地 STT（zipformer2/SenseVoice）+ Edge TTS/本地 VITS/Kokoro + **barge-in 打断** + **实时字幕浮层** + 免提自动发送——正是岸亭语音链路的形态 | ✅ 作骨架，音色另接（见 1.2） |
| TTS 引擎面 | **@goodandready/dsh-tts** | 多 provider 回退链、流式 <300ms、子代理分音色、发音词典 | 🔧 与 voice-mode 二选一或叠装 |
| 人格/角色 | **dsh-tavern** / **dsh-roleplay**（Tavern 角色卡 V2/V3）/ dsh-liketavern | 角色卡 + 世界书 + 预设 + 长期记忆——persona.py 的工作变成「写角色卡」而非「写代码」 | ✅ |
| 长期记忆 | dsh-memory-center / dsh-full-life-memory / dsh-memory-evolve / memsearch 等 | 生态过饱和，选型即可 | ✅ T3 里做选型 |
| 日历 | **dsh-calendar**（CalDAV，月/周视图+空闲查找+写入前确认） | 替代 calendar.py | ✅ |
| 日记 | **dsh-calendar-diary**（本地 xlsx，一天一条，导入导出） | diary.py 数据可导成 DesktopCal 两列 xlsx 直接吃进去 | ✅ |
| 通知推送 | **dsh-mobile-notify**（ntfy/Bark/钉钉/企微/飞书/Server酱/Telegram 等 10 渠道） | 任务完成/出错推手机 | 🔧 可选增强 |

### 1.2 生态没有、必须自写的（岸亭真正的独特性）

| 缺口 | 为什么没有 | 自写形态 |
|---|---|---|
| **k20 安卓屏驱动** | 自有硬件 + 私有 LAN 协议 | `dsh-shorekeeper-k20`：字幕/背景/模块编排/熄屏/媒体键全套工具 |
| **守岸人克隆音色** | 自有 Qwen3-TTS 克隆服务（`:18100`） | `dsh-keeper-voice`：把克隆 TTS 注册成 voice-mode / dsh-tts 的自定义 provider（**用户认可：语音大模型作为独立程序保留**） |
| **室内温湿度/自有传感器** | 传感器是自有的，dsh-weather 只有室外 | `dsh-desk-senses`：小传感器采样桥 + 事件注入 |
| **周报/生活仪式** | weekly.py/books.py 的私域逻辑 | `dsh-desk-life`：数据迁移导入器 + 仪式 skill |
| **Windows 白名单程序启动** | win 探针私有功能 | 并入 k20 网关或 dsh-ops 补充 |
| **唤醒词「小岸」** | 自有 sherpa-onnx 唤醒模型 | 决策点：安卓端保留唤醒→推文本，或迁移到 voice-mode 的免提模式 |

### 1.3 岸亭退役清单（被上面替代后）

`mijia_bridge/mijia_catalog`、`persona/companion_flow/intents`（大半）、`reads` 天气部分、`media/music`、`calendar/diary/weekly` 存储层、mini 监控、win 探针 CPU 上报、console 大部分（DSH Web UI + 插件卡片接管）。**Hub 缩减为：k20 屏网关 + 传感器采样**（见 T7）。

---

## 2. 目标架构

```
漂泊者
 ├── dsh（Mac Mini, web profile） ← 新大脑
 │    ├── [生态件] mihome / weather / vitals / music / voice-mode
 │    │            tavern(守岸人角色卡) / memory / calendar / mobile-notify
 │    └── [自写件] dsh-shorekeeper-k20 / dsh-keeper-voice / dsh-desk-senses / dsh-desk-life
 │
 ├── keeper-tts（:18100，独立进程，Qwen3-TTS 克隆音色）← 保留的外部程序
 ├── hub（瘦身版 Python：k20 屏网关 + 传感器采样）     ← 保留的外部程序
 └── k20 安卓屏 ← 只当「显示屏 + 麦克风」，大脑在 dsh
```

---

## 3. 工作目录与分支

```
独立仓库: dsh-shorekeeper（本仓库，与岸亭仓库 wxydejoy/Shoreting 分离）· 项目名: **Shorekeeper（守岸人）**
dsh-shorekeeper/
  README.md                # 插件族规范（apply(ctx)、Config schema、权限分级、测试约定）
  plugins/
    dsh-shorekeeper-k20/         # T2 安卓屏驱动（最大的自写件）
    dsh-keeper-voice/          # T4 克隆音色 provider
    desk-senses/           # T5 传感器桥
    desk-life/             # T6 仪式与迁移
  content/
    shorekeeper-card/      # T3 角色卡 + 世界书 + 预设（内容工程，非代码）
  profile/                 # 生态插件安装清单 + cordis.patch.yml + 一键安装脚本
  migration/               # diary/weekly/books 数据导出导入脚本（Python，一次性）
  reference/               # hub 关键 py 底料只读复制（对照协议与人格文案）
  docs/                    # 生态插件验证报告、决策记录
```

每任务一子分支：`T1-trial` … `T8-integrate`，合回 `main`。岸亭仓库的 `main` 不受影响。

---

## 4. 任务分解（8 个任务）

> 字段：目标 / 步骤 / 拓展 / 未来 / 验收。工时按 agent 连续工作小时（≈人工 100 倍）。T2–T6 依赖 T1 的结论；T2/T3+T4/T5/T6 可三路并行。

### T1 · 生态验证与 profile 底座（P0，10–14h）

**目标**：所有候选生态插件在真机/真 Hub 环境验证过，替代决策全部落锤，不被「README 很美」骗到。

**步骤**：建分支与目录骨架 → `dsh web` 起 profile → 逐个装 dsh-mihome（先用演示模式，再真账号）/ dsh-weather / dsh-vitals / @doitian/dsh-music / dsh-voice-mode / dsh-tavern / dsh-calendar / dsh-calendar-diary → 对照岸亭现状写验证报告（docs/ 下，每个插件：功能覆盖度、打断实测、中文识别实测、与 dsh 0.2.1-rc.x 兼容性）→ 产出《替代决策清单》与 `profile/` 安装清单初版 → 写 `README.md` 开发规范（已落盘）。
**拓展**：HA 路线并行小实验（若 mihome 直连登录被小米卡死即切换）。
**未来**：此 profile 就是岸亭 v1.0 的出厂底座。
**验收**：报告落盘；米家演示模式控一个灯、voice-mode 完成一轮带打断的中文对话、tavern 载入一张测试卡。

### T2 · dsh-shorekeeper-k20 —— 安卓屏驱动（P0，14–20h，最大的自写件）

**目标**：安卓屏变成 dsh 的显示/拾音外设：字幕、背景、模块编排、熄屏、媒体键，全部由 agent 工具驱动。

**步骤**：
1. 对照 `reference/` 的 server 长轮询与 `docs/lan-protocol.md`，在 TS 里重实现 k20 协议客户端（鉴权、长轮询、断线重连）。
2. 工具：`k20.caption`（推字幕/清字幕）、`k20.wallpaper`（图/视频上传与切换）、`k20.layout`（模块显隐/样式/透明度/拖动状态）、`k20.lock`（设备管理员熄屏）、`k20.media`（媒体键）、`k20.snapshot`（读当前屏状态）。
3. Config：k20 地址、token、字幕样式默认值；权限分级：读 read-only，锁屏/换背景走审批。
4. 预览模式兼容与离线优雅降级。
5. mock k20 服务器单测 + 真机（k20.lan）联调。
**拓展**：dsh 主动事件推屏（番茄钟倒计时、天气预警卡片）；Web UI 侧全屏预览卡片。
**未来**：同一工具面接 e-ink 副屏等新硬件；屏幕布局存档版本化。
**验收**：会话里「把这段话打到屏上，然后换这张背景图，最后熄屏」逐步真机生效。

### T3 · 守岸人人格工程 —— 角色卡 + 记忆选型（P0，12–18h）

**目标**：persona.py / companion_flow.py / intents.py 的灵魂全部转写为 Tavern 生态资产，人格零代码迁移。

**步骤**：
1. 通读 reference 底料，提炼：第一人称口吻、既定事实（「守岸人」称呼口径等）、情绪规则、陪伴类/控制类意图分流策略。
2. 产出 `content/shorekeeper-card/`：角色卡（V2 JSON：人设、开场白、示例对话）+ 世界书（书桌亭世界观、设备名录、生活仪式规则）+ 预设。
3. 意图分流：控制类意图（灯/屏/媒体）通过 system prompt 规则导向本族工具，不进剧情语境。
4. 记忆选型：3–4 个记忆插件对比实测（写入确认、检索质量、与 tavern 兼容），定一个。
5. 人格回归剧本：20 条典型对话（早安/陪聊/查监控/被喊小名/打断），对照 Hub 原行为逐条校准。
**拓展**：多情绪模式（值班/晚安/工作陪跑）做成多预设切换；状态栏格式渲染守岸人「值班日志」。
**未来**：人格资产走 git 版本化，回滚有据；对外分享角色卡（脱敏版）。
**验收**：tavern 会话中人格一致性通过剧本；喊「小岸」的反应与 Hub 版一致。

### T4 · dsh-keeper-voice —— 克隆音色桥（P0，10–14h）

**目标**：守岸人开口必须是她的声音——把自有 Qwen3-TTS（`:18100`）注册为 voice-mode / dsh-tts 的 TTS provider。

**步骤**：
1. 调研 voice-mode 与 dsh-tts 的 provider 扩展点（openai-compatible / 自定义端点），选接入面。
2. keeper-tts 侧加 OpenAI 兼容 `/v1/audio/speech` 端点（Python 独立进程，符合「启动语音大模型用独立程序」的边界）。
3. 插件侧：provider 注册、流式分句、播放速率、试听工具 `keeper.voice_test`。
4. 打断闭环：voice-mode barge-in → 通知 keeper-tts 停播（对照 reference 的打断时序）。
5. 唤醒词决策落地：安卓保留唤醒推文本 vs voice-mode 免提模式，写决策记录并实现所选路径。
**拓展**：多音色（值班/低语）；8bit 情绪 tag 透传。
**未来**：克隆音色管理进设置卡片；支持切换到云端情感 TTS 做对比。
**验收**：dsh 里守岸人用克隆音色说话，说话中被打断能立即停。

### T5 · dsh-desk-senses —— 传感器与主动感知（P1，8–12h）

**目标**：室内温湿度等自有传感器进 dsh，且「感知」是主动事件而非被动查询。

**步骤**：
1. Hub 瘦身版保留传感器采样端点（Python 侧最小改动）。
2. 工具：`senses.indoor`、`senses.pc`（聚合 dsh-vitals 数据供对话引用）。
3. 事件注入：阈值/定时（下雨、过热、长时间久坐）→ 主动插话或推屏，频率保守可配。
4. 天气深度整合：桥接 dsh-weather 数据给守岸人做晨间简报。
**拓展**：接入更多传感器（光照/噪音）；趋势查询。
**未来**：感知事件成为守岸人主动搭话的主要素材源。
**验收**：问「屋里多少度」秒答；人为制造过热事件能收到一次主动提醒。

### T6 · dsh-desk-life —— 生活仪式与数据迁移（P1，10–14h）

**目标**：日记/周报/书架的历史数据无损迁入生态插件，仪式感（睡前日记引导等）作为 skill 保留。

**步骤**：
1. `migration/`：diary.py → calendar-diary 的 xlsx；calendar.py → CalDAV/ICS；books.py → JSON 书架导出；weekly.py → 归档为 markdown。
2. 验证迁移脚本对真实数据的幂等与回滚。
3. 仪式 skill：睡前日记引导、周日晚周报、晨间简报——写进 shorekeeper 世界书 + 独立 skill。
4. 工具补充生态缺口：`life.weekly`（周报生成）、`life.books`（书架进度）。
**拓展**：情绪曲线月报；年度回顾。
**未来**：日记自动沉淀进 T3 选定的记忆插件。
**验收**：历史日记在 calendar-diary 面板可见可改；「帮我记今天的日记」走引导流程落库。

### T7 · Hub 瘦身与退役（P1，8–12h）

**目标**：Python 侧只留下真正需要的：k20 网关、传感器采样、keeper-tts；其余下线并保证回滚方案。

**步骤**：
1. 盘点现状依赖矩阵（谁还在用 server.py 的哪些路由）。
2. 裁剪：mijia_bridge、persona/companion_flow、music、calendar/diary 存储、监控上报打退役标记 → 分阶段关闭。
3. console 处置：菜单栏改为只管 launchd 三件套（tts/hub-lite/dsh），Web 面板交给 DSH 插件卡片。
4. 每步退役配回滚开关（hub.yaml feature flag），出问题一键切回 0.9.0 行为。
**拓展**：网关进一步收敛为单二进制。
**未来**：v1.0 正式移除退役代码，主分支大扫除。
**验收**：瘦身后全功能剧本仍通过；回滚演练一次成功。

### T8 · 集成、发布与端到端验收（P0，10–12h）

**目标**：新机器 30 分钟内从零到「完整亭子」。

**步骤**：
1. `profile/` 一键脚本：dsh 安装 + 生态插件清单 + 4 个自写插件 + cordis.patch.yml 默认值。
2. 十条生活场景端到端剧本（起床问天气→控灯→陪聊→放歌→记日记→晚安熄屏）逐条真机走查。
3. 版本钉死与兼容矩阵（DSH preview 会破坏性变更）；岸亭 v1.0 发布说明。
4. 评估对外发布形态（自用优先；GPL 传染问题随 mijia_bridge 退役自然消解，自写插件可自选 MIT）。
**拓展**：console Vite web 演化成 DSH 仪表盘卡片。
**未来**：dsh-Go 移动端（安卓）作为口袋入口，与 k20 屏组成双端。
**验收**：全剧本通过；`bump_version` 检查绿；发布说明落盘。

---

## 5. 里程碑

| 里程碑 | 内容 | 累计 agent 工时 |
|---|---|---|
| M1 替代验证完成 | T1 + T2（屏驱动） | ~30h |
| M2 守岸人回来 | T3 + T4 + T5（人格+音色+感知） | ~60h |
| M3 亭子完全体 | T6 + T7 + T8，发布 v1.0 | ~90h |

## 6. 风险

1. **dsh-mihome 直连登录可能被小米风控卡死**（社区已有 MiCloudAccessDenied 先例）→ T1 首日即验，Plan B 是 dsh-homeassistant + HA。
2. **DSH developer preview 破坏性变更** → 版本钉死 + 兼容矩阵。
3. **voice-mode 与 dsh-tts 的 provider 扩展点深度**决定 T4 难度 → T1 阶段读两者源码确认接入面，不行就自写独立的 keeper 语音插件全量接管。
4. **人格漂移** → 剧本回归 + 角色卡 git 版本化。

## 7. 下一步

T1 已开工：本仓库已初始化，目录骨架与 README 已落（README.md），reference 底料已复制。
