# 改造对照表 · 岸亭 → Shorekeeper

> 本文档是「原生替代」的完整迁移地图：岸亭（wxydejoy/Shoreting）每一块代码/能力的去向。
> 对照 `docs/plans/dsh-plugins-v1.md` 的 T1–T8；`reference/` 目录保存了对应源码快照，改写时对照用。
> 状态图例：🟢 已迁移 / 🔵 迁移中（任务未完） / ⚪ 计划中 / 🔴 退役待执行 / ⛔ 已退役

## 1. Hub（Python，`hub/dock_hub/`，约 20,700 行）

| 模块 | 行数 | 去向 | 承接方 | 状态 |
|---|---|---|---|---|
| `service.py`（编排核心） | 2663 | 拆解退役：编排逻辑由 dsh agent loop 接管 | T7 | ⚪ |
| `config.py` | 2213 | 瘦身为 hub-lite（k20 网关单页配置） | T7 | ⚪ |
| `companion_flow.py` | 902 | 对话流程 → dsh agent loop + voice-mode | T3/T4 | ⚪ |
| `intents.py` | 859 | 意图分流 → 角色卡世界书规则 + 工具路由 system prompt | T3 | ⚪ |
| `books.py` | 758 | 阅读能力 → dsh-shorekeeper-reading（书架/进度/摘抄/听书） | T5 | ⚪ |
| `server.py` | 757 | HTTP 骨架退役；仅 k20 长轮询端点保留最小实现 | T2/T7 | ⚪ |
| `companion_desk.py` | 731 | 桌面陪伴逻辑 → 守岸人角色卡内容 | T3 | ⚪ |
| `persona.py` | 599 | 人格 → Tavern 角色卡 + 世界书 | T3 | ⚪ |
| `mijia_bridge.py` + `mijia_catalog.py` | ~1000 | **整块退役**：面板=mijia-sidebar；「用嘴控灯/读数」= dsh-shorekeeper-desk-mi（T9 done：B2 真控已验、check-all 全绿、已进 web profile） | T9 | 🟢 |
| `setup_ui.py` | 970 | 配置向导退役 → dsh 设置卡片接管 | T7 | ⚪ |
| `features.py` | 982 | 功能开关 → 各插件 Config namespace | T7 | ⚪ |
| `reads.py` | 441 | 拆分：室外天气 → dsh-glass-weather + dsh-weather-panel（T1 实测✓）；室内温湿度 → dsh-shorekeeper-desk-mi `desk_mi_sensor`（T9 端到端已验） | T9 | 🟢 |
| `calendar.py` | 397 | → dsh-calendar（CalDAV 7 工具✓），历史数据迁移（migration/ 脚本） | T3 | 🔵 |
| `diary.py` | 368 | → feiyu-memory 日记档案（jsonl，可导入；export_diary.py 已迁 3 条） | T3 | 🔵 |
| `weekly.py` | ~300 | → 守岸人周报 skill（T3 内容工程，数据源为 feiyu-memory 记忆） | T3 | ⚪ |
| `media.py` | ~250 | → @doitian/dsh-music（搜索/播放/队列实测✓；网易云登录留漂泊者） | T1 ✓ | 🟢 |
| `system_volume.py` | ~200 | 音量控制 → 归入 dsh-shorekeeper-k20 媒体面或生态件，T1 实测定 | T1/T2 | ⚪ |
| `wallpaper.py` | ~200 | 背景上传链路 → `k20.wallpaper` 工具 | T2 | ⚪ |
| `mirror.py` / `chat_log.py` / `metrics.py` 等 | 其余 | T7 盘点后逐个打标（退役/保留） | T7 | ⚪ |

## 2. 其他岸亭组件

| 组件 | 去向 | 承接方 | 状态 |
|---|---|---|---|
| `companion/tts/server.py`（Qwen3-TTS 克隆音色） | **保留为独立进程**（用户拍板：语音大模型用独立程序），T4 给它加 OpenAI 兼容 `/v1/audio/speech` 端点 | T4 | ⚪ |
| `mini/`（Mac 监控 :17891） | 退役 → dsh-vitals（CPU/内存/GPU ✓，温度功耗无读数——mini 原本也给不出 GPU 负载） | T1 ✓ / T7 | 🟢 |
| Windows 探针（CPU 上报 + 开程序） | 监控部分退役 → 生态件；「白名单启动程序」并入 k20 网关或 dsh-ops | T1/T7 | ⚪ |
| `console/`（控制台 + 菜单栏 + web） | 菜单栏瘦身为三件套启停器；web 面板由 DSH 插件卡片替代 | T7/T8 | ⚪ |
| `android/`（k20 客户端） | **保留**，定位改为「显示屏 + 麦克风」外设；唤醒词链路去留由 T4 决策 | T2/T4 | ⚪ |
| `docs/lan-protocol.md` / `openapi.yaml` | 岸亭仓库继续维护；本仓库 `reference/` 存快照，协议变更以岸亭为准 | — | ⚪ |

## 3. 新建（本仓库）

| 产物 | 任务 | 说明 |
|---|---|---|
| `plugins/dsh-shorekeeper-k20` | T2 | 安卓屏驱动：字幕/背景/编排/熄屏/媒体键 |
| `content/shorekeeper-card/` | T3 | 角色卡 + 世界书 + 预设（人格内容工程，含周报/仪式 skill；周报数据源 memory） |
| `plugins/dsh-keeper-voice` | T4 | 克隆音色注册为 TTS provider + 打断闭环 |
| `plugins/dsh-shorekeeper-reading` | T5 | 阅读：书架、进度、摘抄、听书（books.py 重生） |
| `plugins/dsh-shorekeeper-wechat` | T6 | 微信接入：摘要/代读/审批代发 |
| `profile/` | T1/T8 | 生态插件清单 + cordis.patch.yml + 一键安装 |

> 2026-11-02 名单修订：dsh-desk-senses、dsh-desk-life 已砍（前者归 k20，后者由生态件 + skill 覆盖）。

## 4. 复用的生态插件（不在本仓库写码，T1 实测定稿）

dsh-glass-weather（天气胶囊+get_weather）· dsh-weather-panel（预警面板）· dsh-vitals（监控）· @doitian/dsh-music（音乐 7 工具）· dsh-voice-mode（全双工语音；无自定义 TTS 点，见 D13）· dsh-tavern（角色卡宿主）· feiyu-memory（人格+日记记忆）· dsh-calendar（CalDAV）· dsh-mijia-sidebar（米家面板，无工具面）· dsh-notify-me（通知+外推）

> 名单与版本钉在 `profile/README.md`；判死与选型理由见 `docs/decisions.md` D4–D15；验证证据在 `docs/tasks/T1-*.md` 验收记录。
