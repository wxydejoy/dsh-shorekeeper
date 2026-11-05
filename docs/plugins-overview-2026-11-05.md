# 自写插件功能盘点（2026-11-05）

> 范围：`plugins/` 下全部自写插件 + 相关自建服务（keeper-tts）与脚本。
> 逐项：功能 / 依赖链 / 缺点与问题点（诚实标注，含已知欠账）。

---

## 一、驱动与设备面

### dsh-shorekeeper-k20 —— k20 安卓屏驱动

**功能**：k20 屏（Redmi K20 Pro，k20.lan:5555）的完整驱动面。模拟面 `:17920` 冒充 dock-hub 给屏 app 供 snapshot（pc 字段永给、photos 相册透传、`/v1/photos/:id` 代理真 hub）；工具面 `k20_snapshot / k20_caption / k20_wallpaper / k20_layout / k20_media / k20_lock`。

**依赖链**：k20 app（cn.weiekko.dock）→ 模拟面 :17920；照片走 hub（hubUpstream）。

**缺点 / 问题点**：
- PC_STALE_MS 60s 过期语义：Mac 端 sampler 停超 60s 屏就判「PC 离线」，sampler 侧任何抖动都会让屏闪「离线」。
- 模拟面是「假 hub」：dock-hub 真身若加了新字段（如 idle），模拟面要手动跟，否则屏侧功能悄悄落后。
- k20.lan 解析依赖 mDNS，机器睡眠唤醒后偶发要 adb connect 重连。
- `stay_on_while_plugged_in` 已关（系统层），熄屏完全依赖 app 压黑逻辑——app 出问题就没有兜底。

### dsh-shorekeeper-desk-mi —— 米家薄工具层

**功能**：`desk_now`（本地时钟，补 dsh 运行时无时钟的洞）/ `desk_mi_list` / `desk_mi_sensor`（温湿度）/ `desk_mi_light`（控灯写）。控制限流 TokenBucketLimiter（hub ratelimit.py 对标）+ 写闸门（默认关）。

**依赖链**：python3 + mijiaAPI（CLI 子进程，`light_set` 单进程化提速过）。

**缺点 / 问题点**：
- 控灯走米家云 API（非局域网直连），断网即瘫；云端限流偶发拖慢响应。
- 每次调用起 python 子进程，冷启动 ~1s（light_set 已优化但 list/sensor 仍一问一进程）。
- 写闸门配置 controlEnabled 基线在 patch，运行时覆盖在 keeper-settings.json（守岸人设置面板可开）——两个真值来源，排查时要看两处。
- 月规则类日程逻辑不在此插件（见 agenda），此处无。传感器映射手工配置，新设备要手动加 did。

### dsh-shorekeeper-reading —— 阅读与听书

**功能**：书架/进度/笔记/问书工具（`reading.shelf / progress / note / ask`）+ 听书三件（`reading.listen / stop / resume`，直连 keeper-tts 服务端喇叭播放）+ **网页侧栏「小说朗读」面板**（2026-11-05：client.js + `/reading-panel` RPC，books/status/play/stop，与工具面共用同一 ListenEngine，断点互通；语速/定时可调）。

**依赖链**：数据目录与 migration/export_books.py 落点一致；听书走 keeper-tts :18100。

**缺点 / 问题点**：
- 听书占用 keeper-tts 的**服务端喇叭**（Mac 出声），与 TTS 试听/故事互抢喇叭——同一时刻只有一个声源，没有混音/排队。
- 长文本分句朗读的进度记忆依赖 shelf 数据，中途崩溃可能丢朗读位置。
- `reading.ask` 走模型上下文，大书摘要有限流（longReply truncate 语义在 dsh-tts 侧）。

---

## 二、主动关怀面

### dsh-keeper-watch —— 异动提醒

**功能**：天气突变 / PM2.5 超标 / PC 过热 / 内存压力 / 设备离线 / 手机离线 → notify 桥直推微信（不过模型不烧配额）。三重闸（免打扰 23:00-07:00 / 每日配额 / 同一件事一天一次）+ Sustained（持续坏才开口）移植自 dock-hub proactive.py。运行时覆盖：`~/.dsh/keeper-settings.json`（面板写，每 tick 现读），`enabled` 总开关现在真生效（此前 Config.enabled 是死字段，已修）。

**依赖链**：hub /v1/snapshot（pc/devices）、Open-Meteo（免费无 key）、k20 TCP 探活、微信 notify 桥（127.0.0.1:47832）。

**缺点 / 问题点**：
- 久坐提醒**没做**：键鼠 idle 是 hub 内部量不外露，dsh 侧拿不到真值（诚实标注，等 idle 进快照再补）。
- Open-Meteo 免费源，国内网络偶发超时（有重试冷静期 10min）。
- 闸门热重建（面板改免打扰/配额）会重置当日配额计数——改配置即重置，偏保守但要注意。
- notify 桥挂掉时 send 失败只进冷静期重试，没有「桥挂了」本身的告警（自己瞎了不知道）。

### dsh-keeper-agenda —— 日程 ICS

**功能**：`desk_agenda` 工具，答「今天/明天有什么安排」。hub calendar.py 忠实移植（四种 FREQ 展开）。

**依赖链**：插件配置 feeds（iCloud/Google 秘密地址，webcal:// 也行）；**当前 feeds 为空，等漂泊者给地址**。

**缺点 / 问题点**：
- 月规则 31 号短月漂移「漏拍」是 hub 原语义（忠实移植的副作用），真实日历里 1/31 这类事件短月不提醒。
- feeds 为空期间插件空转，`desk_agenda` 返回「没配日历」。
- ICS 拉取无本地缓存持久化，重启后首问要现拉远端（慢一次）。

---

## 三、语音面

### dsh-keeper-voice —— 声音工具面

**功能**：`keeper.status`（TTS 状态）/ `keeper.voice_test`（试听）/ `keeper.stop`（打断朗读兜底）/ `keeper.noise`（白噪音 rain/waves/fan/brown，1-180min）。说话主链路是 dsh-tts custom provider 接线（零代码），本插件只做工具。

**依赖链**：keeper-tts :18100（`/v1/noise` 白噪音端点）。

**缺点 / 问题点**：
- `keeper.noise` 与听书/朗读共用服务端喇叭，会互相打断（同 reading 的声源独占问题）。
- 试听文本固定 sampleText，不能任意念（要任意念走 speak_text）。

### keeper-tts（dock 仓库 companion/tts，非本仓库）

**功能**：本地 Qwen3-TTS 克隆音色服务（:18100）。OpenAI 兼容 `/v1/audio/speech`（wav/pcm/mp3）、`/v1/noise` 白噪音、故事/朗读喇叭播放。流式合成两条路径统一（first_audio ~470ms，12 字整句 ~1.9s）。

**缺点 / 问题点**：
- **dock 仓库本地改动未推**（wav_to_mp3 + 流式统一，等漂泊者点头）。
- mp3 转码用 ffmpeg 绝对路径 `/opt/homebrew/bin/ffmpeg`——companion-tts 的 launchd plist 没配 PATH，换机器要跟着改。
- 克隆模式忽略 voice 参数（keeper-tts 特性）：多音色需求满足不了。
- 模型常驻内存（Qwen3-TTS），Mac 内存紧张时是固定开销。

### dsh 侧语音装件（市场件，配置面自建）

- **dsh-tts**：朗读回复引擎。custom→keeper-tts 链路 + edge 兜底。**坑**：custom 需要 `CUSTOM_TTS_API_KEY` env（launchd plist 已配占位值 keeper-local），key 缺失/链路失败会**静默回落 edge 小晓**（音不对+慢的根因，排查口：`/dsh-tts/stats` 看 custom 熔断计数）。
- **dsh-voice-mode**：语音模式（STT/VAD barge-in/字幕）。STT 模型缓存在 `~/.cache/dsh-voice-mode/`；`/voice-mode/asr` 只收 Float32 LE 16k PCM（Int16 静默返回空 text，巨坑）；allowLan 已开。浏览器侧必须 secure context：**局域网走 https://10.14.14.117:3092（tls-forward），本机走 http://127.0.0.1:3091（loopback-forward）**。
- 局限：手机扬声器远场收音够触发打断但不够 ASR 解码（音量物理限制，真人贴麦无碍）。

### dsh-keeper-console —— 守岸人设置面板（本日新增）

**功能**：左侧栏「守岸人设置」入口。朗读语音（自动朗读回复/流式逐句/语音模式内朗读）、异动提醒（总开关/免打扰/每日上限）、台灯控制（写闸门/每分钟上限）、keeper-tts 在线状态。全 RPC 直达，不过模型。

**写路径**（重要，排查必读）：
- dsh-tts / voice-mode 的开关 → **直接行级手术改 cordis.patch.yml 对应 insert 行**，宿主 loader 监听文件热重载（秒级生效，不用重启）。宿主 settings 服务 / ConfigEditor 路径对 patch 供给的 ns 会拒绝（`overridden by a home patch`），是绕行的原因。
- keeper-watch / desk-mi → 写 `~/.dsh/keeper-settings.json`，两插件现读（tick / 每次执行）。

**缺点 / 问题点**：
- patch 文件手术是行级正则：若手工把 patch 改成异常缩进/多行值，flip 可能找不到锚点报 no_key（会如实报错，不会写坏文件）。
- 数字输入（每日上限/每分钟上限）留空 = 用插件 Config 基线，面板不显示基线值（显示空）。
- 语音模式内朗读开关写 voice-mode 的 readAloud——「朗读面归 dsh-tts」决策下默认应保持 off。

---

## 四、微信面

### dsh-plugin-weixin（市场件 1.4.3 + 本地 patch）

**功能**：微信 BOT 主链路（原插件）+ 本地 patch 增强。

**本地 patch 内容**：sanitizeProactiveText 扩展（拦「模型调用失败」原文外泄 + 剥 ⏵ 记号）、toolDenylist（agent-scope 工具裁剪，83→28 个，prompt 81KB→约 25KB）。

**缺点 / 问题点**：
- 上游发了 1.5.x，1.4.3 不含消毒逻辑——**升级则两个 patch 都要重做**，等漂泊者点头。
- 「no adapter zhipu」根因在 dsh 核心 LlmRuntime 注册窗口（插件 reload 瞬间 / apply 时 profiles 空不补注册），插件侧只做了症状拦截；复发观察口：err.log grep "configuration conflicts"。
- notify 桥（127.0.0.1:47832）的发送不计入微信 metrics，验证送达别看 metrics。
- 订阅（subscriptions.json）早间简报 07:30 / 周报周日 21:30 挂 e7a07db；死号 339bb 已退役。

### dsh-shorekeeper-wechat —— 微信桥（旧路线）

**功能**：wcferry Windows 挂机侧小服务的 dsh 工具面（桥契约 docs/bridge-contract.md）。

**缺点 / 问题点**：依赖 Windows 挂机机（wrobot.local）在线，**当前整机离线**，整条链路闲置；与 dsh-plugin-weixin（主链路）并行存在，注意别混淆两条「微信」线。

---

## 五、脚本与通道

| 脚本 | 用途 | 注意 |
|---|---|---|
| `scripts/loopback-forward.py` | 127.0.0.1:3091 → LAN:3090 TCP 转发 | 浏览器语音 loopback 入口；**前台进程，会话结束即停**，长期用要挂 launchd |
| `scripts/tls-forward.py` | 0.0.0.0:3092 自签 TLS → LAN:3090 | 局域网语音前门（https），证书 `~/.config/dsh-web-tls/`（10 年）；同上未挂 launchd |

**共同欠账**：两个转发器都跑在临时进程里，重启 Mac / 会话结束就没了——要长期用说一声挂 launchd。

---

## 六、横切问题点（跨插件）

1. **strip-only 直载 .ts 的语法限制**：不支持 constructor 参数属性（踩坑三次：keeper-watch gates、keeper-agenda feed、教训已写进 gates.ts 注释）。新插件写类必须显式字段。
2. **双真值来源**：写闸门/提醒开关同时存在于 patch config（基线）与 keeper-settings.json（覆盖），面板只改覆盖层。排查「为什么没生效」先看覆盖文件再看 patch。
3. **声源独占**：keeper-tts 单喇叭，朗读/听书/白噪音互抢，无优先级仲裁。
4. **dock 仓库改动未推**（等点头）：companion/tts/server.py 两处（mp3 支持 + 流式统一）。
5. **观察口**：err.log grep `configuration conflicts`（no adapter 复发）、`/dsh-tts/stats`（custom 熔断）。
