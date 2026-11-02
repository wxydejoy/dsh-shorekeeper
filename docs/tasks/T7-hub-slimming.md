# T7 · Hub 瘦身与退役

```
状态: doing · owner: 值班 agent · 预估: 8–12 agent 小时 · 前置: T2–T6 全部完成
分支: T7-hub-slimming    （工作在岸亭仓库，分支 Shoreting:hub-slim）
```

## 目标

岸亭 Python 侧只留真正需要的：k20 网关、keeper-tts（温湿度走米家，无需采样）。其余分阶段下线，每步配回滚开关。

## 背景

dsh 接管大脑后，hub 的大部分职责已被替代（见 refactor-map.md）。**本任务工作对象是岸亭仓库**（wxydejoy/Shoreting），本仓库只产出退役清单与验收记录。

## 步骤

### 阶段一：依赖盘点（2h）
- [ ] 盘点 server.py 全部路由的现役调用方（k20 / console / 插件），列矩阵
- [ ] mirror.py / chat_log.py / metrics.py 等未定模块逐个过，refactor-map 补行
- [ ] 产出《退役清单》：分三批（先 monitor 类 → 再 mijia/persona 类 → 最后 config/server 骨架）

### 阶段二：分批退役（4–6h）
- [ ] 每批退役 = hub.yaml 加 feature flag（默认关新开旧）→ 观察一周 → 翻转默认 → 删码
- [ ] 第一批：mini 监控、探针 CPU 上报（dsh-vitals 已接管）
- [ ] 第二批：mijia_bridge/mijia_catalog（dsh-mihome 已接管）、persona/companion_flow、media
- [ ] 第三批：setup_ui、features、server.py 冗余路由
- [ ] console 菜单栏瘦身为三件套启停器（hub-lite / keeper-tts / dsh），web 面板冻结
- [ ] 每批完成后跑岸亭全量测试 + bump_version 检查

### 阶段三：回滚演练（2h）
- [ ] 模拟「dsh 出问题」，feature flag 一键切回 0.9.0 行为，全功能剧本通过
- [ ] 回滚演练记录归档

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
（执行时追加）
