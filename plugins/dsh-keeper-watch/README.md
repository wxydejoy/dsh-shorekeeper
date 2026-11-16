# dsh-keeper-watch · 异动提醒

后台 tick（默认 60s 一拍），把「环境里不对劲的事」推给你。**没有工具面**——它不是给模型调用的，
是自己在后台看着，命中就开口。移植自 dock-hub `proactive.py` 的判断骨架。

## 两条出口

| 出口 | 说明 |
|---|---|
| notify 桥 → 微信 | `POST 127.0.0.1:47832/notify`，不过模型、不烧 token。人不在家也收得到 |
| keeper-tts 出声 | `POST :18100/v1/audio/speech` 带 `play:true`，服务端在本机喇叭流式播 |

顺序是**先文字后语音**：微信那条落地了才出声。出声失败只 warn，不回滚文字。
keeper-tts 是同一播放队列串行，所以正在听书时这条提醒会排在那一段之后（几秒到几十秒），
**不打断正文**。

## 三重闸（谁都会被拦）

1. 免打扰时段（默认 23:00–07:00，允许跨零点）
2. 每日配额（默认 12 条，第二天归零）
3. 同一件事（key）一天最多一次——被拦下不记账，缓过来还能再提

「持续坏才说」由 `Sustained` 管：瞬间冒一下不算，坏满窗口才开口。

## 检查项与数据现状（2026-11-16 核对）

| 检查 | 数据源 | 现状 |
|---|---|---|
| PM2.5 超标 | Open-Meteo（5 分钟采样，坏满 10 分钟） | ✅ 通的，历史上 9 条提醒全是它 |
| 天气突变 | Open-Meteo（半小时看一次，只推变化） | ✅ 通，但要求「未来两小时明显变化」 |
| CPU 过热 | 快照 `pc.cpu.temp_celsius` | ⚠️ hub **不报温度**，只有 `percent` → 走下面那条 |
| CPU 占用率高 | 快照 `pc.cpu.percent` | ✅ 新增（80% 持续 5 分钟） |
| 内存压力 | 快照 `pc.memory.percent` | ✅ 通（阈值已从 92 调到 85） |
| 久坐 | 快照 `idle_sec` → 缺省用本机 `ioreg` | ✅ 新增本机兜底（快照一直没这个字段） |
| 设备离线 | 快照 `devices[]` + `watchDeviceIds` | ⏸ 未启用：`devices` 恒空、名单也空，启动日志会明说 |
| PC 离线 | 快照 `pc.online` | ⏸ 配置默认关（关机是日常，不是异动） |
| k20 屏离线 | TCP 探活 `phoneHost:phonePort` | ✅ 通 |
| 插件激活失败 | 扫 dsh err log 本次启动段 | ✅ 通（面板 405 一类事故的哨兵） |

## 配置要点

```yaml
cpuPercentThreshold: 80      # hub 只报 percent 时的退路；0 = 关
cpuPercentSustainedSec: 300
memoryPercentThreshold: 85
localIdleProbe: true         # 快照缺 idle_sec 时用本机 ioreg 取键鼠空闲
voiceEnabled: true
voiceBaseUrl: 'http://127.0.0.1:18100'
voiceVolume: 30              # 采样增益，不动系统音量
```

面板（dsh-keeper-console）可改的只有三项：总开关、免打扰、每日配额。其余改 profile 配置后重启。

## 测试

`npx vitest run` —— 49 条，覆盖闸门三道、持续窗口、CPU 双轨、本机 idle 兜底、
出声与文字的顺序、出声失败不影响文字、免打扰拦下时不出声、激活自检。
