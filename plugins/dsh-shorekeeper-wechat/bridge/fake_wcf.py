"""假 wcferry 适配器：测试与无微信环境联调用。数据形状与真身一致。"""

from __future__ import annotations


class FakeWcfAdapter:
    def __init__(self) -> None:
        self._online = True
        self._account = "尾号 8888"
        self._groups: list[dict] = [
            {"contactId": "wxid_mom", "contactName": "妈妈", "unread": 2, "lastMessage": "吃饭了吗", "lastAt": "2026-11-03T12:00:00+08:00"},
        ]
        self._inbox: dict[str, list[dict]] = {
            "wxid_mom": [
                {"senderName": "妈妈", "text": "这周末回来吗", "at": "2026-11-03T11:57:00+08:00", "kind": "text"},
            ],
        }
        self.sent: list[tuple[str, str]] = []

    def set_online(self, value: bool) -> None:
        self._online = value

    def online(self) -> bool:
        return self._online

    def account(self) -> str | None:
        return self._account if self._online else None

    def digest_groups(self) -> list[dict]:
        return list(self._groups)

    def recent_messages(self, contact_id: str, limit: int) -> list[dict]:
        return list(self._inbox.get(contact_id, []))[-limit:]

    def send(self, contact_id: str, text: str) -> None:
        self.sent.append((contact_id, text))
