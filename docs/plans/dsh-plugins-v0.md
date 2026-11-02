# 岸亭 → DSH 插件化改造 · 初版计划（v0）

> 2026-11-02 · 状态：**已废弃，被 [v1](dsh-plugins-v1.md) 取代**（v1 改为原生替代 + 生态复用，本方案的桥接路线不再执行）
> 目标：把 Shoreting 的核心能力拆成若干个 DeepSeek Harness（DSH）插件，让人（漂泊者）直接在 dsh 会话里用自然语言指挥整个书桌亭。

---

## 0. 一句话方案

在 dock 仓库开新分支 `dsh-plugins`，新建 `dsh/` 子目录作为插件 monorepo；**保留 Hub/TTS 等 Python 服务原样运行，DSH 插件作为 TS 壳通过局域网协议桥接**；先做 1 个内核插件 + 7 个能力插件，共 8 个任务，每任务预估 8–30 agent 小时（≈人工 100–300 小时），可并行分派。

---

## 1. 关键调研结论（决定方案形态）

### 1.1 DSH 是什么

DSH（DeepSeek Harness）是「一切皆插件」的智能体框架，Cordis 运行时，developer preview 阶段（会有破坏性变更）。一个 DSH 插件 = 四件事：

| 部分 | 落点 |
|------|------|
| 能力（工具/命令） | 入口 `apply(ctx)`，`ctx.tools.register(defineTool({...}))`，需先 `export const inject = ['tools']` |
| 设置 | `Config` 类型 + Schemastery schema，host 侧 `ctx.settings.installSection()`，browser 侧绑设置卡片 |
| 权限 | 安装期 `allowBuilds`；运行期工具的 `sandbox_permissions` 分级 |
| 依赖 | `package.json`；`dsh.bundle` 标记决定加载层，落在 `$DSH_HOME/profiles/<name>/` |

其他要点：插件可捆绑 skill（注册进 `ctx.skills`）、可做 MCP 客户端（`@deepseek-ai/dsh-mcp-client`）；本地安装 `dsh plugin add`，验证 `dsh --profile web --dump-config`。

### 1.2 岸亭现状盘点

| 模块 | 语言 | 规模 | 插件化适配度 |
|------|------|------|------|
| hub/dock_hub（米家+伴侣+协议+日记/周报/日历/书籍） | Python | ~20,700 行 | 有 OpenAPI 契约（docs/openapi.yaml），**HTTP 桥接成本最低** |
| companion/tts（守岸人 TTS） | Python | 服务 | 已是独立端口 `:18100`，直接桥接 |
| mini（Mac 监控） | Python | 小 | HTTP `:17891`，桥接 |
| console（控制台+菜单栏+Vite web） | Py+Swift+TS | 中 | Web 部分可演化为 DSH Web UI 卡片 |
| android（Kotlin 客户端） | Kotlin | 大 | **独立设备端，不做成插件**；插件通过 Hub 协议驱动它 |

### 1.3 核心架构决策：桥接优先，局部 TS 化

- **桥接优先**：Hub 已有 Bearer token + OpenAPI 契约，插件只是 TS 里的 HTTP 客户端 + 工具注册。风险低、见效快、Python 服务不用动。
- **局部 TS 化**：只有「守岸人人格与对话策略」（persona/intents 的提示词与意图规则）值得在插件侧 TS 化，因为它是「模型的教养」，天然属于插件层。其余重写无收益。
- **边界**：android 是摆件不是插件；唤醒词、麦克风这类硬件链路留在安卓端，插件只通过 Hub 推字幕/收语音文本。

---

## 2. 工作目录与分支策略

```
仓库: wxydejoy/Shoreting，新分支: dsh-plugins（从 main 拉出）
目录:
dsh/
  README.md                 # 插件族总览与开发规范
  plugins/
    shoreting-core/         # T1 内核桥接
    mijia/                  # T2 米家
    desk-senses/            # T3 环境感知
    shorekeeper/            # T4 守岸人
    desk-media/             # T5 媒体与桌面
    desk-life/              # T6 生活仪式
    k20-display/            # T7 安卓屏驱动
  packages/
    hub-client/             # 共享 TS 客户端（协议、token、长轮询）
  reference/                # 从 hub/dock_hub 复制的 Python 底料，只读参照，供编辑时对照
  profile/                  # 本地测试 profile（cordis.patch.yml / dsh.profile.bundles）
  skills/
    shoreting-ops/          # 把 docs/companion.md 提炼成运维 skill，随 core 捆绑
```

- `reference/` 就是「复制代码到某个目录」的落点：复制 `hub/dock_hub/*.py`、`companion/tts/server.py` 的相关文件，**只读**，作为各任务改写/对齐协议的依据。
- 每个任务一个子分支：`dsh/T1-core`、`dsh/T2-mijia`……完成后合回 `dsh-plugins`。
- 主分支 `main` 不动，岸亭本身照常发布。

---

## 3. 任务分解（8 个任务）

> 每个任务字段：目标 / 内容与步骤 / 拓展方向 / 未来方向 / 验收。工作量按 agent 连续工作小时估（≈人工 100 倍）。T2–T7 依赖 T1；T2/T3/T5/T6 彼此可并行；T4 最重，内部再拆两段。

### T1 · dsh-shoreting-core —— 桥接内核与脚手架（P0，预估 10–14h）

**目标**：搭起整个插件族的骨架，产出第一个真正能装、能调 Hub 的插件。

**内容与步骤**：
1. 建 `dsh-plugins` 分支与目录结构；写 `dsh/README.md` 开发规范（命名、Config schema、权限分级、测试约定）。
2. 复制 Python 底料到 `dsh/reference/`（service.py、server.py、config.py 等）。
3. 写 `packages/hub-client`：OpenAPI 对应的 TS 客户端——token 管理、`/health` 探活、长轮询订阅、错误重试；vitest 全覆盖。
4. 写 core 插件：注册 `shoreting.status` / `shoreting.nodes` / `shoreting.health` 工具；Config 声明 hub 地址与 token（Schemastery schema + 设置卡片）；捆绑 `shoreting-ops` skill。
5. 本地 `dsh plugin add` 装进 `dsh/profile`，`--dump-config` 验证加载层；跑通真实 Hub。

**拓展方向**：hub-client 支持 WebSocket/事件流；节点（win.lan / k20.lan）自动发现；token 轮换工具。
**未来方向**：core 成为其他插件的硬依赖与能力协商中心；发布到 DSH Plugin Hub。
**验收**：`dsh plugin list` 可见；会话里问「岸亭状态」能返回 Hub 健康、三端在线情况；单测 ≥ 90% 对 hub-client 生效。

### T2 · dsh-mijia —— 米家设备控制（P0，预估 8–12h）

**目标**：在 dsh 会话里用自然语言控制灯/开关/场景。

**内容与步骤**：
1. 对照 `reference/mijia_bridge.py` + `mijia_catalog.py`，经 Hub API 实现工具：`mijia.list_devices`（房间/类型/在线态）、`mijia.control`（开/关/亮度/色温）、`mijia.scene`（一键场景）。
2. 输出 schema 严格化：设备名模糊匹配 → 返回候选列表让模型二次确认，防误控。
3. 权限分级：查询 `read-only`，控制走 `sandbox_permissions` 提级审批。
4. 设置卡片：设备别名映射（「台灯」→ miio.xxx）。
5. 用 `--list-devices` 真机核对；写 mock hub 单测。

**拓展方向**：定时/条件自动化（「22:30 自动关台灯」）；功耗查询。
**未来方向**：设备目录本地缓存与增量同步；把米家场景暴露成 DSH 可组合的 workflow 节点。
**验收**：会话说「把台灯调到 30% 暖光」真实生效；误关风险场景有确认流程。

### T3 · dsh-desk-senses —— 环境感知与监控（P0，预估 10–14h）

**目标**：让守岸人「有体感」：天气、室内温湿度、两台电脑的负载自动进入上下文。

**内容与步骤**：
1. 工具：`senses.weather`（室外）、`senses.indoor`（温湿度）、`senses.pc`（Win/Mac CPU/内存/GPU，对照 reference/reads.py、metrics.py 与 mini、探针协议）。
2. 主动注入：用长轮询/定时采样把「感知摘要」注入会话上下文（CPU 飙高、下雨等事件触发），不只是被动查询。
3. Config：采样间隔、事件阈值（如 CPU > 85% 持续 1 分钟播报）。
4. mock 数据 + 真机（win.lan 探针、mini.lan:17891）双路测试。

**拓展方向**：历史趋势查询（「今天下午电脑什么时候最热」）；接入更多传感器（光照、噪音）。
**未来方向**：感知事件流成为 shorekeeper 主动搭话的素材源；异常检测（电脑过热→提醒）。
**验收**：会话里问「现在屋里多少度、我电脑什么状态」一次答对；阈值事件能主动出现一次（日志可查）。

### T4 · dsh-shorekeeper —— 守岸人本体（P1，预估 20–30h，内部拆两段）

**目标**：把「守岸人」从 Hub 的对话流搬进 dsh：人格、说话、字幕、打断，做成插件族的心脏。

**T4a 人格与对话策略（10–15h）**：
1. 通读 `reference/persona.py`、`companion_flow.py`、`intents.py`，提炼成 TS 的 persona 模块 + 捆绑 skill（第一人称、守岸人对漂泊者的语气、官方口径「这个称呼就很好」等既定事实写死）。
2. 意图层 TS 化：控制类意图（开灯/查监控）直接路由到本族其他插件的工具；陪伴类意图走人格回复。
3. 记忆：短期会话记忆 + 关键事实沉淀（对接 DSH 记忆插件生态，先桥接后选型）。

**T4b 语音链路（10–15h）**：
1. `keeper.speak` 工具：文本 → Hub 朗读管线 → TTS `:18100 --play`；对照 reference 的朗读/打断时序（边写边念、打断停播、反问自动再听）。
2. 字幕推送：说话时同步推安卓字幕（经 Hub 长轮询）。
3. 打断协议：「小岸」唤醒打断 → 插件侧感知并中止当前 speak 流。

**拓展方向**：多语气模式（值班/晚安/工作陪跑）；情绪状态机。
**未来方向**：完全脱离 Hub 的独立大脑（LLM 直连由插件 Config 管理）；语音克隆配置进设置卡片。
**验收**：dsh 会话里喊话，守岸人用本人格回话并在安卓屏出字幕、Mini 出声；中途「小岸」能打断。

### T5 · dsh-desk-media —— 媒体与桌面控制（P1，预估 8–10h）

**目标**：语音/会话控制音乐、音量、白名单程序。

**内容与步骤**：
1. 工具：`media.playpause/next/prev`（手机媒体，通知使用权链路）、`media.volume`（对照 system_volume.py）、`desk.launch`（Windows 白名单程序，走 win 探针）。
2. 播放状态查询工具，供守岸人聊天时知道「你在听什么」。
3. companion/tts 的 `music.py`/`noise.py`（白噪音）桥接为 `media.ambience`。

**拓展方向**：歌单/电台；专注模式（白噪音+勿扰联动）。
**未来方向**：与 desk-life 的番茄钟联动（工作段落自动配乐）。
**验收**：会话说「放点白噪音，声音小一点」全链路生效。

### T6 · dsh-desk-life —— 生活仪式（P1，预估 12–16h）

**目标**：日记、周报、日历、书架变成 dsh 里的可持续资产。

**内容与步骤**：
1. 对照 `reference/diary.py`、`weekly.py`、`calendar.py`、`books.py`（合计 ~2270 行），实现：`life.diary`（写/查/情绪回顾）、`life.weekly`（周报生成与归档）、`life.calendar`（今日/添加日程）、`life.books`（书架与进度）。
2. 数据兼容：继续读写 Hub 侧现有存储，不迁移数据格式。
3. 与 shorekeeper 联动：睡前仪式（守岸人发起日记引导对话）。
4. 每个子域独立单测 + Hub 真实数据回归。

**拓展方向**：情绪曲线可视化（DSH Web 卡片）；年度回顾。
**未来方向**：记忆层联动——日记自动沉淀为长期记忆事实。
**验收**：会话里说「记一笔今天的日记」落库且旧数据可查；周报能生成。

### T7 · dsh-k20-display —— 安卓屏驱动（P2，预估 10–12h）

**目标**：安卓摆件成为 dsh 的「输出外设」：字幕、背景、模块编排、熄屏。

**内容与步骤**：
1. 工具：`display.caption`（推字幕）、`display.wallpaper`（经 wallpaper.py 的上传链路）、`display.layout`（模块显隐/样式/透明度）、`display.lock`（设备管理员熄屏）、`display.media`（主屏媒体控制）。
2. 对照 `docs/lan-protocol.md` 全量核对时序（先改文档再改码的仓库规矩照旧）。
3. 预览模式兼容：Hub 离线时工具返回优雅降级说明。

**拓展方向**：屏幕小部件（天气卡、倒计时）由 dsh 动态排版。
**未来方向**：e-ink 副屏等新硬件接入同一工具面。
**验收**：会话里「帮她把背景换成这张图，然后熄屏」逐步生效且安卓端状态正确。

### T8 · 集成、发布与验收（P1，预估 8–12h）

**目标**：8 个插件合成一个能开箱即用的 profile。

**内容与步骤**：
1. `dsh/profile` 一键脚本：安装全族插件 + 写入默认 cordis.patch.yml。
2. 端到端剧本测试：十条真实生活场景（起床问天气→控制灯→陪聊→记日记→熄屏）逐条走查。
3. 插件卡片文案、版本号、兼容标注（DSH preview 版本钉死范围）。
4. 决定发布形态：GitHub Release 起步 → 提交 DSH Plugin Hub。

**拓展方向**：console 的 Vite web 演化为 DSH Web UI 卡片（仪表盘）。
**未来方向**：岸亭 v1.0 = 岸亭自持运行 + dsh 全能力面；Hub 逐步瘦身成纯设备网关。
**验收**：新机器从 `dsh profile` 安装到全功能可用 ≤ 30 分钟。

---

## 4. 里程碑

| 里程碑 | 内容 | 预计 agent 总工时 |
|--------|------|------|
| M1 内核可用 | T1 + T2 + T3 合回 | ~30h |
| M2 会说话的守岸人 | T4 + T5 合回 | ~50h |
| M3 完整亭子 | T6 + T7 + T8 合回，发布 | ~85h |

## 5. 风险与未决问题（需要拍板）

1. **DSH 处于 developer preview**：API 会破坏性变更。对策：版本钉死 + T8 做兼容矩阵。
2. **长轮询注入上下文的成本**：感知摘要注入策略若太吵会污染会话。对策：T3 事件阈值保守起步。
3. **人格一致性**：T4 的 TS 化 persona 与 Hub 现行为可能漂移。对策：reference 底料 + 对话回归剧本。
4. **待拍板**：a) 插件族是否发公开 registry（涉及米家 GPL 传染问题——hub 依赖 mijia-api GPL-3.0，公开分发需同样开源）；b) console/menubar 是否保留（T8 的 Web 卡片可能取代它）；c) `dsh/` 放本仓库还是独立新仓库（本计划按本仓库）。

## 6. 下一步

评审通过后：建 `dsh-plugins` 分支 → 执行 T1 步骤 1–2（半小时内可完成）→ 各任务开子分支分派。
