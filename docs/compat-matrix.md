# T8 · 版本钉死与兼容矩阵（框架）

> DSH 处于 developer preview，破坏性变更频繁。原则：**升级先跑矩阵，再动版本钉**。
> 每次升级 dsh：填一列，绿了才改 profile/install.sh 的 DSH_VERSION。

## 钉死的版本

| 件 | 版本 | 钉在哪 |
|---|---|---|
| @deepseek-ai/dsh | 0.2.2-rc.3 | 各插件 package.json `engines.dsh` + install.sh |
| @deepseek-ai/dsh-tools | 0.2.2-rc.3 | 插件 devDeps（含全套 peer，见 T4 验收记录） |
| keeper-tts / mlx-audio | 锁 0.5.0 | dock/companion/tts pyproject（README：0.6.x 无收益不冒 API 风险） |

## 兼容矩阵（dsh 版本 × 组件）

| 组件 | 0.2.1-rc.5 | 0.2.2-rc.3（2026-11-16 升级） | 下个版本（待测） |
|---|---|---|---|
| dsh-tools defineTool DSL | ✅ 实测（T2/T4/T5/T6 插件 typecheck+单测） | ✅ 全仓库 7 个插件 tsc + vitest 全绿（补 devDep `@deepseek-ai/dsh-error`：新版 dsh-agent 传递依赖它，缺则 vitest 收集不到用例） | ⏸ |
| ctx.tools.register | ✅ | ✅ web profile :3090 正常注册，工具行无报错 | ⏸ |
| Schemastery Config（默认导出） | ✅ | ✅ 配置节全部加载，无 schema 冲突 | ⏸ |
| voice-mode 与 dsh 共装 | ✅ profile 内共装已由 T1 实测（isolated linker 配方 D3，已入钉版清单）；⚠️ npm devDep 侧仍 ERESOLVE——用 `--legacy-peer-deps` + 显式钉 dsh-tools 全套 peers（T4 验收记录） | ✅ profile 内共装照旧；npm devDep 侧仍需 `--legacy-peer-deps` | ⏸ |
| dsh-tts custom provider | ✅（配置接线路径确认，真机 ⏸） | ✅ TTS :18100 正常，kickstart 后探活通过 | ⏸ |
| SDK Events（dispose 钩子） | ❌ 无 dispose 事件——watcher 卸载接线悬置（T2 TODO） | ❌ 仍未补（`inject=['tools']` 生命周期不变） | ⏸ 关注是否补生命周期事件 |
| ctx.settings.installSection | ❌ 未暴露——设置卡片待 T1 校准 | ❌ 仍未暴露 | ⏸ |
| 插件 version gate（engines.dsh 硬闸） | —（rc.5 时代未拦） | ⚠️ **0.2.2 起对 profile bundle 硬拦**：不兼容即「skipping profile bundle」，不再降级运行。已升：dsh-arrowkey-nav 0.5.7→0.5.10、dsh-ops 0.4.4→0.5.5、@deepseek-harness-tui/dsh-tui 0.18.0→0.20.1 | 升级前先 `npm view <pkg>@latest engines.dsh` 对表 |

### 0.2.2-rc.3 升级打点（2026-11-16）

- 装法：`npm install -g @deepseek-ai/dsh@0.2.2-rc.3`，**必须用 homebrew node（v25）的 npm**；WorkBuddy 自带的 node 22 npm 全局前缀指向 `~/.workbuddy/binaries/node/…/bin`，renames bin 时报 EIO 装不上。
- 安装被打断后 bin 软链会停在 `.dsh-XXXX` 临时名，`dsh` 命令直接消失；补 `ln -sfn ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js /opt/homebrew/bin/dsh` 即可（包装好了，缺的只是软链）。
- pnpm 侧偶发 `ERR_PNPM_EIO [symlinkAllModules]`：虚拟目录里只剩依赖软链、包本体没落地。删掉 `node_modules/.pnpm/<pkg>+<ver>_*` 后 `pnpm add <pkg> --force` 可修复。
- `pnpm add --force` 会重跑整棵树，**微信 5 文件 patch 未受影响**（patchedDependencies 生效，升级后 shasum 逐一比对一致）。

### 2026-11-16 插件瘦身（同一次维护窗口）

判据不是「装没装」，而是**实际工具调用次数**（解压 `~/.dsh/sessions/*/*.jsonl.zstd` 统计 `type:"tool-call"`）：

- 卸 **dsh-keeper-agenda**：`feeds: []` 常空，`desk_agenda` 全库只调过 1 次；日历实际由 `dsh-calendar`（`calendar_list`/`schedule_list`）承担。
- 卸 **dsh-keeper-voice**：只提供 `keeper_status/stop/noise/voice_test`，全库 0 次调用；正式说话走 dsh-tts 的 custom provider 直连 keeper-tts :18100，不经过它。代价：barge-in 少一层 `keeper_stop` 兜底（dsh-tts `/v1/stop` + voice-mode VAD 仍在）。
- 留：desk-mi（`desk_mi_*` 140+ 次；当天晚些整套退役，见下节）、k20（`k20_*` 28 次）、reading、console（侧栏壳）、watch（无工具但每天真推 PM2.5 告警）。
- 操作口径：先改 `~/.dsh/profiles/web/cordis.patch.yml` 删对应 insert 块（注释留回滚说明）→ `dsh plugin --profile web remove <pkg>` → 重启 → 本轮启动日志无 `failed to import`。仓库源码**保留**，install.sh 不再链接这两件。

### 2026-11-16 接入米家 MCP 工具面（第三方插件 dsh-mijia-console）

`dsh-mijia-sidebar` 1.0.1 只有 `slots`/`webServer`，**没有 `tools` 注入**，模型无法在对话里操作米家。补装第三方 `dsh-mijia-console`（上游 3bbd899，MIT，落在 `~/.dsh/local-bundles/`，本地化差异见该目录 `PATCHES.md`）：

| 依赖的 dsh API | 0.2.2-rc.3 实测 |
|---|---|
| `@deepseek-ai/dsh-mcp-client`（stdio，`serverName/transport/command/args/toolCallTimeoutMs/failOnStartupError`） | ✅ 自带 0.2.2-rc.3，14 个工具注册为 `mcp__mijia__*` |
| `ctx.tools.guard(fn)`（执行层白名单，fail-closed） | ✅ 存在，激活无报错 |
| `ctx.tools.get(name).execute(args, {signal})`（面板复用同一 MCP 连接） | ✅ 面板读写走通 |
| `ctx.webServer.register({kind:'exact'|'prefix'})`、`ctx.slots.register('sidebar.panellist'/'main')` | ✅ 路由与面板均生效 |
| `ctx.systemPrompt.section` + `getSectionOrder('MCP_SERVERS')` | ✅ |

- Python 运行时：`uv venv ~/.local/share/mijia-api/venv --python 3.12` + `mijiaAPI[mcp]`（需 fastmcp）；**复用已有 `~/.config/mijia-api/auth.json`，无需重扫**。
- 安装坑：WorkBuddy 沙箱的 fs shim 会让 pnpm 建 link 依赖时 `EIO (os error 2)`，**必须 `ssh localhost` 跑 pnpm**（同 launchctl 的处理方式）。`dsh plugin add` 只改依赖，**还要手工把 bundle 名追加进 profile `dsh.profile.bundles`**，否则 patch 不生效。
- 型号差异（照抄作者配置会错）：`iot.acpartner.x2` 的 mode 枚举是 0制冷/1制热/2自动/3送风/4除湿，与作者那台**顺序完全不同**；`xiaomi.light.lamp31` 色温上限 5100K 而非 6500K；三台都没有 `electric-power`，用电卡片不适用。

### 2026-11-16 desk-mi 退役（米家工具面并入 MCP）

米家 MCP 落地后，`dsh-shorekeeper-desk-mi` 的 4 个工具被覆盖或失效，整套下线：

| 原工具 | 去向 | 判据 |
|---|---|---|
| `desk_now` | 删，不再需要 | dsh 0.2.2 内置 `@deepseek-ai/dsh-time-context`，三个 preset 都在启用，每步注入带时区的 ISO 时间与流逝时长；「运行时无时钟」这个 11-03 的前提已不成立 |
| `desk_mi_list` | `mcp__mijia__list_devices` | 逐字段更全（含 model/online） |
| `desk_mi_sensor` | `mcp__mijia__get_device_properties`（卧室/耗材温湿度计已进白名单，`readOnly: true`） | 实测回 `{temperature: 24.7, relative-humidity: 59, battery-level: 100}` |
| `desk_mi_light` | `mcp__mijia__set_device_property`（`on` 属性，显式 true/false） | 白名单 did 精确匹配，另多出色温/模式/功率 |
| 每分钟配额（TokenBucketLimiter 10/min） | 迁到 `@local/mijia-mcp` 的 `controlPerMinute` | 守卫内按 did 分桶，被拒文案带等待秒数；单测覆盖超额/越权/toggle/只读四路 |
| 微信灯控快路径（`globalThis.__shorekeeperFastLight`） | **消失，接受** | 微信侧 `dsh-plugin-weixin` 已判 `typeof fastLight === 'function'`，未挂载直接进模型，不崩；代价是「开灯」慢 3–5 秒（多一次 LLM 往返） |

- 操作：`cordis.patch.yml` 删 desk-mi insert 块（注释里留 8 行回滚）→ profile `package.json` 删 dependency 与 `dsh.profile.bundles` 条目 → `ssh localhost 'pnpm install'`（沙箱 EIO）→ 重启。仓库源码与 34 条单测**保留**，`check-all` 仍跑。
- 连带改动：k20 的 `k20_snapshot` 描述从「问室温用 desk_mi_sensor」改成 MCP 工具名；keeper-console 面板下线「控灯开关/配额」两行（旧代码会往 profile patch 写回一个已不存在的插件块）。
- 端到端实证：console API 起会话 → `mcp__mijia__get_device_properties` 读到 24.7 ℃ / 59 % → 模型答出数值+单位+电池，并自述控灯走 `set_device_property`、did 钉死不替人挑灯。

### 顺带修掉的 `openai` 残包（同窗口发现）

dsh 升级事故的遗留：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/openai/` 只剩 365 个文件、**没有 `package.json`**、缺 `auth/workload-identity-auth.js`，任何 LLM 调用报 `PI_AI_ERROR Cannot find module './auth/workload-identity-auth.js'`。修法：`npm pack openai@7.19.0`（版本取自残包 `version.js`）→ 旧目录备份到 `~/.dsh/backups/openai-broken-20261116` → `rsync -a` 覆盖（365 → 3548 文件）→ 重启。装/升 dsh 时若 npm 中途被打断，要顺手核一遍 `node -e "require('openai')"`。

### 2026-11-16 二次瘦身：删 dsh-mijia-sidebar + 修 patch 命中 id

- **删 `dsh-mijia-sidebar` 1.0.1**：`export const inject = ['connection','webServer']`，只注册一个纯展示面板，无 tools、无服务面；米家控制台（`@local/mijia-console`）落地后完全重复。删 dependency + `dsh.profile.bundles` 条目，侧栏只剩「守岸人」与「米家控制台」。
- **patch 命中 id 的坑（重要）**：`cordis.patch.yml` 的 `- id: dsh-plugin-weixin` **一直没命中**——bundle 装进来的 entry id 是 `dsh-weixin`。判据只有一条：`dsh --profile web --dump-config` 里该 entry 上方有没有 `patched by …/cordis.patch.yml`，config 里有没有你写的键。
  - 改成 `- id: dsh-weixin` 后立即出现 `patched by` + `toolDenylist`（65 条）+ `busyMessageMode: interrupt`。
  - **连带后果**：`busyMessageMode: interrupt` 此前同样没生效（忙碌时按默认 queue 排队），提速①的「83→28 工具」裁剪也**可能**从未真正应用（未追溯；下次微信 turn 后看 openclaw 日志里有没有 `tool deny list applied (N names)` 即可定性）。
  - 通用口径：patch 按 **entry id** 定位，不是包名，也不是 name。写完必须 dump 一次核对。
- **微信米家工具面 14 → 5**：deny 掉 `list_homes` / `list_scenes` / `list_consumables` / `get_device_spec` / `run_scene` / `run_speaker_command` / `speaker_play` / `login` / `login_status`；保留 `list_devices` / `get_device_properties` / `set_device_property` / `run_device_action` / `get_statistics`。`tools.restrict({deny})` 是**精确名 Set** 匹配，不支持通配，只能逐个列。


## 升级流程（每次）

1. 新开 `bump/dsh-<ver>` 分支，改四件套版本钉
2. 跑 `bash scripts/check-all.sh`
3. 真机走查 docs/e2e-scenarios.md 至少 1/6/7/10 四条
4. 填矩阵列，绿则合入并更新 install.sh；红则记录偏差与豁免（dsh 的 version-exemptions 机制）
