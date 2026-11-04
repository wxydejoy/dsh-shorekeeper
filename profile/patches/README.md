# profile/patches · 插件 pnpm patch 档案

install.sh 会把这些 patch 拷进 profile 的 patches/ 并登记 pnpm-workspace.yaml（同 feiyu@4.0.2 先例）。

| patch | 内容 |
|---|---|
| dsh-plugin-weixin@1.4.3.patch | ①主动消息消毒 sanitizeProactiveText（Z2b：剥脚手架/提取正文/纯状态回声跳过，防中毒循环）；②toolDenylist（提速①：微信会话经 tools.restrict({deny}) 裁掉用不上的工具 schema，83→28 个，prompt 81KB→约 25KB；默认空=不裁剪，名单配在实例 cordis.patch.yml 的 dsh-plugin-weixin 段） |
| feiyu-memory@4.0.2.patch | UNSUPPORTED_REASONING_EFFORT 兼容（上游不提 issue，漂泊者 2026-11-04 指示） |
| draft-dsh-plugin-weixin@1.5.10.patch.md | **草稿非补丁**（install.sh 不会碰它）：1.5.10 升级预打——消毒+toolDenylist 两段 diff 已对 1.5.10 语义核对并语法验证，升级时按文件头说明走正规 pnpm patch 流程 |
