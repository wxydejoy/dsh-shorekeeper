# T3/B4 runbook · tavern 全量卡上 web profile（待漂泊者点头后执行）

> 2026-11-05 夜班 zcode 起草。前置结论见计划进度区「B4 前哨」：:3090 浏览器会话目前**无人格**
> （web profile 未装 dsh-tavern），冻结阻碍已清（lab 删除+外部 Chromium 正常），本 runbook 把
> 执行步骤、坑与回滚写死，点头后约 15 分钟走完。

## 前置事实（已核实）

- tavern 全局档案 `~/.dsh/.agent-presets/tavern-lite/`：守岸人卡在位（characters.json 1 条）、
  worldbooks.json 含两条常驻条款、tavern-state.json `cardEnabled:true, mode:"global"`——
  **全局绑定早已就位**，装件即生效。
- 兼容矩阵钉版：dsh-tavern@2.7.26（T1 实测版；上游有 2.7.27，不追新）。
- web profile webServer 常在 → tavern 在 web profile 会真激活（headless 才 pending）。
- **坑①（必须处理）：双人格**。tavern 全局绑定会命中**微信会话**（cwd `~/.dsh/weixin-sessions`），
  与现役 weixin 自定义模式（persona-modes.json）叠加成双人格注入。缓解：tavern-state 的
  `disabledCwds` 加 `~/.dsh/weixin-sessions`（tavern 只服务浏览器/TUI 会话）。
  执行前先读 tavern 源码确认 disabledCwds 的匹配语义（前缀 or 精确）。
- **坑②**：TUI 会话（~/.dsh-tui 体系）也会被 tavern 注入——漂泊者自己在终端里的会话会变成
  守岸人腔。这是 B4 的本意还是误伤，**执行前问一句**；若只想要浏览器侧，用 disabledCwds
  把 TUI 的工作区一并排除。

## 步骤（点头后）

1. **装件**：`dsh plugin --profile web add dsh-tavern@2.7.26`；查 pnpm-workspace.yaml 无
   nodeLinker 残留；kickstart 重启 :3090（launchd 维护口令）。
2. **隔离微信**：tavern-state.json `disabledCwds` 加 `~/.dsh/weixin-sessions`（改完即生效或重启，
   以源码为准）。
3. **验证 A（浏览器侧有人格）**：console API 新开会话 → send「守岸人」→ 期望「在。」式短应
   （世界书常驻条款生效的证据）；再发「嗯」→ 期望不开新话题。同时 detail 里 tools 数应仍为
   86（tavern 不加工具）。
4. **验证 B（微信侧不变）**：等下一轮真实微信 turn → journal 文本风格应与 23:19「晚安。」一致
   （weixin 自定义模式独占）；若出现 tavern 腔/双注入，立即回滚第 2 步或整个第 5 步。
5. **回滚**：`dsh plugin --profile web remove dsh-tavern` + 重启 → 一切回到现状
   （浏览器会话无人格、微信侧不变）。
6. **收尾**：T3 状态头更新（web 端人格就位）；Z7 剩余 web 场景（C 组控制句话术、E19 记忆确认、
   F25 求夸）用 console API 补跑——注意 C 组会真碰灯，白天做。

## 不做什么

- 不动 weixin 人格体系（persona-modes.json / persona-active.json / config.json）。
- 不追 tavern 上游新版本。
- 不在夜间跑 C 组控制场景（真灯）。
