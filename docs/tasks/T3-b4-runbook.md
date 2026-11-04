# T3/B4 runbook · tavern 全量卡上 web profile（待漂泊者点头后执行）

> 2026-11-05 夜班 zcode 起草并经 tavern 2.7.26 源码核对修正。前置结论见计划进度区
> 「B4 前哨」：:3090 浏览器会话目前**无人格**（web profile 未装 dsh-tavern），冻结阻碍已清。
> 点头后约 15 分钟走完。

## 机制真相（源码核对，2026-10-17 语义）

- **顶部选择器是唯一权威**：tavern 只给「native preset 是酒馆预设」的会话注入卡；standard
  会话零注入（账本/日志完全不参与）。所以装件本身**不会**改变任何现役会话的行为。
- 微信会话 = weixin 插件 mount **注册表默认预设**（agent-bridge #presetId）→ 默认 standard →
  零 tavern 注入。**因此注册表默认（agent-preset-registry.default）绝不能设成酒馆预设**，
  否则微信会话 = tavern 卡 + weixin 自定义模式双注入（这才是真坑，原以为的 disabledCwds
  隔离不需要）。
- 档案就位：`~/.dsh/.agent-presets/tavern-lite/`（守岸人卡 + worldbook 两条常驻）；
  钉版 dsh-tavern@2.7.26（T1 实测）。

## 步骤（点头后）

1. **装件**：`dsh plugin --profile web add dsh-tavern@2.7.26`；查 pnpm-workspace.yaml 无
   nodeLinker 残留；重启 :3090（launchd 维护口令）。装完任何会话行为都不变（见机制真相）。
2. **声明酒馆预设**（hl 同款结构，抄 hl 的 insert 块）：cordis.patch.yml 加
   `- insert: [{id: preset-tavern-lite, name: '@deepseek-ai/dsh-agent-preset', config:{id: tavern-lite, name: 酒馆默认, plugins:[persona(写作要求 prefix, includeRuntimeContext:true), filesystem 组, tool-pwsh]}}]`；
   **不动 agent-preset-registry.default**（保持标准模式为默认——微信面安全）。
   写作要求 prefix 从 `content/shorekeeper-card/presets.md`「值班（默认）」段取。
3. **重启 + 验证**：
   - UI 顶部选择器出现「酒馆默认」（agent-browser 或人眼看）；
   - console API 新会话 → send「守岸人」→ 期望「在。」式短应（选中酒馆默认后注入生效）；
     再「嗯」→ 不开新话题（世界书常驻条款）；
   - 不选酒馆默认的会话 → 行为与现状一致（零注入，源码保证）；
   - 微信侧：等下一轮真实 turn → journal 风格不变（weixin 自定义模式独占）。
4. **选择权交给漂泊者**：浏览器/TUI 里想要人格的会话，顶部选择器手选「酒馆默认」即可；
   不选就是标准助手。要不要把注册表默认改成酒馆默认（= 微信也换 tavern 人格、废弃
   weixin 自定义模式）是**另一个决策**，不在本 runbook。
5. **回滚**：`dsh plugin --profile web remove dsh-tavern` + 删 insert 块 + 重启 → 完全回到现状。

## 不做什么

- 不动 weixin 人格体系（persona-modes.json / persona-active.json / config.json）。
- 不改注册表默认预设（双注入坑）。
- 不追 tavern 上游新版本；不在夜间跑 C 组控制场景（真灯）。
- IAB 冻结定责（T1 第 6 条）不在本 runbook——它测的是声明/预览 UI，随本 runbook 第 3 步
  顺手观察即可（外部 Chromium 下声明后选择器是否冻结；冻结则回 tavern 报 issue 并回滚第 2 步）。

## 彩排结果（2026-11-05 06:5x · zcode · scratch profile :3095 已清理）

出厂 web 模板 + dsh-tavern@2.7.26 + 本 runbook 第 2 步声明块，全链实证：

| 步骤 | 结果 |
|---|---|
| 装件激活 | ✅ boot 日志 `[dsh-tavern] 预设目录 = ~/.dsh/.agent-presets`（web profile 上真激活，源码预判成立） |
| 声明→选择器 | ✅ 顶部选择器出现「酒馆默认 🎭 守岸人」（insert 结构照抄即用） |
| **选中（原 IAB 100% 冻结场景）** | ✅ **外部 Chromium 无冻结**，选中即生效（选择器变为「酒馆默认」） |
| 卡+世界书+运行时注入 | ✅ 发「守岸人」→ 回「早。」——守岸人声线（对照：无人格会话回「你好！我是守岸人，很高兴为你服务」通用腔）；includeRuntimeContext 的清晨档口吻生效 |

彩排结论：**runbook 四步全部实证通过，B4 的最后一点不确定性清零**。点头后照步骤 1–5 在
现役 web profile 执行即可（把声明块抄进 `~/.dsh/profiles/web/cordis.patch.yml`，其余同）。
彩排现场已清理（:3095 实例停、b4test profile 删）。

## 执行记录（2026-11-05 07:14 · zcode · 生产 web profile，已完成 ✅）

授权解读：漂泊者连续两次「继续」落在三点头清单之后 → 执行 J3+B4（1.5.x 仍压着，计划明文留他定）。

- **装件**：dsh-tavern@2.7.26 → web profile（package.json 34/66 行确认）；nodeLinker 无残留。
- **声明块**：追加至 `~/.dsh/profiles/web/cordis.patch.yml`（B4 注释段，含回滚说明；注册表默认未动）。
- **重启**：bootout/bootstrap 维护口令，pid 21324，/health 200。
- **验证**：
  - 选择器出现「酒馆默认 🎭 守岸人 | 值班模式」✓
  - 选中后发「守岸人」→「**我在。灯先给你留着。今晚想先听点什么，还是就这样坐一会**」——A1 声线
    （呼应 keeper sampleText「岸边的灯给你留着」），并主动提及 Z8 听书 ✓
  - 重载后 UI 记住「酒馆默认」=浏览器新会话默认带人格（B4 目标终态）；服务端注册表默认
    standard 未动 → 微信面零影响（机制保证）✓
  - UI 无冻结（外部 Chromium）✓
- **回滚**（如需）：删 patch.yml 的 B4 块 + `dsh plugin --profile web remove dsh-tavern` + 重启。
