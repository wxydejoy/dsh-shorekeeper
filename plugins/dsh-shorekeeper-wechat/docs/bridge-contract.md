# 微信桥 HTTP 契约（Windows 挂机侧 · 待实现）

> 插件（本仓库）与桥解耦：桥是 Windows 挂机机器（复用 win.lan 探针机）上的独立小服务，
> 内部跑 wcferry（路线决策见 `docs/decisions-wechat-route.md`，**接真账号前须漂泊者签字**）。
> 本契约为桥的实现规格；插件侧已按此实现 `src/bridge-client.ts` 并用 mock 全链路单测。

## 传输约定

- HTTP/1.1 JSON UTF-8；默认端口 `17901`；监听 `0.0.0.0` 时**必须**设 Bearer token
- 错误统一 `{"error": {"code": "...", "message": "中文"}}`：`401 unauthorized`、`409 wechat_offline`（桥活着但微信掉线）、`400 bad_request`

## 路由

### `GET /api/health`

```json
{"ok": true, "service": "shorekeeper-wechat-bridge", "wechatOnline": true, "account": "脱敏尾号"}
```

### `GET /api/digest`

未读会话分组，按最近消息时间倒序；`lastMessage` 桥侧截断 ≤120 字；最多 20 组。

```json
{"groups": [{"contactId": "wxid_xxx", "contactName": "备注名", "unread": 3, "lastMessage": "…", "lastAt": "2026-11-03T12:00:00+08:00"}]}
```

### `POST /api/read` `{"contactId": "...", "limit": 10}`

`limit` 1–50（桥侧再钳一次）。返回按时间正序：

```json
{"messages": [{"senderName": "成员/备注名", "text": "…", "at": "…", "kind": "text|image|voice|video|file|system"}]}
```

桥侧不留存：全文即取即用（任务书隐私红线），桥内存里最多缓存最近一次响应。

### `POST /api/send` `{"contactId": "...", "text": "..."}`

`200 {"ok": true, "at": "…"}`。桥侧同样执行白名单二次校验（纵深防御，与插件白名单同源配置）；发送频率保守（≥3s 间隔，桥侧排队）。

## 部署要点（Windows 挂机）

1. 微信客户端**锁 3.9.11.25**（WeChatFerry 配套版本；禁用官网自动更新）
2. 桥常驻（NSSM/计划任务）；wcferry 掉线自动重连，`wechatOnline` 如实上报
3. token ≥ 8 字符；局域网内明文 HTTP，仅可信网段
4. 微信升级适配空窗期：桥 409 上报，插件侧优雅降级
