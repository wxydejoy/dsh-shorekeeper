# Shorekeeper（守岸人）

守岸人从岸亭里搬了出来，住进 DeepSeek Harness（DSH），直接在漂泊者的 agent 里值班。

[岸亭（Shoreting）](https://github.com/wxydejoy/Shoreting)是亭子：横屏安卓是脸和字幕，Mac Mini 当门口。而 **Shorekeeper 是大脑本身**——人格、感知、米家、语音、生活仪式，全部原生实现为 DSH 插件；凡 DSH 生态已有的能力（天气、监控、音乐、日历、记忆）直接复用社区插件，不重复造轮子。只有「语音大模型」这类必须独立进程的，保留为外部程序由插件驱动。

> 名字取自守岸人的官方英文名 **Shorekeeper**。插件统一使用 `dsh-shorekeeper-*` 前缀。

## 目标架构

```
漂泊者
 ├── dsh（Mac Mini, shorekeeper profile） ← 新大脑，本项目的主战场
 │    ├── [生态件] mijia-sidebar(面板) / glass-weather / vitals / music / voice-mode
 │    │            tavern(守岸人角色卡) / feiyu-memory / calendar / notify-me
 │    └── [自写件] dsh-shorekeeper-k20 / dsh-keeper-voice
 │                 dsh-shorekeeper-reading / dsh-shorekeeper-wechat
 ├── keeper-tts（:18100，独立进程，Qwen3-TTS 克隆音色）← 保留的外部程序
 ├── hub（瘦身版 Python：k20 屏网关）                   ← 保留的外部程序
 └── k20 安卓屏 ← 只当「显示屏 + 麦克风」，大脑在 dsh
```

## 目录

| 目录                       | 说明                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [plugins/](plugins/)     | 自写插件：`dsh-shorekeeper-k20`（安卓屏驱动）、`dsh-keeper-voice`（克隆音色 provider）、`dsh-shorekeeper-reading`（阅读）、`dsh-shorekeeper-wechat`（微信接入） |
| [content/](content/)     | 守岸人角色卡 + 世界书 + 预设（内容工程，宿主是 dsh-tavern）                                                                            |
| [profile/](profile/)     | 生态插件安装清单 + cordis.patch.yml + 一键安装脚本                                                                              |
| [migration/](migration/) | 岸亭 diary/weekly/books 数据导出导入脚本（一次性）                                                                               |
| [reference/](reference/) | 从 hub 复制的 Python 底料，**只读**，作协议与人格文案对照                                                                             |
| [docs/](docs/)           | 生态插件验证报告、决策记录                                                                                                     |

## 插件族

### 复用的生态插件（T1 钉版 · 2026-11-03，见 profile/README.md 与 docs/decisions.md）

dsh-mijia-sidebar 1.0.1（米家面板；无 agent 工具面，控灯/读数走 dsh-shorekeeper-desk-mi，T9 已验）· dsh-glass-weather 0.3.0 + dsh-weather-panel 1.8.0（天气）· dsh-vitals 0.1.19（监控）· @doitian/dsh-music 1.2.0 · dsh-voice-mode 0.7.34（全双工语音：STT + barge-in + 字幕；无自定义 TTS 点，TTS 面归 dsh-tts）· dsh-tavern 2.7.26（角色卡宿主）· feiyu-memory 4.0.2（人格+日记记忆）· dsh-calendar 0.14.3 · dsh-notify-me 1.17.0（通知）

> T1 实测定稿名单（钉版本见 [profile/README.md](profile/README.md)）。判死/出局（T1 D4–D15）：dsh-weather · dsh-pc-manager · dsh-system-hud · dsh-calendar-diary（日记归 feiyu）· dsh-mobile-notify（npm 无此包）· memsearch（误会）· dsh-roleplay

### 自写插件

| 插件                  | 职责                                                              |
| ------------------- | --------------------------------------------------------------- |
| dsh-shorekeeper-k20 | k20 安卓屏驱动：字幕、背景、模块编排、熄屏、媒体键                                     |
| dsh-keeper-voice    | keeper-tts（Qwen3-TTS 克隆音色）接入语音链路，打通打断闭环。**T1 变更**：voice-mode 的 ttsEngine 是封闭枚举（edge/vits/kokoro），无自定义 provider 扩展点（D13）——T4 全量自写语音链路或 fork voice-mode，二选一由 T4 定 |
| dsh-shorekeeper-reading | 阅读：书架、进度、摘抄、听书（岸亭 books.py 重生）                            |
| dsh-shorekeeper-wechat  | 微信接入：消息摘要、代读、审批代发                                          |

## 开发规范（要点）

- 插件是 TS 模块，入口 `apply(ctx)`，注册工具前必须 `export const inject = ['tools']`；Config 用 Schemastery schema，host 侧 `ctx.settings.installSection()` 配对设置卡片
- 权限分级：查询类工具 `read-only`；控制类（锁屏/换背景/米家写入）走 `sandbox_permissions` 审批
- DSH 处于 developer preview：`package.json` 钉死兼容版本范围，每次升 dsh 跑一遍兼容矩阵
- 多实例开发：日常亭子实例（默认 3080）与实验实例（`--port 3081` + 独立 profile）分离，实验崩了重建即可
- 改协议先改文档的岸亭规矩在这里同样生效：`reference/` 是岸亭 `docs/lan-protocol.md` 与关键源码的快照，协议漂了以岸亭仓库的原文档为准

## 快速开始（草案 · 待 T8 真机演练校准）

前置：macOS（Mac Mini）· Homebrew · Node ≥ 22

1. 克隆本仓库，`bash profile/install.sh`——自动钉 `@deepseek-ai/dsh@0.2.1-rc.5`、建 `shorekeeper` profile、按 T1 钉版清单装 10 件生态插件、链接 4 个自写插件、写入 cordis.patch 默认值
2. 凭据（T1 清单，装完必做）：OpenRouter key · CalDAV 账号 · 米家扫码 · 网易云（可选）· macOS 通知授权
3. 启动：`dsh --profile shorekeeper`（日常 3080；实验 `--profile shorekeeper --port 3081`）
4. 真机走查：[docs/e2e-scenarios.md](docs/e2e-scenarios.md) 十条场景逐条过
5. 升级 dsh 先读 [docs/compat-matrix.md](docs/compat-matrix.md)，绿了才动版本钉

## 计划与进度

完整方案见 [docs/plans/dsh-plugins-v1.md](docs/plans/dsh-plugins-v1.md)：8 个任务（T1 生态验证 → T8 发布 v1.0），里程碑 M1 屏驱动 → M2 守岸人回来 → M3 亭子完全体。每任务一子分支，合回 `main`。
