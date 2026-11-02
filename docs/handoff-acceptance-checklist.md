# 人工验收交接清单（2026-11-03 · 值班 agent 整理）

> 收拢散落在各任务书的全部人工项，**按建议顺序排列**。完成一项就翻掉对应任务书的 ⏸/人工标记；
> 完成后知会值班 agent，真机验证大清单（各任务书验收记录的 ⏸ 项）随之逐批解锁。

## A. T1 生态验收（30 分钟，全项目解锁的前置）

原文：[docs/tasks/T1-ecosystem-trial.md](tasks/T1-ecosystem-trial.md)「遗留人工验收清单」

1. **日历**：`:3081` 设置→日历，填 CalDAV 账号/密码（`calendar_health` 自检指路）→ `calendar_list` 出真日程
2. **米家**：`pip3 install mijiaAPI` → `python3 -m mijiaAPI login` 扫码 → 侧栏面板出设备 → **告知值班 agent 配自写薄工具层**（mijia-sidebar 无 agent 工具面，D12）
3. **语音**：`:3081` 进入语音对话模式，念一段台词 → 验证流式字幕/停顿发送/朗读/开口打断
4. **feiyu 写侧**：网页随便聊一轮 → 看 `~/.dsh/feiyu-diary/日记.md` 是否长出条目
5. **通知**：设置→通知提醒→「试一试」→ 授权；Bark 推送则填 key
6. **tavern 冻结定责**：用 **Chrome**（非 ZCode 内置浏览器）开 `:3081` → 新会话选「酒馆默认」→ 聊一句 → 正常=IAB 特有；复现=回 tavern 报 issue
7. **OpenRouter 余额**：402 时按 D8 调 maxTokens 或充值

## B. T6 微信：风险签字（接真账号的硬门槛）

原文：[docs/tasks/T6-wechat.md](tasks/T6-wechat.md) · 决策记录：[docs/decisions-wechat-route.md](decisions-wechat-route.md) §3

- [ ] 挂机用主号还是小号：______
- [ ] 接受的封号风险等级：______
- [ ] 发送白名单初始名单：______
- [ ] 默认只读不发红线确认：______
- 签完 → Windows 挂机机按 `plugins/dsh-shorekeeper-wechat/bridge/README.md` 部署桥（wcferry 四方法真机填实）

## C. dock 仓库两分支审核（岸亭侧）

- [ ] `tts-openai-endpoint`：keeper-tts 加 OpenAI 兼容 `/v1/audio/speech`（8 测）；审后合入 dock main → 重启 keeper-tts 服务生效
- [ ] `hub-slim`：retire 回滚开关（11 测，默认全关不动行为）+ 路由依赖矩阵盘点；审后合入 → 为 T7 分批退役备好闸门

## D. T3 观察（值班 agent(T1 会话) 负责，无需人工）

T3 正在该 agent 手上收敛：阶段一/二产出 + 6 条 headless 批判已落档，**已自行并入 main 并采纳文档审查修订**（2a2a6cc）。回归剧本跑批完成后合 main，即触发 M2 里程碑判定。

## E. push 决策

main 领先 `origin/main` 41+ 提交（T2/T4/T5/T6/T8 全部产出 + 文档修订），未 push。发布动作由漂泊者拍板：`git push origin main`。

## F. 真机验证大清单（A–C 完成后逐批解锁）

- 端到端十条：[docs/e2e-scenarios.md](e2e-scenarios.md)
- 各任务书验收记录的 ⏸ 项：T2（真机联调/设置卡片/审批接线）· T4（barge-in 二层/唤醒词决策）· T5（书架扩充后抽查）· T6（真收消息/PoC/渗透自测）· T7（分批翻转/回滚演练）· T8（装机演练/十条走查）
