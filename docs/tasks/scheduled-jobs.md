# 定时任务登记 · Shorekeeper

> 2026-11-04 立档（漂泊者指令：同步更新计划和定时任务文档）。
> 2026-11-04 22:20 漂泊者点头，**J1/J2/J5/J7 已建为 WorkBuddy automation（ACTIVE）**，
> 卡以 automation 为准，本表降级为对账表；改动调度须两边同步。
> 纪律：automation 建卡用 WorkBuddy 的 automation_update，**不许**用 crontab/launchd 手写绕过登记。

| # | 频率 | 做什么 | automation | 调度 | 状态 |
|---|---|---|---|---|---|
| J1 | 每日 | **实例健康检查**：`:3090`（dsh web）、`:17890`（dock-hub /health）、`:18100`（keeper-tts）三件探活（curl --noproxy '*'）；正常只报一行，异常写 `~/.dsh/logs/health-YYYY-MM-DD.md` 并汇报 | ✅ `317453f8` | 每日 09:30 | ACTIVE |
| J2 | 每日 | **微信 journal 巡查**：当日 journal 里 `<weixin_` 字节串计数（中毒循环复发哨兵，>0 即报）、out 空串率、主动消息条数 vs 限额（proactiveMaxPerDay=10） | ✅ `537208cc` | 每日 22:00 | ACTIVE |
| J3 | 每周 | **retire 观察期巡查**（✅ Z10 已完工 2026-11-05：`retire.monitoring: true` 已生效、回滚演练过）：岸亭 hub 闸门状态、k20 app 掉线横幅抽查（adb 长轮询 ESTABLISHED；k20 走 dsh 直链，hub monitoring 面与屏无关联，巡查重在闸门未被误改+companion 面 200） | ⏸ 未建 | 每周（建议周日，与 J7 错开半小时） | **可建，待漂泊者点头** |
| J4 | 每日 | **glm 配额巡查**：quota-watch 插件已在实例内做 idle/重置（legacy 开关已强制关），此项只登记去重，勿重复造轮子 | ❌ 不建 | — | 插件承担 |
| J5 | 每日 | **微信会话延迟抽样**：最近 wx turn 的 journal 时间差 + 会话流水 request/header 拆模型步耗时，对比 2026-11-04 基线 43s（思考保留定调），追加 `~/.dsh/logs/latency-baseline.md` | ✅ `f37afd44` | 每日 23:00 | ACTIVE |
| J6 | 机器重启后 | **launchd 常驻重试**：~~机器级 bootstrap 修复前不重试~~ ✅ **2026-11-04 22:40 已修复并常驻**（`cn.weiekko.dsh-web` RunAtLoad+KeepAlive，kill -9 自愈实证；bootstrap 须走 `ssh localhost` 会话，见夜班计划 Z1）。launchd 自己管重启，此项**降级为 J1 的探活对象之一，无需独立任务** | ✅ 已修复 | launchd | 无需建卡 |
| J7 | 每周 | **书库/日记备份核验**：`~/.dsh/data/reading` 与 feiyu 日记目录存在且可读（只读核验，报文件数/最新日期） | ✅ `91f417d1` | 每周日 21:00 | ACTIVE |
