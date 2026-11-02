# T8 · 版本钉死与兼容矩阵（框架）

> DSH 处于 developer preview，破坏性变更频繁。原则：**升级先跑矩阵，再动版本钉**。
> 每次升级 dsh：填一列，绿了才改 profile/install.sh 的 DSH_VERSION。

## 钉死的版本

| 件 | 版本 | 钉在哪 |
|---|---|---|
| @deepseek-ai/dsh | 0.2.1-rc.5 | 各插件 package.json `engines.dsh` + install.sh |
| @deepseek-ai/dsh-tools | 0.2.1-rc.5 | 插件 devDeps（含全套 peer，见 T4 验收记录） |
| keeper-tts / mlx-audio | 锁 0.5.0 | dock/companion/tts pyproject（README：0.6.x 无收益不冒 API 风险） |
| 微信客户端（桥用） | 3.9.11.25 | T6 桥部署文档（wcferry 配套） |

## 兼容矩阵（dsh 版本 × 组件）

| 组件 | 0.2.1-rc.5 | 下个版本（待测） |
|---|---|---|
| dsh-tools defineTool DSL | ✅ 实测（T2/T4/T5/T6 插件 typecheck+单测） | ⏸ |
| ctx.tools.register | ✅ | ⏸ |
| Schemastery Config（默认导出） | ✅ | ⏸ |
| voice-mode 与 rc.5 共装 | ✅ profile 内共装已由 T1 实测（isolated linker 配方 D3，已入钉版清单）；⚠️ npm devDep 侧仍 ERESOLVE——用 `--legacy-peer-deps` + 显式钉 dsh-tools 全套 peers（T4 验收记录） | ⏸ |
| dsh-tts custom provider | ✅（配置接线路径确认，真机 ⏸） | ⏸ |
| SDK Events（dispose 钩子） | ❌ 无 dispose 事件——watcher 卸载接线悬置（T2 TODO） | ⏸ 关注是否补生命周期事件 |
| ctx.settings.installSection | ❌ 未暴露——设置卡片待 T1 校准 | ⏸ |

## 升级流程（每次）

1. 新开 `bump/dsh-<ver>` 分支，改四件套版本钉
2. 跑全部插件 `npm run typecheck && npm test`（k20 24 / keeper-voice 11 / reading 10 / wechat 15）
3. 真机走查 docs/e2e-scenarios.md 至少 1/6/7/10 四条
4. 填矩阵列，绿则合入并更新 install.sh；红则记录偏差与豁免（dsh 的 version-exemptions 机制）
