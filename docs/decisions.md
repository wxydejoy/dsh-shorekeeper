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

## 待决清单（T1 结束前清零）
- [ ] 天气：dsh-tool-weather vs dsh-weather-panel vs 双装（D4）
- [ ] 监控：dsh-vitals 在 macOS 是否可用（README 写的是 /proc + nvidia-smi，疑似 Linux 向）
- [ ] 米家：mijia-sidebar 的 agent 工具面（D6）
- [ ] 记忆：4 候选实测选 1（D5）
- [ ] 语音：voice-mode 与 @goodandready/dsh-tts 的 provider 扩展点（T4 前置）
- [ ] 角色：dsh-tavern（chencheng810 2.7.26）vs pmp-dsh-tavern（Player-MINEPIG 3.0.4，目录缓存里的另一个"tavern"）vs dsh-roleplay
- [ ] 通知：dsh-notify-bark vs dsh-notify-me vs 目录里的 github:dsh-mobile-notify
- [ ] 日记：dsh-calendar-diary 无同名包后的替代选型
