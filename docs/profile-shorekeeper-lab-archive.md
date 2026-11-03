# shorekeeper-lab profile 归档（W2a · 2026-11-04 删除前落档）

> 依据：[plan-2026-11-03-evening-two-agent.md](./plans/plan-2026-11-03-evening-two-agent.md) W2a
> （18:35 漂泊者修向：守岸人全量收敛 web profile，:3081 实例退役）。
> 配置原样备份：`~/.dsh/backups/shorekeeper-lab-profile-2026-11-04.tar.gz`（9.4 KB，不含 node_modules）。
> 本文档 = 拆解前的最后快照，迁移去向见 §3。

## 1. 已装 bundle 清单（package.json dependencies）

| 包 | 版本 | 迁移去向 |
|---|---|---|
| feiyu-memory | ^4.0.2 | ✅ 已迁 web（W2） |
| dsh-mijia-sidebar | ^1.0.1 | ✅ 已迁 web（W2） |
| dsh-shorekeeper-desk-mi | link:.worktrees/desk-mi/... | ✅ 已迁 web（改为 link 仓库主 checkout） |
| dsh-calendar | ^0.14.3 | ⏸ 按需（W2 定案：暂无需求未装） |
| dsh-plugin-weixin | — | 本就装在 web（W4，:3081 从未装过） |
| @doitian/dsh-music | ^1.2.0 | 🗑 随 profile 退役 |
| dsh-glass-weather | ^0.3.0 | 🗑 退役 |
| dsh-muv-engine | ^0.4.8 | 🗑 退役 |
| dsh-muv-table | ^0.3.6 | 🗑 退役 |
| dsh-notify-me | ^1.17.0 | 🗑 退役 |
| dsh-tavern | ^2.7.26 | 🗑 退役（tavern 数据在 ~/.dsh/tavern-data 全局，未删） |
| dsh-vitals | ^0.1.19 | 🗑 退役 |
| dsh-voice-mode | ^0.7.34 | 🗑 退役（语音模式未列入 W2 迁移面） |
| dsh-weather-panel | ^1.8.0 | 🗑 退役 |

## 2. cordis.patch.yml 全文（拆解前原样）

```yaml
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
- id: ui-settings-general
  name: "@deepseek-ai/dsh-client-ui-settings-general"
  config:
    welcomeNoticeVersion: 2026-09-28.1
# T1: UI 添加的 OpenRouter provider（llm-pi-ai 服务），key 在 ~/.dsh/.credentials.yaml refs
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      openrouter:
        apiKeyEnv: OPENROUTER_API_KEY
        modelOverrides:
          "deepseek/deepseek-v4.1-flash-1017":
            maxTokens: 16384
          "~deepseek/deepseek-flash-latest":
            maxTokens: 16384
          "deepseek/deepseek-v3.2":
            maxTokens: 16384
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: openrouter
    model: deepseek/deepseek-v4.1-flash-1017
# >>> tavern 声明（T1 手工补写：dsh-tavern 2.7.26 声明预览有前端卡死 bug，浏览器流程走不通）
- insert:
    - id: preset-default
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: default
        name: 酒馆默认
        description: 🎭 守岸人·测试 | T1 测试预设（手工声明）
        order: 10
        plugins:
          # 酒馆管理面板生成
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: |-
                # 写作要求
                你是角色扮演助手。请严格扮演当前角色，保持人设，自然地推动剧情。
                所有思考、推理、内心独白必须使用中文。
                【工具规则】角色扮演/创作中默认不使用工具，不主动搜索对话历史/记忆/文件；只有用户明确要求查文件、读硬盘或搜索时才允许使用文件工具，并且只做用户要求的那一件事。
              includeRuntimeContext: true

          # 基础文件工具（仅在用户明确要求时使用，角色扮演中默认不用）
          - id: filesystem
            name: cordis:group
            group: true
            isolate:
              fs: true
            config:
              - id: fs-local
                name: '@deepseek-ai/dsh-fs-local'
                config:
                  cwd: !!js process.env.DSH_CWD ?? process.cwd()
              - id: str-replace-editor
                name: '@deepseek-ai/dsh-tool-str-replace-editor'
                config:
                  maxOutputChars: 16000

          - id: tool-pwsh
            name: '@deepseek-ai/dsh-tool-pwsh'
# T9 desk-mi：传感器映射 + 控制闸门（默认关）
- id: dsh-shorekeeper-desk-mi
  config:
    sensors:
      - name: 卧室
        did: blt.3.1mc438kgkcg00
      - name: 耗材
        did: blt.3.1mdoet55c4c01
    defaultSensor: 卧室
    controlEnabled: false

# T9/T3：守岸人·晚安 预设声明（手工，D14 格式）
- insert:
    - id: preset-goodnight
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: goodnight
        name: 守岸人·晚安
        description: "🎭 守岸人 | 睡前模式：更短更轻，仪式优先"
        order: 11
        plugins:
          # 酒馆管理面板生成
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: |-
                你在扮演守岸人，现在是深夜档。比平时更短、更轻，少堆诗意，不用感叹号。
                优先陪他收尾：把明早要紧事记进记忆、灯调暗、一句送睡。不追问今天过得怎么样。
                报时用「已经X点了。」。所有思考与回复用中文。
              includeRuntimeContext: true

          # 基础文件工具（仅在用户明确要求时使用，角色扮演中默认不用）
          - id: filesystem
            name: cordis:group
            group: true
            isolate:
              fs: true
            config:
              - id: fs-local
                name: '@deepseek-ai/dsh-fs-local'
                config:
                  cwd: !!js process.env.DSH_CWD ?? process.cwd()
              - id: str-replace-editor
                name: '@deepseek-ai/dsh-tool-str-replace-editor'
                config:
                  maxOutputChars: 16000

          - id: tool-pwsh
            name: '@deepseek-ai/dsh-tool-pwsh'

# T9/T3：守岸人·工作陪跑 预设声明（手工，D14 格式）
- insert:
    - id: preset-work
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: work
        name: 守岸人·工作陪跑
        description: "🎭 守岸人 | 工作模式：少闲聊，计时与提醒优先"
        order: 11
        plugins:
          # 酒馆管理面板生成
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: |-
                你在扮演守岸人，工作档。他在写代码/赶工：回答直接、短，不主动闲聊。
                计时（「25分钟番茄」「记时长」）、定时提醒、日程查询优先办理；
                他烦躁时「少说话，先办事，不要讲道理」——把工具递过去，别递鸡汤。
                完成后可以给一句壁纸式的短句收尾。所有思考与回复用中文。
              includeRuntimeContext: true

          # 基础文件工具（仅在用户明确要求时使用，角色扮演中默认不用）
          - id: filesystem
            name: cordis:group
            group: true
            isolate:
              fs: true
            config:
              - id: fs-local
                name: '@deepseek-ai/dsh-fs-local'
                config:
                  cwd: !!js process.env.DSH_CWD ?? process.cwd()
              - id: str-replace-editor
                name: '@deepseek-ai/dsh-tool-str-replace-editor'
                config:
                  maxOutputChars: 16000

          - id: tool-pwsh
            name: '@deepseek-ai/dsh-tool-pwsh'
```

## 3. 迁移用到的配置 → web profile 落点

| lab 配置 | web 落点 |
|---|---|
| desk-mi 传感器映射（卧室 blt.3.1mc438kgkcg00 / 耗材 blt.3.1mdoet55c4c01、controlEnabled: false） | ✅ web cordis.patch.yml（原样） |
| feiyu-memory 配置 | 无需迁（bundle 自带默认，dataDir 全局 ~/.dsh/feiyu-diary） |
| mijia-sidebar 配置 | 无需迁（凭据 ~/.config/mijia-api/auth.json、面板配置 ~/.dsh/mijia-sidebar.config.json 全局） |
| openrouter provider + agent-default-model（deepseek-v4.1-flash-1017） | ❌ 未迁——web 用智谱 GLM-4-Flash（本机 2026-11-03 定的路线，key 在全局 credentials）。如需换回 openrouter 改 web cordis.patch.yml 即可 |
| 守岸人三预设（default/goodnight/work 的 persona prefix） | ⏸ W4a 人格绑定时的素材（§2 已全文存档）；tavern 本体不迁 |
| k20 / keeper-voice / reading | 全局首装进 web（:3081 从未装过，无配置可迁；k20 插入项用 T8 占位值，真机值 W6 校准） |

## 4. 独占数据核查（删除前置条件）

- 凭据：`~/.dsh/.credentials.yaml` 全局 ✅
- 日记/档案：`~/.dsh/feiyu-diary/` 全局 ✅（web 的 feiyu 已实证写入，B5/W11）
- 会话：`~/.dsh/sessions/` 全局；profile 目录内无 sessions ✅（计划定案「会话不保留」）
- 米家：`~/.config/mijia-api/auth.json` + `~/.dsh/mijia-sidebar.config.json` 全局 ✅
- 书库：`~/.dsh/data/reading/` 全局 ✅（web 冒烟已用真实数据）
- profile 目录内仅有包管理文件 + .plugin-manager 操作日志（已入备份包）✅
- 其他配置对 shorekeeper-lab 的引用：无（grep ~/.dsh/*.toml *.json 无命中）✅

## 5. 删除记录

- 2026-11-04 00:1x · 甲 · W2a：备份包落 `~/.dsh/backups/`（本文档 §2 全文即其 cordis.patch.yml）→ kill :3081 实例（PID 85541）→ `rm -rf ~/.dsh/profiles/shorekeeper-lab` → 复核 :3081 无监听、:3090（web）不受影响。验收线「归档在 docs、:3081 不再监听、web 不受影响」见计划进度区 W2a 行。
