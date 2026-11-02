# k20 屏网关协议增补提案（v1 扩展 · 未落地）

> 状态：**提案**。按 `reference/lan-protocol.md` §13 的规矩，加接口先改文档再写代码——本文就是那份文档。
> 客户端实现：本插件 `src/gateway.ts`（含 mock：`test/mock-hub.ts`）。
> 网关侧落地：T7 的瘦身 Hub（dock 仓库 `hub-slim` 分支）。真机验证：⏸。

## 背景

现行 v1 没有三件事的客户端入口，而它们是「k20 只当显示屏、大脑在 dsh」的必要通道：

1. **字幕推送**——守岸人说话同步的字幕（T4 钩子）。今天安卓只渲染 companion 流程里的文本，dsh 侧说话没有上屏通道。
2. **布局写入**——`GET /api/layout`（:17920）只读；写入旧体系走 Hub 下发的 `snapshot.phone.layout`（§5.6），Hub 瘦身后需要一条显式写入路由。
3. **熄屏**——设备管理员锁屏没有协议入口。

## 增补路由（全部沿用 v1 鉴权/错误格式）

### `POST /v1/caption`

```json
{"text": "守岸人要说的话", "scale": 100}
{"clear": true}
```

- `text` 非空 → `200 {"ok":true}`，snapshot 增加可选字段 `caption: {"text": ..., "at": <UTC ISO-8601>}`（`at` 供安卓去重），并递增 `seq`
- `{"clear": true}` → 清掉 caption（键回 `null`）
- `text` 与 `clear` 都缺 → `400 bad_request`
- `scale` 60–140，可选，缺省用屏上当前值

**安卓消费**：可先忽略未知字段（§13 兼容规则保证不崩）；渲染面待 k20 App 决定用独立字幕模块还是复用 companion 字幕样式。

### `POST /v1/phone/layout`

```json
{"layout": {"modules": {"Weather": {"visible": false}}}}
```

- `200 {"ok":true}`；服务端把 `phone.layout.rev` **递增**后并入 snapshot（rev 只增不减，安卓按 §5.6 既有规则「rev 变大才套用」）
- `layout` 非对象 → `400 bad_request`

**安卓改动：零**——完全复用既有 layout 下发链路。

### `POST /v1/lock`

```json
{}
```

- `200 {"ok":true}`：网关对 k20 执行设备管理员锁屏
- 网关侧**必须**再做一层审批（高危动作）；设备管理员未激活 → `502 action_error`

## 落地顺序（§13 固定顺序）

1. `openapi.yaml` 加三条 path（网关侧做，dock 仓库）
2. 本文件与 lan-protocol.md 第 4 节表格同步
3. 网关代码（T7）→ 安卓渲染（dock/android）→ 真机联调（T2 阶段三）

在此之前，本插件对这三条路由的调用会收到 404，工具层返回降级说明而非报错。
