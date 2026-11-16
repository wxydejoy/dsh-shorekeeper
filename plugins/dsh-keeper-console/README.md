# dsh-keeper-console

守岸人的设置面板，同时是**侧栏「守岸人」的唯一入口**：一个侧栏图标 + 一个 main 面板，
面板顶部是标签栏，内容由各插件往 `keeper.tabs` 里注册。

## 侧栏契约（2026-11-15 合并）

合并前侧栏有三行（守岸人设置 / 小说朗读 / 主屏布局），加上生态件的米家、上下文、
自动记忆，一眼看过去全是图标。现在守岸人自己只占一行：

| 槽 | 谁注册 | 说明 |
|---|---|---|
| `sidebar.panellist` | 本包（id `keeper-console`，order 42，label 守岸人） | 唯一入口，图标是盾牌 |
| `main`（key `keeper-console`） | 本包 | 壳：标题 + 标签栏 + 当前标签内容；声明子槽 `keeper.tabs` |
| `keeper.tabs`（list） | 本包（`keeper-settings` order 10）· `dsh-shorekeeper-k20`（`k20-layout` order 20）· `dsh-shorekeeper-reading`（`shorekeeper-reading` order 30） | 每格自带 RPC `inject`，壳不碰业务 |

别的插件要往里加一格，只要：

```js
ctx.slots.inject('keeper.tabs', () =>
  ctx.slots.register(
    { name: 'keeper.tabs', id: 'my-tab', order: 40, label: '我的面板', inject: () => ({ call }) },
    MyPanel,
  ),
)
```

约束：

- `keeper.tabs` 由本包的 `main` 注册声明，**只能有一个声明者**；第二个声明会抛
  `slot "keeper.tabs" is already declared`。
- 标签面板按 `order` 升序排；壳只渲染当前选中的那一格，切走即卸载（面板自己重新
  拉快照，不要把未保存的编辑状态攒在内存里）。
- 标签选择记在 `localStorage['dsh-keeper-shell-tab']`，刷新后回到上次那格。
- 面板根节点需要 `height:100%` + 自己的滚动容器（壳的 body 是 `overflow:hidden`）。

契约测试：`test/sidebar-shell.test.mjs`（打桩 React/ctx，跑三个插件的 `apply()`，
断言只注册一行侧栏、`main.children` 声明正确、标签顺序与 `inject` 齐全）。
`scripts/check-all.sh` 里跑。

## 设置页内容

朗读语音（dsh-tts / voice-mode）· 主动关怀（keeper-watch 覆盖）· 状态（keeper-tts 在线）。
控灯区已于 2026-11-16 随 `dsh-shorekeeper-desk-mi` 退役下线：控灯权限与每分钟配额改由米家 MCP
守卫持有（`~/.dsh/local-bundles/dsh-mijia-console/bundles/mijia-mcp/cordis.patch.yml` 的
`devices` / `controlPerMinute`），面板不再改写 profile patch，避免写回一个不存在的插件块。
全走 `/keeper-console` RPC 通道，不过模型；`lib/index.js` 是宿主半区，`lib/client.js` 是手写
classic bundle（无构建）。
