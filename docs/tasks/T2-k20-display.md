# T2 · dsh-shorekeeper-k20 —— 安卓屏驱动

```
状态: todo · owner: · 预估: 14–20 agent 小时 · 前置: T1
分支: T2-k20-display
```

## 目标

k20 安卓横屏摆件变成守岸人的「脸」：字幕、背景、模块编排、熄屏、媒体键、室内温湿度读数，全部注册为 agent 工具，真机逐步生效。

## 背景

k20 只当「显示屏 + 麦克风」外设，大脑在 dsh。协议见 `reference/lan-protocol.md` 快照（鉴权、长轮询、时序）；背景上传链路对照 `reference/dock_hub/wallpaper.py`；传感器与媒体键对照 `reads.py` / `media.py`。原 dsh-desk-senses 已砍——室内温湿度是手机报的，归本插件。

## 步骤

### 阶段一：协议客户端（4–6h）
- [ ] 插件包初始化：package.json（钉 dsh 版本）、tsconfig strict、vitest
- [ ] TS 重实现 LAN 协议客户端：Bearer token、`/health`、长轮询订阅、断线重连、超时
- [ ] Config 三件套：Schemastery schema（k20 地址/token/字幕样式）+ 设置卡片
- [ ] mock k20 服务器（从 reference/server.py 提取响应形状）+ 单测覆盖协议层

### 阶段二：工具面（6–8h）
- [ ] `k20.snapshot`：布局 + 背景 + 传感器（温湿度）+ 在线态
- [ ] `k20.caption`：推/清字幕（守岸人说话同步的钩子留给 T4）
- [ ] `k20.wallpaper`：图/视频上传与切换（对照 wallpaper.py 的上传即生效链路）
- [ ] `k20.layout`：模块显隐/样式/透明度
- [ ] `k20.media`：媒体键 + 系统音量
- [ ] `k20.lock`：设备管理员熄屏（高危审批，默认关闭）
- [ ] 权限分级落地：读 read-only，写/控全走 sandbox_permissions 审批

### 阶段三：联调与打磨（4–6h）
- [ ] 真机联调（k20.lan）：离线优雅降级（预览模式说明，不报错刷屏）
- [ ] 长轮询事件 → 工具回调（供 T3/T4 订阅唤醒/打断事件）
- [ ] 完成插件 README 工具面表与验收记录

## 交付物
- `plugins/dsh-shorekeeper-k20/` 完整实现 + 单测
- mock k20 服务器（测试夹具，供后续任务复用）

## 验收标准
- [ ] 会话里「把这段话打到屏上，换这张背景图，最后熄屏」真机逐步生效
- [ ] 「现在屋里多少度」经 k20.snapshot 秒答
- [ ] 拔掉 Hub，所有工具优雅降级不崩
- [ ] 熄屏/换背景在未审批时被拒

## 拓展方向 / 未来方向
- 拓展：主动事件推屏（番茄钟倒计时、天气预警卡）；Web UI 全屏预览卡片
- 未来：e-ink 副屏同工具面接入；屏幕布局存档版本化

## 风险与对策
| 风险 | 对策 |
|---|---|
| 协议快照与真机有出入 | 以真机为准，差异记录回 lan-protocol 变更记录 |
| 长轮询在插件进程内的心跳管理 | 抽成独立 service，工具只是查询面 |

## 验收记录
（执行时追加）
