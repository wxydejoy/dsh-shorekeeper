# wechat-bridge · 微信桥（Windows 挂机侧）

守岸人微信接入的桥服务。契约：[docs/bridge-contract.md](../docs/bridge-contract.md)；路线与封号风险：[docs/decisions-wechat-route-v2.md](../../docs/decisions-wechat-route-v2.md)（**接真账号前须漂泊者填签字区**）。

## 分层

| 文件 | 职责 | 状态 |
|---|---|---|
| `wechat_bridge.py` | HTTP 面 + 业务规则（分组截断/limit 钳位/发送节流/白名单二次校验/409 离线） | ✅ 12 条单测 |
| `fake_wcf.py` | 假适配器（测试 + 无微信联调） | ✅ |
| `wcferry_adapter.py` | wcferry 真身（Windows + 微信 3.9.11.25） | ⏸ 真机接线 TODO（T6 阶段三，集成面已收窄到四方法） |

## 测试（本机即可跑，零外部依赖）

```bash
cd bridge/tests && python3 -m unittest test_bridge -v
```

## 部署（Windows 挂机机，复用 win.lan 探针机）

1. 微信客户端**锁 3.9.11.25**（wcferry 配套；禁自动更新），登录专用小号或经签字的主号
2. `pip install wcferry`；把本目录拷到挂机机
3. 常驻：NSSM 或计划任务
   `python wechat_bridge.py --host 0.0.0.0 --token <≥8字符> --adapter wcferry --whitelist <插件白名单同源>`
4. 插件侧（dsh）：`bridgeBaseUrl: http://win.lan:17901`，`bridgeToken` 同源
5. wcferry 掉线 → 桥 409 上报 → 插件优雅降级；桥重启不丢状态（消息缓存即取即用）

## 红线

- 默认只读不发：插件总闸 `sendEnabled` 默认关；桥侧白名单二次校验纵深防御
- 验证码/转账类：插件层整条隐藏；桥不额外处理（全文不落盘）
- 凭据只进本机配置/命令行
