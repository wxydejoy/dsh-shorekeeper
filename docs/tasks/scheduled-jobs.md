# 定时任务登记 · Shorekeeper

> 2026-11-04 立档（漂泊者指令：同步更新计划和定时任务文档）。
> 本文件登记**该按周期跑、且不需要人在场**的例行任务。每项一表：
> 频率 · 做什么 · 现状 · 触发方式 · 可否转 WorkBuddy automation。
> 真 automation（环境级定时触发）由漂泊者点头后从「建议 automation」列建，不擅自建。

| # | 频率 | 做什么 | 现状 | 触发方式 | 建议 automation |
|---|---|---|---|---|---|
| J1 | 每日 | **实例健康检查**：`:3090`（dsh web，探活 curl --noproxy '*'）、`:17890`（dock-hub /health）、`:18100`（keeper-tts）三件探活；异常把摘要写 `~/.dsh/logs/health-YYYY-MM-DD.md` | 未跑（手工排障时才看） | 手工 / automation | ✅ 每日 09:30 只读探活，异常时汇报 |
| J2 | 每日 | **微信 journal 巡查**：当日 journal 里 `<weixin_` 字节串计数（中毒循环复发哨兵）、out 空串率、主动消息条数 vs 限额（proactiveMaxPerDay=10） | 未跑（消毒补丁后靠肉眼） | 手工 / automation | ✅ 每日 22:00 只读统计，计数>0 即报 |
| J3 | 每周 | **retire 观察期巡查**（Z10 翻 `retire.monitoring` 后生效）：岸亭 hub 闸门状态、k20 app 掉线横幅抽查（adb 长轮询 ESTABLISHED） | 未生效（闸门全关，无需巡查） | 手工 | ⏸ Z10 完工后启用 |
| J4 | 每日 | **glm 配额巡查**：quota-watch 插件已在实例内做 idle/重置（legacy 开关已强制关），此项只登记去重，勿重复造轮子 | 插件承担 | 实例内 | ❌ 已有，不建 |
| J5 | 每日 | **微信会话延迟抽样**：取当日最近一个 wx turn 的 request/header 与 journal 时间差，记模型步耗时（思考保留定调下的基线监控，供 prompt 瘦身前后对比） | 未跑（今晚手工掐表 43s 基线） | 手工 / automation | ✅ 每日 23:00 读一条流水出数 |
| J6 | 机器重启后 | **launchd 常驻重试**：机器级 bootstrap 修复（error 5）前不重试；修复后验证 `cn.weiekko.dsh-web` 常驻 | 占位（修复前禁跑） | 人工窗口 | ⏸ 修复后改为开机自检 |
| J7 | 每周 | **书库/日记备份核验**：`~/.dsh/data/reading` 与 feiyu 日记目录快照存在且可读（写前备份机制已有，这里只核验） | 未跑 | 手工 / automation | ✅ 每周日 21:00 只读核验 |

## 纪律

- 巡查类一律**只读**：只统计、只写报告文件，不改配置不动数据；发现异常报漂泊者，不自行处置（修闸门、重启实例这类动作按红线走）。
- curl 本机/LAN 必须 `--noproxy '*'`（http_proxy 假错坑）。
- automation 建卡用 WorkBuddy 的 automation_update，**不许**用 crontab/launchd 手写绕过登记——每张卡在本文档必须有对应行。
