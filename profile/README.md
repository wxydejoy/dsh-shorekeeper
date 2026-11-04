# profile/ · DSH profile 底座

- `install.sh`：一键安装 dsh + 生态插件清单 + 自写插件（T8 产出）
- `cordis.patch.yml`：默认配置（模型路由、日历 CalDAV、酒馆声明行、isolated linker 配方）
- 多实例约定：日常实例 3080 / 实验实例 3081（独立 profile），互不影响

## 生态插件清单（T1 验证后钉版本 · 2026-11-03）

| 插件 | 版本 | 作用 | 验证结论 |
|---|---|---|---|
| dsh-glass-weather | 0.3.0 | 顶栏天气胶囊 + `get_weather` 工具 | ✅ 双城市实测（D9） |
| dsh-weather-panel | 1.8.0 | 侧栏天气面板（预警） | ✅ 面板在位 |
| dsh-vitals | 0.1.19 | 硬件监控面板 | ✅ macOS CPU/内存/GPU；温度功耗无读数 |
| @doitian/dsh-music | 1.2.0 | 网易云音乐 7 工具 | ✅ 匿名可搜可播；登录留人 |
| dsh-voice-mode | 0.7.34 | 全双工语音 | ✅ 源码面；**无自定义 TTS 点**（D13） |
| dsh-tavern | 2.7.26 | 角色卡宿主 | ✅ 卡导入/组合/声明机制；IAB 冻结 bug 待定责（D14） |
| dsh-mijia-sidebar | 1.0.1 | 米家设备面板 | ✅ 面板；**无 agent 工具面**（D12） |
| feiyu-memory | 4.0.2 | 人格+日记记忆 | ✅ 召回逐字、密钥硬拦（D10） |
| dsh-calendar | 0.14.3 | CalDAV 日历 7 工具 | ✅ 工具面+自检；凭据留人 |
| dsh-notify-me | 1.17.0 | 通知+外推（含 Bark） | ✅ 能力面；真机留人 |
| dsh-plugin-weixin | 1.4.3 | 微信入口（个人微信 iLink 扫码，T6 v2 定案） | ✅ 2026-11-04 21:21 全链路实证（微信关台灯）；**装时必须带消毒 patch**（见 `patches/`，防主动消息中毒循环） |

> **自写 `dsh-shorekeeper-wechat` 已归档不装机**（v2 决策：入口由 dsh-plugin-weixin 承担）；其 pnpm patch 机制同 feiyu@4.0.2 先例，patch 文件在 `patches/dsh-plugin-weixin@1.4.3.patch`，install.sh 自动登记。

**明确不装**（判死记录见 docs/decisions.md）：dsh-weather 0.1.0（D4 死刑）· dsh-tool-weather（与 glass-weather 重复）· dsh-pc-manager / dsh-calendar-diary / dsh-memory-center / dsh-full-life-memory / dsh-system-hud / dsh-mobile-notify（npm 无此包，D5）· memsearch（非记忆插件，误会）· dsh-daoing-memory / dsh-diary-memory / dsh-zdiary-kit / dsh-diary（选型出局/备选）· dsh-notify-bark（notify-me 内建）· dsh-roleplay / pmp-dsh-tavern（tavern 保留）

## profile 关键配方（T1 实测教训）

1. **pnpm-workspace.yaml**：删模板默认的 `nodeLinker: hoisted`（保 `autoInstallPeers: false`）→ isolated linker，否则老版 `@deepseek-ai/*` 依赖劫持 base 工具行（D3）
2. **模型 provider**：`llm-pi-ai` 服务的 `providers.<id>.apiKeyEnv` 存变量名；密钥放 `~/.dsh/.credentials.yaml` 的 `refs`（UI 添加即此机制）；**必须配 `modelOverrides.<modelId>.maxTokens`**，否则 OpenRouter 402（D8）
3. **酒馆预设声明**：本版 DSH 不读 `.agent-presets/` 目录；预设=patch 声明行 `- insert: [{id: preset-<id>, name: '@deepseek-ai/dsh-agent-preset', config: {...}}]`（D14，出厂四预设同款）
4. **日历**：provider=custom 需在 patch 覆盖 calendar 行的 `caldavUrl` + username + 凭据（`calendar_health` 自检指路）

## 漂泊者凭据清单（装完必做）
- OpenRouter（或 DeepSeek）key：UI 添加模型提供商，或 `refs` 手工写入
- CalDAV：日历连接设置（账号+密码/app 专用密码）
- 米家：`pip3 install mijiaAPI` + `python3 -m mijiaAPI login` 扫码
- 网易云（可选）：音乐面板登录，解锁 VIP 曲库
- macOS 通知权限（notify-me 首次「试一试」时授权）
