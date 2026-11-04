# T7 · Hub 瘦身与退役

```
状态: review（hub-slim 三路由已迁 dock main 并真机实证；k20 已直连 dsh:3090、companion 面由网关代理回 hub 服役中；retire 闸门机制已落地未翻批——三批退役与回滚演练待 Z10 起步 · 2026-11-04） · owner: 值班 agent · 预估: 8–12 agent 小时 · 前置: T2–T6 全部完成
分支: T7-hub-slimming    （工作在岸亭仓库，分支 Shoreting:hub-slim）
```

## 目标

岸亭 Python 侧只留真正需要的：k20 网关、keeper-tts（温湿度走米家，无需采样）。其余分阶段下线，每步配回滚开关。

## 背景

dsh 接管大脑后，hub 的大部分职责已被替代（见 refactor-map.md）。**本任务工作对象是岸亭仓库**（wxydejoy/Shoreting），本仓库只产出退役清单与验收记录。

## 步骤

### 阶段一：依赖盘点（2h）
- [x] 盘点 server.py 全部路由的现役调用方（k20 / console / 插件），列矩阵（岸亭仓库 `docs/t7-route-dependency-matrix.md`：36 个路由面 × 调用方 + 模块退役批次，三批划分）
- [x] mirror.py / chat_log.py / metrics.py 等未定模块逐个过，refactor-map 补行（矩阵 §3 模块级批次表：保留/待定/一/二/三批逐行给出，ledstrip/launch/system_volume 等 ⏸ 项标注依赖 T1/T2）
- [x] 产出《退役清单》：分三批（先 monitor 类 → 再 mijia/persona 类 → 最后 config/server 骨架）

### 阶段二：分批退役（4–6h）
- [x] 每批退役 = hub.yaml 加 feature flag（默认关新开旧）→ 观察一周 → 翻转默认 → 删码（机制落地：`hub/dock_hub/retire.py` 五组闸门 `retire:` 默认全 False = 0.9.0 行为；分派层 404 `retired`；翻转即回滚；11 条单测 + 真身 venv 冒烟导入 + check_protocol 对账不漂移）
- [ ] 第一批：mini 监控、探针 CPU 上报（⏸ dsh-vitals 真机验收后翻 `retire.monitoring`）
- [ ] 第二批：mijia_bridge/mijia_catalog（⏸ `retire.mijia`）、persona/companion_flow（⏸ `retire.companion`）、media
- [ ] 第三批：setup_ui、features、server.py 冗余路由（⏸ 待一、二批观察期结束）
- [ ] console 菜单栏瘦身为三件套启停器（⏸）
- [ ] 每批完成后跑岸亭全量测试 + bump_version 检查（⏸ 随各批）

### 阶段三：回滚演练（2h）
- [ ] 模拟「dsh 出问题」，feature flag 一键切回 0.9.0 行为，全功能剧本通过（⏸ 真机；机制上 retire 组翻回 false 即恢复，协议对账脚本把着关）
- [ ] 回滚演练记录归档（⏸）

## 交付物
- 岸亭仓库：瘦身 PR + feature flag 机制
- 本仓库：退役清单、每批验收记录、回滚演练记录

## 验收标准
- [ ] 瘦身后十条生活场景剧本仍通过
- [ ] 回滚演练一次成功
- [ ] 岸亭测试全绿，版本检查通过

## 拓展方向 / 未来方向
- 拓展：网关收敛为单二进制
- 未来：v1.0 大扫除（退役代码从 main 移除）

## 风险与对策
| 风险 | 对策 |
|---|---|
| 退役批次拆错导致服务断 | feature flag 默认保守；每批独立可回滚 |
| console 菜单栏误伤 | 只动它管的列表，不碰启停逻辑 |

## 验收记录

### 2026-11-03 · 值班 agent · 阶段一完成 + 阶段二机制落地
- **盘点**（岸亭仓库 hub-slim 分支 `docs/t7-route-dependency-matrix.md`，145 行）：36 个路由面 × 调用方矩阵（android/console-server/console-web/mini/tts/外部/测试逐一 grep 回读）；现役三支柱结论（snapshot 保留、console 读面第三批、companion 链路第二批）；模块级退役批次表（含 ledstrip/launch/system_volume 三个 ⏸ 待 T1/T2 判定项）；5 个实机不确定点全部标 ⏸（access 日志/抓包）。
- **回滚开关机制**（`hub/dock_hub/retire.py` + `HubConfig.retire` + server.py 分派层接线）：五组路由闸门（mijia/companion/music/calendar_diary/monitoring），**默认全 False = 0.9.0 行为不动**；未知组名/非 bool 直接 ValueError（typo 防护）；`/v1/snapshot` 与 `/health` 永不退役（有单测钉死）；404 响应带回滚提示；模块退役标记集中在 `RETIRE_CANDIDATE_MODULES` 常量（不逐文件撒注释）。
- **验证**：`test_retire.py` 11/11；dock/hub/.venv 真身解释器 `import dock_hub.server` OK；`scripts/check_protocol.py` 对账「没有漂移」（34 代码/36 文档，路由面未变）；hub.yaml.example 已带 retire 注释段。
- ⏸ 待真机：各批翻转（先立后破：dsh-mihome/vitals/music 件验收 → 观察 → 翻开关 → 改 openapi → 观察一周 → 删码）、回滚演练、console 菜单栏瘦身。
