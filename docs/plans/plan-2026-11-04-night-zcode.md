# 夜班计划 · zcode（2026-11-04 晚）

> 输入：2026-11-04 白天守岸人（Claw）的 W6 真机联调与微信聊天体检（进度板 13:30 / 14:55 两行）、
> T2 文末 W6 实证记录、merge-review-m2.md。
> 接续 [plan-2026-11-03-evening-two-agent.md](./plan-2026-11-03-evening-two-agent.md)——那份的 W1–W12 已全部收口或移交，
> 挂起的人工项（W5 口吻 / W6 熄屏点头 / W7 焗屏）**仍归漂泊者，不在本班范围**。

---

## 一、开工前状态速览（2026-11-04 16:45）

| 项 | 状态 |
|---|---|
| 仓库 | main = ab61ac0，与 origin 同步，工作树仅进度板一处未提交追加（随本计划一起提交） |
| :3090 dsh 实例 | **停机**（15:0x 体检时发现模型路由改后需重启，旧实例已停；launchd 托管卡在权限，见 Z1） |
| Hub（dock-hub）| 健康，launchd `cn.weiekko.dock-hub` 常驻 :17890，token 在 `~/.config/dock-hub/hub.yaml` |
| k20 屏 | 上午在线（k20.lan:5555，应用 `cn.weiekko.dock`，背景面 :17920）；开工先 `adb connect k20.lan:5555` 探活 |
| keeper-tts | ready（:18100，shorekeeper 克隆音色，W8 的 OpenAI 兼容端点已挂） |
| 微信 | 两 bot 账号（339bb4cd / e7a07db4）都绑 shorekeeper 人格；chat/proactive 路由已钉 `glm-4.5-flash`（config.json）；**但旧会话把旧模型焊死，:3090 重启前不生效**；15:0x 起实例停机，微信机器人随之离线 |
| 已知 bug | ① 微信会话工具注册表为空（0 工具）② GLM-4-Flash 泄漏内部脚手架（已换模型，待实证）③ 旧账号会话曾过期（可能要重扫码） |

## 二、任务表（按序做，验收线各列）

| # | 任务 | 验收线 | 依赖/风险 |
|---|---|---|---|
| Z1 | **:3090 实例常驻**：plist 已备好 `~/Library/LaunchAgents/cn.weiekko.dsh-web.plist`。先试 `launchctl bootstrap gui/501 ~/Library/LaunchAgents/cn.weiekko.dsh-web.plist`；**注意：WorkBuddy agent 执行环境里 bootstrap 一律被 macOS 拦（EIO，连 /usr/bin/true 都拦，已实证）**——若你也在同类沙箱里，别死磕，改为后台拉起 `dsh web --port 3090` 完成本班验证，并把那一行命令留给漂泊者本人跑（`pkill -f 'dsh web --port 3090'; launchctl bootstrap gui/501 ~/Library/LaunchAgents/cn.weiekko.dsh-web.plist`） | 实例 HTTP 200；起来后 9 件插件全激活（看启动日志无 EPIPE/EIO） | 若插件激活报 EPIPE，是文件垫片问题——你环境里若同样发生，如实记录并降级到「协议层验证」 |
| Z2 | **微信路由实证（W5 的 agent 侧）**：实例起来后，检查 `~/.dsh/weixin/config.json` 路由仍是 glm-4.5-flash；主动消息侧会话 `wx-pro-*` 在建立时焊死模型（13:17 那个是旧路由），重启后新侧会话应走新模型——等下一次主动消息或触发一次，解 `session.v4.jsonl.zstd` 看 `request/header` 的 model 字段确认；同时确认 `<weixin_persona mode="守岸人">` 注入、回复无内部脚手架泄漏 | 新 turn 的 model=glm-4.5-flash；journal 里 out 消息无 `<weixin_proactive>`/状态提示词原文泄漏 | 旧账号 339bb4cd 若真过期需漂泊者重扫码（日志会有 messaging stopped）——遇到就记录，别反复重试 |
| Z3 | **微信工具注册表为空：根因与修复**（本班主菜）：白天已定位到——dsh-plugin-weixin 的 `src/agent-bridge.js` 靠 `agentPresets` 服务挂预设继承工具面，而 web 实例（dsh-tui 0.18.0 的 host）没提供该服务 → 裸 agent 0 工具，关台灯只会耍嘴。dsh 宿主代码在 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/lib`；console 插件（dsh-console-plugin/lib/index.js）里有 agentPresets 的用法可参考。目标二选一：a) 找到 host 上正确的服务名/挂法，给 weixin 插件打 patch（pnpm patch，同 feiyu@4.0.2 先例）让微信会话带上 k20/desk-mi/reading/voice 工具面；b) 证明 host 无解，落 docs/issue-draft 给插件作者 | 微信里说「关台灯」→ 会话里出现真工具调用（desk-mi），而非文字反问 | 改插件走分支 + check-all 绿了可推（漂泊者既有授权）；只 patch `~/.dsh/profiles/web/node_modules` 里那份的话，记录 patch 命令与落盘位置 |
| Z4 | **k20 六工具 agent 级调用（W6 全清）**：:3090 起来后在会话里把 k20_snapshot / k20_caption / k20_layout / k20_media / k20_wallpaper 各真实调一遍（HTTP 层上午已六面实证过，这步验的是插件工具壳）。caption 推一句守岸人口吻的话再清掉 | 五工具各出一次可观察效果并记录；**k20_lock 只验注册与路由，不真熄屏——熄屏红线，等漂泊者点头** | `curl` 本机/LAN 必须 `--noproxy '*'`（shell 带 http_proxy=127.0.0.1:7890，不加了是 upstream 假错） |
| Z5 | **听书链路（T5 阶段三，时间富余才做）**：keeper-tts 的 OpenAI 兼容 `POST /v1/audio/speech` 已就绪（W8/W9），把 dsh-shorekeeper-reading 的听书接上：切句规则在 `migration/books-format.md` §4（36 字打包/预取下一句/断点续读） | 指定《世说新语》某章开头，能连续朗读 ≥3 段、可停 | 打断交互可先做最简版（再来一条指令即停）；k20 字幕联动那条子项仍 ⏸ |
| Z6 | **文档收尾**：T7-hub-slimming 状态头还写着 doing，但 hub-slim 三路由已经 W8 迁进 dock main 并实证——状态头改 review 并附证据行；refactor-map 状态列同步；merge-review-m2 遗留区把 15:0x 的微信体检结论并进去 | 文档与 git log / 实况一致 | 无 |

## 三、纪律（沿用，重申四条）

1. 各自在任务分支上改，合 main 前 `bash scripts/check-all.sh` 全绿；绿了可推（漂泊者既有授权）。本班预期分支：`fix/z3-weixin-tools`（若动插件）。
2. **红线**：k20 真熄屏、米家控真灯，一律不做，等漂泊者点头。凭据只进 `~/.dsh/.credentials.yaml`。
3. 每完成一项 Z，往**本文末尾进度区**追加一行（格式：`Z# · 时间 · 谁 · 一行结论`）；Z1–Z4 的关键证据（日志行、model 字段、工具调用名）引文件路径即可，别整段贴。
4. 别提 feiyu 上游（漂泊者 2026-11-04 指示撤项）；feiyu-memory 插件本体别动。

## 四、坑（白天实证过的，别再踩一遍）

- shell 带 `http_proxy=127.0.0.1:7890`：curl 本机/LAN 必须 `--noproxy '*'`。
- `launchctl bootstrap` 在 agent 环境一律 EIO（沙箱拦，见 Z1）。
- GLM-4-Flash 会把工具调用记号/内部提示词当回复贴出来（W9 + 15:0x 两次实证）——微信链路现在钉 glm-4.5-flash，别改回去。
- 微信侧会话（wx-pro-*、主会话）路由在**建立时焊死**，改 config.json 只对新会话生效。
- k20 真值：host `http://k20.lan`、hubHost `http://127.0.0.1`、port 17890、背景面 17920、token 同 hub.yaml——live profile 已写真值，别用占位值。
- ShelfStore 启动时读盘：动书库数据后要重启实例。

## 五、进度（逐项追加，格式：`Z# · 时间 · 谁 · 一行结论`）

- 计划落档 · 2026-11-04 16:45 · 守岸人（Claw）· 六项排好（Z1 实例常驻 → Z2 路由实证 → Z3 工具面根因 → Z4 k20 六工具 → Z5 听书 → Z6 文档），红线与坑录入；开工前状态：:3090 停机等 Z1，其余各面健康
