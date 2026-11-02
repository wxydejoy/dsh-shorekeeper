# T1 · 生态验证与 profile 底座

```
状态: review（agent 侧完工 2026-11-03，遗留 6 项人工验收见验收记录末尾清单）· owner: 值班 agent（ZCode）· 开始于: 2026-11-02 · 预估: 10–14 agent 小时 · 前置: 无
分支: T1-ecosystem-trial
```

## 目标

所有候选生态插件在真机/真环境验证过，替代决策全部落锤——**不被 README 骗到**。产出岸亭 v1.0 的出厂 profile 底座。

## 背景

方案 v1 依赖一大批社区插件（见 profile/README.md 清单）。它们处于 fast-moving 的 DSH 生态，README 与实际能力可能有差距；岸亭语音链路（听完→念→打断→字幕）和米家控制尤其要实测。

## 步骤

### 阶段一：环境（2h）
- [ ] 装 dsh（`npx @deepseek-ai/dsh` 或官方安装路径），记录版本
- [ ] 起两个实例：日常 `dsh web`（3080）/ 实验 `dsh web --port 3081`（独立 profile）
- [ ] 实验实例里创建测试 profile，确认插件安装/卸载/重启流程
- [ ] 写 `docs/decisions.md` 记录 dsh 版本与安装方式

### 阶段二：逐插件验证（每件 0.5–2h）
对下列每个插件，产出验证记录（写入本文件末尾验收记录区）：
- [x] **dsh-mihome** → 名单修正为 dsh-mijia-sidebar（D6/D12）：源码确认**无 agent 工具面**，面板可用；真机控灯需漂泊者扫码（人工项）
- [x] **dsh-weather** → 名单修正为 glass-weather + weather-panel（D4/D9）：get_weather 上海/北京真实实况+多日预报实测通过
- [x] **dsh-vitals**（+ dsh-pc-manager 对比）→ pc-manager 不存在（D5）；vitals macOS CPU/内存/GPU 实测 ✓，温度/功耗 Linux-only（—）
- [x] **@doitian/dsh-music**：搜索 251 条（真实网易云 id）/播放/暂停/队列实测 ✓；匿名会话可搜可播、VIP 不可播；登录链路留漂泊者
- [x] **dsh-voice-mode**：源码面完整验证（流式 ASR/VAD 打断/字幕/唤醒词）；**ttsEngine 封闭枚举无自定义 provider 点**（D13）；真人对话体验留漂泊者
- [x] **dsh-tavern vs dsh-roleplay** → tavern 保留（D14）：V2 JSON 卡导入 ✓、预设/世界书/绑定/开场白管理台 ✓、组合 headless 实测 ✓、声明机制摸清；IAB 冻结 bug 已记录
- [x] **dsh-calendar + dsh-calendar-diary** → calendar 工具面 7 个全注册，无账号优雅报错 + calendar_health 自检指路；calendar-diary 无同名包（D5），日记归 feiyu（D15）；CalDAV 连接留漂泊者
- [x] 记忆插件 3 选 1 实测 → feiyu-memory（D10）：召回逐字 ✓、密钥硬拦 ✓、与 tavern 无冲突 ✓；memsearch 判死（误会）
- [x] dsh-mobile-notify（可选）→ dsh-notify-me 单件（D11，Bark 等全渠道内建）；真机推送留漂泊者

### 阶段三：沉淀（2h）
- [x] 产出《替代决策清单》：每个岸亭模块 → 生态件/自写/保留，更新 docs/refactor-map.md 状态列
- [x] 产出 `profile/` 安装清单初版（钉版本号）
- [x] 更新根 README 与 plan v1 中与验证结论冲突处

## 交付物
- `docs/decisions.md`（dsh 版本、安装方式、各项选型）
- `profile/` 安装清单初版
- 各插件验证记录（本文档末尾）
- refactor-map.md 状态列更新

## 验收标准
- [ ] 米家：演示模式控灯成功；真账号结论明确（成功或切换 HA 路线的决策已记录）→ **决策已记录（D12）**；真灯验收需漂泊者扫码（mijia-sidebar 无演示模式）
- [ ] 语音：voice-mode 完成一轮带打断的中文对话，字幕可见 → 需漂泊者真人测试（麦克风/扬声器链路 agent 无法代测）
- [x] tavern：载入一张测试角色卡并正常对话 → V2 卡导入 ✓ + headless 角色对话 ✓（web 端对话因 IAB 冻结 bug 待 Chrome 复测，D14）
- [x] 决策清单覆盖 v1 方案全部生态件，无「未验证」遗留 → decisions.md D7–D15 + 待决清单清零

## 拓展方向 / 未来方向
- 拓展：HA 路线（dsh-homeassistant）并行小实验备用
- 未来：此 profile 就是岸亭 v1.0 出厂底座；验证方法沉淀为升级 dsh 时的回归清单

## 风险与对策
| 风险 | 对策 |
|---|---|
| mihome 直连被小米风控（MiCloudAccessDenied 先例） | 首日即验；Plan B 走 dsh-homeassistant + HA |
| voice-mode 与 dsh-tts 扩展点不够深 | 读两者源码确认接入面，不行通知 T4 改全量自写 |
| DSH preview 版本升级破坏 | 钉版本；验证记录即回归清单 |

## 验收记录

### 阶段一 · 2026-11-02（上一会话）
- profile `shorekeeper-lab` 由 `--from-default-profile web` 克隆创建（D1）；:3081 启动正常
- 版本实验与 [D2]（versionless bundle）/ [D3]（isolated linker 配方）/ [D4]（dsh-weather 0.1.0 死刑）
- npm 名单对账 [D5]（4 个包名不存在）与米家候选修正 [D6]

### 阶段二 · 2026-11-03（本会话，全部在 shorekeeper-lab @ 0.2.1-rc.5 实测）

**环境与闭环**
- boot：12+1 插件零报错（`/tmp/dsh-lab-3081.log` `grep -icE 'error|disabling'` = 0；D3 配方 rc.5 复验）
- 模型：OpenRouter `deepseek/deepseek-v4.1-flash-1017`，refs 凭据机制（D8），maxTokens 16K 覆盖
- agent 全轮闭环：一轮 8 秒 / 408 tok/s；工具清单 47 个全量列出（weather/music/calendar 工具面在列）

**天气（D9）**
- `get_weather` 上海：局部多云 13.0°C 湿度 96% + 逐日预报；北京：晴 7.8°C + 逐日预报（首查偶发 fetch failed，重试即过——数据源为免密钥公共源）
- 顶栏胶囊与实况一致（霾 8°/黄警/16°-6°/73%）；侧栏「天气」面板按钮在位（weather-panel）

**音乐（@doitian/dsh-music 1.2.0）**
- `music_search` 晴天 周杰伦 → 251 条，前 3 含真实网易云 song id（3440441479）
- `music_play` → 实际出声（Playing 7s/112s）→ `music_control` 暂停 ✓；账号态 anonymous：可搜可播、VIP 曲目不播
- 面板 `:3081/music/panel` 存在；网易云登录（完整曲库/AI DJ）留漂泊者

**监控（dsh-vitals 0.1.19）**
- 面板：Apple M4 每核占用 ×10、内存 11.6/16.0 GB（与活动监视器口径一致）、GPU 负载 21%
- 对照 `top`：CPU 总体 15.5% vs 面板 18%（采样时差内一致）
- 温度/功耗显示「—」：源为 /proc + nvidia-smi（Linux-only），macOS 优雅降级不崩

**日历（dsh-calendar 0.14.3）**
- 7 个工具全注册（create/delete/find_time/health/list/search/update）
- 无账号时 `calendar_list` 优雅报错、`calendar_health` 自检三连（❌ caldavUrl / ❌ username / ❌ 凭据）并给出配置指路（provider=custom 需在 cordis.patch.yml 覆盖 caldavUrl）——配置面完全摸清

**角色卡（dsh-tavern 2.7.26，D14）**
- V2 角色卡导入 ✓：合成 DataTransfer drop 事件喂入「守岸人·测试」JSON 卡，面板即显即勾选（IAB 无文件选择器的绕法）
- 管理台验证：预设保存、世界书注入模式（全文/关键词触发）、会话绑定、开场白注入（第一/备选）、提示词体积实时统计
- 声明机制：源码证实本版 DSH 不读 `.agent-presets/` 目录，预设=cordis.patch.yml 声明行；手工补写后顶部选择器出现「酒馆默认」✓
- headless 组合实测：`dsh --profile shorekeeper-hl`（无浏览器）回复「我是守岸人，一款来路不明的测试用酒馆助手」——组合+卡注入服务端有效
- **Bug**：IAB 中「声明为 DSH 预设」预览、选中酒馆预设开新会话两个场景 100% 冻结渲染进程（3 次），服务端无异常；待漂泊者 Chrome 复测定责（IAB or tavern client）

**米家（dsh-mijia-sidebar 1.0.1，D12）**
- 源码：无任何 agent 工具注册；`state.py` 一次性进程调 mijiaAPI CLI；未装 mijiaAPI/未扫码时 exit 3/4/5 输出引导 JSON（面板转为安装/扫码指引，不崩）

**语音（dsh-voice-mode 0.7.34，D13）**
- README+源码验证：zipformer2 流式 + SenseVoice 定稿、Silero VAD 帧级 barge-in + 回声门控、字幕档位、唤醒词（仅 toggle 模式）、让位语义 ADR-0008、Edge 默认免密钥
- `ttsEngine = edge|vits|kokoro` 封闭枚举，无自定义 provider 面 → T4 预案触发

**记忆（feiyu-memory 4.0.2，D10）**
- 召回闭环：手工种 diary jsonl（格式自 SPEC/源码 normalizeDiaryEntry）→ 新会话逐字召回「青色灯塔」✓
- 密钥硬拦：含「口令」样文本被 [已拦截] 打码（feature 按设计工作）
- 档案 `~/.dsh/feiyu-diary/`（persona.md/日记.md/手记.md/diary/*.jsonl）人可读可改
- 写侧（轮末固化）headless 不触发（进程即退）→ web 会话真人验证移交
- memsearch 0.0.3 死刑：npm 搜出来的同名包实为堆快照调试 CLI，已卸载

**通知（dsh-notify-me 1.17.0，D11）**
- README 实证：系统通知 + Bark/Discord/Gotify/飞书/Server酱/WxPusher/Webhook 外推 + 审批快捷裁决 + 宿主侧兜底；真机通知留漂泊者

### 遗留人工验收清单（漂泊者，预计 30 分钟）
1. **日历**：:3081 设置→日历，填 CalDAV 账号/密码（calendar_health 会指路）→ `calendar_list` 出真日程
2. **米家**：`pip3 install mijiaAPI`（或按面板指引）→ `python3 -m mijiaAPI login` 扫码 → 侧栏米家面板出设备 → 告诉值班 agent，配自写薄工具层
3. **语音**：:3081 输入框旁「进入语音对话模式」，念一段台词 → 验证流式字幕/停顿发送/朗读/开口打断
4. **feiyu 写侧**：网页随便聊一轮 → 看 `~/.dsh/feiyu-diary/日记.md` 是否长出条目（固化需要一轮结束后的几秒）
5. **通知**：设置→通知提醒→「试一试」→ macOS 应允通知权限 → 收到系统通知；需要 Bark 推送则填 Bark key
6. **tavern 冻结定责**：用 Chrome 打开 `:3081`（非 ZCode 内置浏览器）→ 新会话选「酒馆默认」→ 聊一句 → 若正常，冻结定性为 IAB 特有；若复现，回 tavern 报 issue
7. **OpenRouter 余额**：agent 高频调用会烧 key，402 时按 D8 调 maxTokens 或充值

### 结论
替代决策全部落锤（decisions.md D7–D15，待决清单清零）；`profile/` 清单初版与 refactor-map 状态列已更新。T1 的 agent 侧完工，转 review。
