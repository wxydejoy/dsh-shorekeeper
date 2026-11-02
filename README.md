# Shorekeeper（守岸人）

守岸人从岸亭里搬了出来，住进 DeepSeek Harness（DSH），直接在漂泊者的 agent 里值班。

[岸亭（Shoreting）](https://github.com/wxydejoy/Shoreting)是亭子：横屏安卓是脸和字幕，Mac Mini 当门口。而 **Shorekeeper 是大脑本身**——人格、感知、米家、语音、生活仪式，全部原生实现为 DSH 插件；凡 DSH 生态已有的能力（天气、监控、音乐、日历、记忆）直接复用社区插件，不重复造轮子。只有「语音大模型、传感器采样」这类必须独立进程的，保留为外部程序由插件驱动。

> 名字取自守岸人的官方英文名 **Shorekeeper**。插件统一使用 `dsh-shorekeeper-*` 前缀。

## 目标架构

```
漂泊者
 ├── dsh（Mac Mini, shorekeeper profile） ← 新大脑，本项目的主战场
 │    ├── [生态件] mihome / weather / vitals / music / voice-mode
 │    │            tavern(守岸人角色卡) / memory / calendar / mobile-notify
 │    └── [自写件] dsh-shorekeeper-k20 / dsh-keeper-voice
 │                 dsh-shorekeeper-reading / dsh-shorekeeper-wechat
 ├── keeper-tts（:18100，独立进程，Qwen3-TTS 克隆音色）← 保留的外部程序
 ├── hub（瘦身版 Python：k20 屏网关，含传感器透传）    ← 保留的外部程序
 └── k20 安卓屏 ← 只当「显示屏 + 麦克风」，大脑在 dsh
```

## 目录

| 目录                       | 说明                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| [plugins/](plugins/)     | 自写插件：`dsh-shorekeeper-k20`（安卓屏驱动）、`dsh-keeper-voice`（克隆音色 provider）、`dsh-desk-senses`（传感器）、`dsh-desk-life`（周报/书架） |
| [content/](content/)     | 守岸人角色卡 + 世界书 + 预设（内容工程，宿主是 dsh-tavern）                                                                            |
| [profile/](profile/)     | 生态插件安装清单 + cordis.patch.yml + 一键安装脚本                                                                              |
| [migration/](migration/) | 岸亭 diary/weekly/books 数据导出导入脚本（一次性）                                                                               |
| [reference/](reference/) | 从 hub 复制的 Python 底料，**只读**，作协议与人格文案对照                                                                             |
| [docs/](docs/)           | 生态插件验证报告、决策记录                                                                                                     |

## 插件族

### 复用的生态插件（在 profile 里管理，不在本仓库写码）

dsh-mihome（米家，MIT）· dsh-weather · dsh-vitals / dsh-pc-manager（监控）· @doitian/dsh-music · dsh-voice-mode（全双工语音：STT + barge-in + 字幕）· dsh-tavern（角色卡宿主）· 记忆插件（T1 选型）· dsh-calendar · dsh-calendar-diary · dsh-mobile-notify

### 自写插件

| 插件                  | 职责                                                              |
| ------------------- | --------------------------------------------------------------- |
| dsh-shorekeeper-k20 | k20 安卓屏驱动：字幕、背景、模块编排、熄屏、媒体键                                     |
| dsh-keeper-voice    | 把 keeper-tts 克隆音色注册为 voice-mode / dsh-tts 的 TTS provider，打通打断闭环 |
| dsh-desk-senses     | 室内温湿度等自有传感器桥 + 事件主动注入                                           |
| dsh-desk-life       | 周报生成、书架进度、生活仪式 skill                                            |

## 开发规范（要点）

- 插件是 TS 模块，入口 `apply(ctx)`，注册工具前必须 `export const inject = ['tools']`；Config 用 Schemastery schema，host 侧 `ctx.settings.installSection()` 配对设置卡片
- 权限分级：查询类工具 `read-only`；控制类（锁屏/换背景/米家写入）走 `sandbox_permissions` 审批
- DSH 处于 developer preview：`package.json` 钉死兼容版本范围，每次升 dsh 跑一遍兼容矩阵
- 多实例开发：日常亭子实例（默认 3080）与实验实例（`--port 3081` + 独立 profile）分离，实验崩了重建即可
- 改协议先改文档的岸亭规矩在这里同样生效：`reference/` 是岸亭 `docs/lan-protocol.md` 与关键源码的快照，协议漂了以岸亭仓库的原文档为准

## 计划与进度

完整方案见 [docs/plans/dsh-plugins-v1.md](docs/plans/dsh-plugins-v1.md)：8 个任务（T1 生态验证 → T8 发布 v1.0），里程碑 M1 屏驱动 → M2 守岸人回来 → M3 亭子完全体。每任务一子分支，合回 `main`。
