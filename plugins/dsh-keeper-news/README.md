# dsh-keeper-news — 守岸人的新闻播报

早晚各播一次要闻 + 随时点播。出声走 keeper-tts 服务端喇叭（`/v1/audio/speech` + `play:true`），定时那两条同时用 notify 桥推一份文字到微信。

```
百度热搜 API ──► parseBaiduHot ──► buildSpokenBrief ──► NewsSpeaker ──► keeper-tts :18100 ──► 喇叭
                                        │
                                        └──► buildTextBrief ──► notify 桥 :47832 ──► 微信
```

## 为什么是这套

- **源只认百度热搜**（`top.baidu.com/api/board?platform=wise&tab=realtime`）。2026-11-18 实测：腾讯新闻直连被 WAF 挡（503 / 501 跳 waf.tencent.com），微博热搜 403，第三方镜像连不上，百度搜索页要人机验证。`extraFeeds` 留了 RSS 口子（新浪 / 36氪 / 少数派都实测可达），默认空。
- **定时播报不过模型**：每天两次走 LLM 要管 key、延迟、失败降级，而热搜只有标题（没有摘要），模型也只能把标题改写一遍——模板稿零成本、可预测。想要带点评的稿子，点播时让模型自己写好再交 `news_speak { text }`。
- **逐段送 TTS**（36 字包，上限 52，规则照抄 `dsh-shorekeeper-reading/src/speech.ts`）：整段合成首字要等几秒，中途想停得等整段播完；分段后 `/v1/stop` 只损失当前这一小段。
- **不重复开口靠落盘**：`~/.dsh/keeper-news-state.json` 记「哪个档位今天播过」。dsh 重启是日常动作，只存内存的话 21:00 播完重启一次就再播一遍（keeper-watch 2026-11-16 的教训）。
- **人在不在看键鼠**：`ioreg` 的 `HIDIdleTime` 超过 `presentIdleMaxSec`（默认 10 分钟）就只推微信、不出声——别对着空房间念 40 秒。取不到空闲时按「在」处理（宁可按计划念，也别被一次 ioreg 抽风整档吞掉）。

## 工具面

| 工具 | 干什么 |
| --- | --- |
| `news_brief` | 只取要闻（不出声）：条目 + 链接 + 榜位 + 现成口播稿。用户问「今天有什么新闻」、或模型想自己组织语言时用 |
| `news_speak` | 出声播报，**立刻返回**（念完在后台）。不传 `text` 自动取要闻串稿；传 `text` 念模型写的稿；`volume` 可临时压增益（`0` = 静音验证链路） |
| `news_stop` | 停掉播报（清服务端队列） |
| `news_status` | 是否在播 / 上次播了什么 / 早晚报播过没有 / 时间点 |

`news_brief` 的渲染必须把**条目和稿子都写进文本**：模型看到的就是 render 出来的这段文字，只回一句摘要的话，模型手里什么都没有。

## 配置

profile patch 里的基线（`~/.dsh/profiles/web/cordis.patch.yml` 的 `dsh-keeper-news` 块）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `morningAt` / `eveningAt` | `08:30` / `21:00` | `HH:MM`；空串 = 不播这一档 |
| `catchUpMinutes` | `90` | 错过窗口多久内还补（机器睡着 / 实例没起） |
| `quietHours` | `23:00–07:00` | 定时播报落进来就整次跳过 |
| `count` | `5` | 一次念几条（5 条约 30 秒，8 条约 45 秒） |
| `volume` | `40` | 采样增益 0–100，不动系统音量 |
| `speed` | `1.0` | 语速 0.5–2.0 |
| `speakOnlyWhenPresent` | `true` | 有人在电脑前才出声 |
| `notifyEnabled` | `true` | 定时播报同时推一条微信文字 |
| `extraFeeds` | `[]` | 额外 RSS 源 |

面板：守岸人 → 设置 → 新闻播报（开关 / 早报时间 / 晚报时间 / 条数）。面板写 `~/.dsh/keeper-settings.json` 的 `news` 段，插件每分钟现读，改完不用重启。

> 面板与 keeper-watch 共用这一个文件——`setKeeper` 回写时必须带上 `news` 段，否则改一次提醒设置就把新闻配置抹了（`plugins/dsh-keeper-console/lib/index.js` 的 `readOverrides`）。

## 已知取舍

- keeper-tts 服务端播放队列串行：正在听书时定时新闻会排在当前段落之后。要插队只能 `news_stop`，那会一起把朗读停掉。
- 排行榜没有摘要，稿子是标题串讲。要更实的内容得接有正文的源（RSS 已留口子，但热度排序仍是百度）。
- 稿子只有 30 秒左右：想接近一分钟，把 `count` 调到 8。不硬凑字数——没有信息量的过场话听着更烦。

## 测试

```bash
npm install
npx tsc --noEmit
npx vitest run        # 46 例：源解析 / 稿子拼装 / 时段判定 / 播放与打断
```

真实联调（2026-11-18）：`news_status` 报「没在播；上次播报：还没播过；早报 08:30 / 晚报 21:00」；`news_brief` 5 条带链接与榜位、稿子 128 字；`news_speak` 传 `volume:0` 走完切段 → POST → 服务端合成（约 6 秒稿），未出声。
