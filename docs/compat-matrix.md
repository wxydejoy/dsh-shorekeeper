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

## 升级流程（每次）

1. 新开 `bump/dsh-<ver>` 分支，改四件套版本钉
2. 跑 `bash scripts/check-all.sh`
3. 真机走查 docs/e2e-scenarios.md 至少 1/6/7/10 四条
4. 填矩阵列，绿则合入并更新 install.sh；红则记录偏差与豁免（dsh 的 version-exemptions 机制）
