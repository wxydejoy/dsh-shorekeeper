# T1 · 生态验证与 profile 底座

```
状态: todo · owner: · 预估: 10–14 agent 小时 · 前置: 无
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
- [ ] **dsh-mihome**：先演示模式跑通全部工具 → 真账号登录（可能被小米风控卡死，见风险）→ 控一个真灯
- [ ] **dsh-weather**：定位/多城市/恶劣天气提醒实测
- [ ] **dsh-vitals**（+ dsh-pc-manager 对比）：Mac 本机 CPU/内存/温度读数与活动监视器核对
- [ ] **@doitian/dsh-music**：搜索/播放/队列/AI DJ 工具实测，音质与登录链路
- [ ] **dsh-voice-mode**：中文流式 STT 准确率（念一段岸亭台词）+ barge-in 打断延迟 + 字幕浮层 + Edge TTS 质量
- [ ] **dsh-tavern vs dsh-roleplay**：角色卡 V2 导入、世界书触发、与 voice-mode 共存性
- [ ] **dsh-calendar + dsh-calendar-diary**：CalDAV 连接、xlsx 导入格式确认（对照 migration/ 的导出格式）
- [ ] 记忆插件 3 选 1 实测：dsh-memory-center / dsh-full-life-memory / memsearch（写入确认、检索质量、与 tavern 兼容）
- [ ] dsh-mobile-notify（可选）：Bark 推一条真机通知

### 阶段三：沉淀（2h）
- [ ] 产出《替代决策清单》：每个岸亭模块 → 生态件/自写/保留，更新 docs/refactor-map.md 状态列
- [ ] 产出 `profile/` 安装清单初版（钉版本号）
- [ ] 更新根 README 与 plan v1 中与验证结论冲突处

## 交付物
- `docs/decisions.md`（dsh 版本、安装方式、各项选型）
- `profile/` 安装清单初版
- 各插件验证记录（本文档末尾）
- refactor-map.md 状态列更新

## 验收标准
- [ ] 米家：演示模式控灯成功；真账号结论明确（成功或切换 HA 路线的决策已记录）
- [ ] 语音：voice-mode 完成一轮带打断的中文对话，字幕可见
- [ ] tavern：载入一张测试角色卡并正常对话
- [ ] 决策清单覆盖 v1 方案全部生态件，无「未验证」遗留

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
（执行时追加，含日期、证据）
