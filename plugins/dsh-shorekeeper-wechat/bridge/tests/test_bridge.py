"""微信桥 HTTP 面单测（FakeWcf 适配器，零外部依赖）。"""

from __future__ import annotations

import json
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fake_wcf import FakeWcfAdapter  # noqa: E402
from wechat_bridge import SendLimiter, build_adapter, clamp_limit, make_handler  # noqa: E402

TOKEN = "bridge-token-1"


def request(port: int, method: str, path: str, body: dict | None = None, token: str | None = TOKEN):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"}
        | ({"Authorization": f"Bearer {token}"} if token else {}),
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read().decode("utf-8"))


class BridgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.adapter = FakeWcfAdapter()
        handler = make_handler(cls.adapter, TOKEN, frozenset({"wxid_mom"}), SendLimiter(0.0))
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_health_open_and_reports_online(self):
        status, body = request(self.port, "GET", "/api/health", token=None)
        self.assertEqual(status, 200)
        self.assertEqual(body["service"], "shorekeeper-wechat-bridge")
        self.assertTrue(body["wechatOnline"])

    def test_digest_requires_token(self):
        status, body = request(self.port, "GET", "/api/digest", token=None)
        self.assertEqual(status, 401)
        self.assertEqual(body["error"]["code"], "unauthorized")

    def test_digest_groups_and_truncation(self):
        status, body = request(self.port, "GET", "/api/digest")
        self.assertEqual(status, 200)
        self.assertEqual(body["groups"][0]["contactId"], "wxid_mom")

    def test_read_limit_clamped(self):
        self.assertEqual(clamp_limit(0), 1)
        self.assertEqual(clamp_limit(999), 50)
        self.assertEqual(clamp_limit("abc"), 10)

    def test_read_returns_messages(self):
        status, body = request(self.port, "POST", "/api/read", {"contactId": "wxid_mom", "limit": 5})
        self.assertEqual(status, 200)
        self.assertEqual(body["messages"][0]["text"], "这周末回来吗")

    def test_read_unknown_contact_empty(self):
        status, body = request(self.port, "POST", "/api/read", {"contactId": "wxid_nobody"})
        self.assertEqual(status, 200)
        self.assertEqual(body["messages"], [])

    def test_offline_maps_to_409(self):
        self.adapter.set_online(False)
        try:
            status, body = request(self.port, "GET", "/api/digest")
            self.assertEqual(status, 409)
            self.assertEqual(body["error"]["code"], "wechat_offline")
        finally:
            self.adapter.set_online(True)

    def test_send_within_whitelist(self):
        status, body = request(self.port, "POST", "/api/send", {"contactId": "wxid_mom", "text": "晚饭回家吃"})
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(self.adapter.sent, [("wxid_mom", "晚饭回家吃")])

    def test_send_outside_whitelist_hard_denied(self):
        before = len(self.adapter.sent)
        status, body = request(self.port, "POST", "/api/send", {"contactId": "wxid_stranger", "text": "hi"})
        self.assertEqual(status, 403)
        self.assertEqual(body["error"]["code"], "not_allowed")
        self.assertEqual(len(self.adapter.sent), before)  # 白名单外不发

    def test_send_validates_body(self):
        status, _ = request(self.port, "POST", "/api/send", {"contactId": "wxid_mom", "text": "  "})
        self.assertEqual(status, 400)

    def test_send_limiter_enforces_interval(self):
        limiter = SendLimiter(0.2)
        started = time.monotonic()
        limiter.wait_turn()
        limiter.wait_turn()
        self.assertGreaterEqual(time.monotonic() - started, 0.19)

    def test_build_adapter_rejects_unknown(self):
        with self.assertRaises(SystemExit):
            build_adapter("nope")


if __name__ == "__main__":
    unittest.main()
