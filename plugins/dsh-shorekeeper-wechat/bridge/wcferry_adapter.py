"""wcferry 真身适配器（Windows + 微信 3.9.11.25 + wcferry 包）。

⏸ 真机接线（T6 阶段三）：本文件在 Windows 挂机机上按 wcferry 实际 API 填实。
当前版本把集成面收窄到四个方法，全部 TODO 标注；wcferry 不可导入时明确报错，
不静默降级——桥崩可重启不丢状态（任务书风险对策），插件侧会优雅降级。

部署要点见 bridge/README.md；封号风险与签字要求见 docs/decisions-wechat-route.md。
"""

from __future__ import annotations


class WcferryUnavailable(RuntimeError):
    pass


class WcferryAdapter:
    """WcfAdapter 真身。微信客户端必须锁 3.9.11.25（wcferry 配套版本）。"""

    def __init__(self) -> None:
        try:
            from wcferry import Wcf  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover - 仅 Windows 真机路径
            raise WcferryUnavailable(
                "wcferry 未安装或不可用：本适配器只能在 Windows 挂机机上运行（pip install wcferry）"
            ) from exc
        # TODO(真机)：初始化 wcf 实例；注册消息回调滚动缓存最近消息
        # （按 contactId 分组、各留最近 50 条；全文即取即用，进程重启即清）
        self._wcf = Wcf()
        self._contacts: dict[str, str] = {}
        self._buffer: dict[str, list[dict]] = {}

    def online(self) -> bool:
        # TODO(真机)：wcf.is_login()（或等价探活）；掉线由重连循环自愈
        raise NotImplementedError("真机接线 TODO：T6 阶段三")

    def account(self) -> str | None:
        # TODO(真机)：self._wcf.get_self_info() 昵称/脱敏尾号
        raise NotImplementedError("真机接线 TODO：T6 阶段三")

    def digest_groups(self) -> list[dict]:
        # TODO(真机)：从消息缓存聚合未读分组（contactId/contactName/unread/lastMessage/lastAt），
        # 按最近消息时间倒序；contactName 用备注名优先
        raise NotImplementedError("真机接线 TODO：T6 阶段三")

    def recent_messages(self, contact_id: str, limit: int) -> list[dict]:
        # TODO(真机)：从缓存取该会话最近 limit 条（senderName=群成员名或备注名；kind 归一化）
        raise NotImplementedError("真机接线 TODO：T6 阶段三")

    def send(self, contact_id: str, text: str) -> None:
        # TODO(真机)：self._wcf.send_text(text, receiver=contact_id, aters="")；
        # 失败抛 BridgeError(502, "send_error", ...)
        raise NotImplementedError("真机接线 TODO：T6 阶段三")
