# 下一步工作计划 · 2026-11-03 夜

> 依据：11-03 凌晨到 08:34 那一轮的产出与遗留（34 个提交、九支任务全合入 main）。
> 攒额度模式：按 P0 → P1 → P2 → P3 顺序做，做完一段就把进度写回本文件，别一次性铺开。
>
> **【2026-11-03 18:3x 状态更新】** 本文 P0–P3 的执行已被
> [plan-2026-11-03-evening-two-agent.md](./plan-2026-11-03-evening-two-agent.md)
> 接管（确认单拍板后的双人分工版，W1–W12）。本文的「漂泊者答复」「明确不做」两节仍然有效，
> 与确认单冲突处以 [confirmations-2026-11-03.md](../confirmations-2026-11-03.md) 为准——
> 注意其中 T6 路线已两次改向，最终口径见 [decisions-wechat-route-v2.md](../decisions-wechat-route-v2.md)（个人微信扫码，不再是本文答复第 2 条的 Claw 接入口径）。

## 昨晚做到了哪

- **T9 desk-mi** 从零到端到端：`desk_now` + 米家只读（list/sensor）+ 受控灯闸门，9 测绿，真机只读验过（22 设备、卧室 25.4°C/58%）
- **T3 人格工程** 三轮 headless 校准 11 条过、6 条批判落档，角色卡/世界书/三预设/周报 skill/27 条剧本齐，日记迁移脚本已迁 3 条
- **T1 生态验证** 选型定案（D7–D15）、profile 钉版清单、米家验过大半
- **T2 k20** 真 HTTP 集成套件 8 条入库，中途揪出两个真 bug（网关三参 HubError 等）
- 合并：T9 → T1 → T3 → T2（三次）全部进 main，出了 M2 合并复核报告

## 已知问题（今晚开场先收拾）

1. **main 不是全绿**：`plugins/dsh-shorekeeper-k20/test/gateway.live.test.ts` 4 处类型错误，`check-all.sh` 判红。vitest 不查类型、CI 因未 push 而不跑，所以一直没暴露。错误原文：
   - `(33,23) TS2339` `CaptionState` 上不存在 `scale`
   - `(54,18) TS2739` rect 字面量缺 `y` `w` `h`
   - `(63,57) TS2739` rect 字面量缺 `y` `w` `h` `visible`
   - `(68,33) TS2339` 在 `{}` 上取 `requested_at`
2. **check-all.sh 漏了 desk-mi**：循环只跑 k20/keeper-voice/reading/wechat，desk-mi 那 9 条单测从没进过全量检查
3. **装机严重落后**：运行中的 `shorekeeper-lab` profile 13 个包，自写插件只有 desk-mi；k20 / keeper-voice / reading / wechat 四个都没装。`profile/install.sh` 里已列 5 个但没跑过
4. **误跟踪文件**：`main` 上有 `.worktrees/docs/docs/handoff-acceptance-checklist.md`（`.worktrees/` 已在 .gitignore，但这个文件是加 ignore 之前提交的），现在主工作树显示为已删除
5. **状态头失真**：9 个任务书还写着 todo/doing，实际九支已全合入 main
6. **未 push**：main 领先 origin 75 个提交（2026-11-03 10:14 已获授权，可推）

## P0 · 修红（约 30 分钟）

- 修 k20 那 4 处类型错误：按实际 `CaptionState` / rect / 响应的 schema 改测试字面量，不要用 `as any` 糊过去
- 在 `.worktrees/desk-mi` 或临时分支跑 `npx tsc --noEmit` + `npx vitest run`，确认 k20 全绿
- `scripts/check-all.sh` 把 `dsh-shorekeeper-desk-mi` 加进插件循环（注意 desk-mi 的运行时依赖在 `dependencies`，file: 链接前需先本地 `npm install`）
- 收尾标准：`bash scripts/check-all.sh` 输出「════ 全部绿色」

## P1 · 装机（约 1–2 小时，本轮重点）

- 把四个自写插件装进 `shorekeeper-lab`：k20 / keeper-voice / reading / wechat
  - 优先走 `profile/install.sh`；若脚本对已存在 profile 不幂等，就手工 `npm install file:` 四个，再核对 `package.json` 依赖与 `cordis.patch.yml` 默认值
- 重启 dsh 网关（:3081，当前 pid 85541），冒烟四件事：
  1. k20 工具面出现（caption / media / lock 三个工具可见）
  2. reading 能读书架（走真实数据，别只跑 mock）
  3. keeper-voice 注册成 TTS provider，`POST /v1/audio/speech` 能出音频
  4. wechat 工具存在但 `sendEnabled` 默认关，白名单外硬拒
- 踩坑一律回灌 `profile/install.sh` + `profile/README.md`（昨晚 T9 的两个坑就是这么回灌的）

## P2 · 一致性与卫生（约 40 分钟）

- 9 个任务书状态头对齐真实状态：已合入 main 的写 `review`（人工项未清的）或 `done`，并在验收记录里注明合入提交
- 清掉 `main` 上误跟踪的 `.worktrees/docs/...` 文件（`git rm --cached` + 提交），确认 `.gitignore` 已覆盖
- 同步 `docs/refactor-map.md` 状态列（desk-mi 那行从 🔵 改 🟢，mijia_bridge 标退役去向已落地）

## P3 · 里程碑材料（约 40 分钟）

- 更新 M2 判定材料：原文写「三支合完 + A 组人工验收过半」，改成「九支全合 + 装机自检结果」，把今晚的自检证据贴进去
- 出一份 push 前清单（改动范围、测试证据、待人工项），**已获授权 push**（见「漂泊者答复」第 5 条）

## 漂泊者答复（2026-11-03 10:14，已拍板）

逐条对齐上面「明确不做」的六项，此后以本节为准：

1. **T1 六项**
   - 日历 CalDAV：**不填**，功能先保留，不阻塞验收
   - 语音：**不新录**，用旧项目里守岸人的语音文件做测试素材
   - feiyu 写侧：**由 agent 继续推进**（web 会话跑一轮，看 `~/.dsh/feiyu-diary/日记.md` 是否长条目）
   - 通知授权：**允许**（弹窗时点允许）
   - tavern 冻结定责：**手动跑一次**（由漂泊者点一下，agent 记录现象）
   - OpenRouter 余额：**不处理**，沿用当前在用的 GLM 线路
2. **T6 微信**：不走「插件直连真账号」那条路。改用**合规路线——用现有插件把微信 Claw 接进 dsh**，作为一条入口通道；不碰真账号，因此**封号风险与发送白名单两项作废**。
3. **米家控灯**：**同意真控一次**（仅一次，验完即停，仍保持默认关闸）。
4. **dock 两分支**：`tts-openai-endpoint`、`hub-slim` 都**先看**，agent 不出手合并。
5. **push**：**推**。授权把本地提交推到 origin/main。

### 答复落地后的口径变化

- 原先「不许 push」的纪律解除：今晚每段收工且 `check-all.sh` 全绿后可推。
- 米家从「只读不控」放宽到「允许一次真控」，但必须当场记录前后状态，控完立刻恢复默认关闸。
- T6 从「等签字」变成「按 Claw 接入路线做」，不再需要人工风险确认。
- T1 只剩三项真要人动手：语音素材给文件、通知弹窗点允许、tavern 手动跑一次。

## 明确不做（仍要等人）

- dock 仓库两分支审核（`tts-openai-endpoint`、`hub-slim`）——漂泊者先看，agent 不合

## 执行纪律

- 全程在自己的任务分支上改，合 main 前必须先让 `check-all.sh` 全绿
- 每完成一个 P 段，把结论追加到本文件末尾的「今夜进度」，不要只在对话里说
- 单段超时（P0 30 分钟、P1 120 分钟、P2/P3 各 40 分钟）就停下写阻塞，别硬啃
- 别碰 `reference/`，别把凭据写进仓库，高危工具保持默认关

## 今夜进度

（值班 agent 逐段追加）
