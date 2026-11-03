# dsh-shorekeeper-desk-mi · desk 薄工具层

守岸人的「嘴」够得到的最后一层：**时钟 + 米家只读面 + 受控灯**。
动机与证据见 `docs/tasks/T9-desk-tools.md`（T3 校准 L4：运行时上下文无时钟；T1 D12：mijia-sidebar 无工具面）。

## 工具面

| 工具 | 权限 | 说明 |
|---|---|---|
| `desk_now` | read-only | 本地日期/时间/星期/时段（ISO + 中文口语两套）。**报时必须走这里，不许凭上下文猜** |
| `desk_mi_list` | read-only | 米家设备列表（did/名称/型号/在线态） |
| `desk_mi_sensor` | read-only | 温湿度实时读数（配置 name→did 映射；`desk_mi_sensor` 缺省读 `defaultSensor`） |
| `desk_mi_light` | **写·默认关** | 开/关/调亮度；`controlEnabled=false` 时一律拒绝（红线：米家写入走审批） |

## 配置

- `pythonBin`：默认 `python3`，需已装 `mijiaAPI`（`pip3 install --user mijiaAPI`）
- `sensors`：`[{name: 卧室, did: blt.3.x}]` 映射
- `defaultSensor`：「屋里多少度」默认读哪台
- `controlEnabled`：**默认 false**。开闸 = 漂泊者明确点头（记录进 T1 验收记录）

## 架构

```
TS 工具面 (src/tools.ts)  ──spawn──▶  py/mi_bridge.py  ──mijiaAPI──▶  米家云
        JSON 单文档契约；stderr+退出码 3/4/5（无凭据/过期/缺依赖），工具端翻译成人话
```

凭据：`~/.config/mijia-api/auth.json`（与 dsh-mijia-sidebar 共享，扫码一次即可）。

## ⚠️ 安装要点（T9 首个踩坑，T8 install.sh 同样适用）
自写 TS 插件以本地路径 `dsh plugin add file:…` 链接进 profile 时，**插件目录必须先 `npm install`**：
isolated linker 下 TS 源码从插件自身路径解析 `@deepseek-ai/dsh-tools`，没有本地 node_modules 就
`failed to import`（boot 静默降级，工具不注册）。且运行时依赖（dsh-tools/schemastery/cordis）必须放
`dependencies` 而非 `devDependencies`（file: 依赖不装 devDeps）。

## 验收

- [x] `npm test`：9 条（闸门/降级/读数摘要/离线拒绝/越界拒绝）
- [x] 真机只读：22 台设备列表；卧室温湿度计 25.4°C/58%（2026-11-03）
- [ ] 真机控灯一次（需漂泊者点头后开闸）
