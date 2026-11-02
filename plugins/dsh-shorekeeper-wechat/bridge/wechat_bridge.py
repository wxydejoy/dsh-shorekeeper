#!/usr/bin/env python3
"""守岸人微信桥 · Windows 挂机侧独立小服务（T6）。

契约：plugins/dsh-shorekeeper-wechat/docs/bridge-contract.md
路线：wechatferry（决策记录 docs/decisions-wechat-route.md，接真账号前须漂泊者签字）
隐私红线：全文即取即用不留存；桥内存里最多缓存最近一次 read 响应。

适配器分层：本文件只做 HTTP 面与业务规则（分组/截断/限速/白名单二次校验），
微信交互全部走 WcfAdapter 接口——wcferry_adapter.WcferryAdapter 是真身（Windows + 微信
3.9.11.25 + wcferry 包），fake_wcf.FakeWcfAdapter 供测试与无微信环境联调。

用法：
  python3 wechat_bridge.py --token <≥8字符> [--port 17901] [--host 0.0.0.0]
                           [--whitelist "wxid_a,wxid_b"] [--adapter fake|wcferry]
                           [--send-interval 3]
监听非回环地址必须带 --token（或环境变量 BRIDGE_TOKEN，避免 ps 里泄露口令）。
"""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

SERVICE = "shorekeeper-wechat-bridge"
BRIDGE_VERSION = 1
MAX_DIGEST_GROUPS = 20
MAX_LAST_MESSAGE_CHARS = 120
MAX_READ_LIMIT = 50
MAX_TEXT_CHARS = 2000


class BridgeError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def clamp_limit(raw: Any) -> int:
    try:
        value = int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 10
    return max(1, min(MAX_READ_LIMIT, value))


class SendLimiter:
    """发送节流：两次发送之间至少隔 interval 秒（桥侧排队，任务书风险对策）。"""

    def __init__(self, interval: float) -> None:
        self.interval = max(0.0, interval)
        self._lock = threading.Lock()
        self._last = 0.0

    def wait_turn(self) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                remain = self._last + self.interval - now
                if remain <= 0:
                    self._last = now
                    return
            time.sleep(min(remain, 0.5))


def make_handler(adapter: Any, token: str, whitelist: frozenset[str], limiter: SendLimiter) -> type:
    secret = (token or "").strip()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args: object) -> None:
            print(f"bridge {self.address_string()} {fmt % args}", flush=True)

        def _authorized(self) -> bool:
            if not secret:
                return True
            header = self.headers.get("Authorization") or ""
            value = header.strip()
            if not value.lower().startswith("bearer "):
                return False
            got = value[7:].strip()
            try:
                import hmac

                return bool(got) and hmac.compare_digest(got.encode(), secret.encode())
            except (UnicodeError, TypeError):
                return False

        def _json(self, status: int, payload: dict) -> None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _deny(self) -> None:
            self._json(401, {"error": {"code": "unauthorized", "message": "口令不对"}})

        def _require_online(self) -> None:
            if not adapter.online():
                raise BridgeError(409, "wechat_offline", "微信已掉线：挂机侧需要重新登录")

        def _read_json(self) -> dict:
            try:
                length = int(self.headers.get("Content-Length", "0") or 0)
            except ValueError as exc:
                raise BridgeError(400, "bad_request", "Content-Length 无效") from exc
            if length < 0 or length > 64_000:
                raise BridgeError(400, "bad_request", "请求体过大")
            raw = self.rfile.read(length) if length else b"{}"
            try:
                data = json.loads(raw.decode("utf-8")) if raw else {}
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise BridgeError(400, "bad_request", "JSON 无效") from exc
            if not isinstance(data, dict):
                raise BridgeError(400, "bad_request", "JSON 必须是对象")
            return data

        def do_GET(self) -> None:  # noqa: N802
            path = urlparse(self.path).path.rstrip("/") or "/"
            try:
                if path == "/api/health":
                    self._json(200, {
                        "ok": True,
                        "service": SERVICE,
                        "version": BRIDGE_VERSION,
                        "wechatOnline": adapter.online(),
                        "account": adapter.account(),
                    })
                    return
                if not self._authorized():
                    self._deny()
                    return
                if path == "/api/digest":
                    self._require_online()
                    groups = adapter.digest_groups()[:MAX_DIGEST_GROUPS]
                    trimmed = [
                        {**group, "lastMessage": str(group.get("lastMessage", ""))[:MAX_LAST_MESSAGE_CHARS]}
                        for group in groups
                    ]
                    self._json(200, {"groups": trimmed})
                    return
                self._json(404, {"error": {"code": "not_found", "message": "没有这个地址"}})
            except BridgeError as exc:
                self._json(exc.status, {"error": {"code": exc.code, "message": exc.message}})
            except Exception as exc:  # noqa: BLE001
                self._json(500, {"error": {"code": "internal", "message": f"桥内部错误：{exc}"}})

        def do_POST(self) -> None:  # noqa: N802
            path = urlparse(self.path).path.rstrip("/") or "/"
            try:
                if not self._authorized():
                    self._deny()
                    return
                body = self._read_json()
                if path == "/api/read":
                    self._require_online()
                    contact_id = str(body.get("contactId") or "").strip()
                    if not contact_id:
                        raise BridgeError(400, "bad_request", "contactId 必填")
                    messages = adapter.recent_messages(contact_id, clamp_limit(body.get("limit", 10)))
                    self._json(200, {"messages": messages})
                    return
                if path == "/api/send":
                    self._require_online()
                    contact_id = str(body.get("contactId") or "").strip()
                    text = str(body.get("text") or "").strip()
                    if not contact_id or not text:
                        raise BridgeError(400, "bad_request", "contactId 与 text 必填")
                    if len(text) > MAX_TEXT_CHARS:
                        raise BridgeError(400, "bad_request", f"正文超长（>{MAX_TEXT_CHARS}）")
                    if whitelist and contact_id not in whitelist:
                        raise BridgeError(403, "not_allowed", "联系人不在桥侧白名单（纵深防御）")
                    limiter.wait_turn()
                    adapter.send(contact_id, text)
                    self._json(200, {"ok": True, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
                    return
                self._json(404, {"error": {"code": "not_found", "message": "没有这个地址"}})
            except BridgeError as exc:
                self._json(exc.status, {"error": {"code": exc.code, "message": exc.message}})
            except Exception as exc:  # noqa: BLE001
                self._json(500, {"error": {"code": "internal", "message": f"桥内部错误：{exc}"}})

    return Handler


def build_adapter(name: str):
    if name == "fake":
        from fake_wcf import FakeWcfAdapter

        return FakeWcfAdapter()
    if name == "wcferry":
        from wcferry_adapter import WcferryAdapter

        return WcferryAdapter()
    raise SystemExit(f"未知 adapter：{name}（可选 fake / wcferry）")


def main() -> None:
    parser = argparse.ArgumentParser(description="守岸人微信桥")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=17901)
    parser.add_argument(
        "--token",
        default=os.environ.get("BRIDGE_TOKEN", ""),
        help="Bearer 口令；监听非回环必须设置（可用环境变量 BRIDGE_TOKEN）",
    )
    parser.add_argument("--whitelist", default="", help="桥侧白名单（逗号分隔 contactId；空=不在此层校验）")
    parser.add_argument("--adapter", default="fake", choices=["fake", "wcferry"])
    parser.add_argument("--send-interval", type=float, default=3.0, help="两次发送最小间隔秒")
    args = parser.parse_args()

    token = args.token.strip()
    if not loopback(args.host) and not token:
        raise SystemExit(f"拒绝在 {args.host} 上无口令监听：局域网内任何人都能读微信、冒名发消息。")

    adapter = build_adapter(args.adapter)
    whitelist = frozenset(item.strip() for item in args.whitelist.split(",") if item.strip())
    limiter = SendLimiter(args.send_interval)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(adapter, token, whitelist, limiter))
    auth = "Bearer" if token else "本机免口令"
    print(f"微信桥听 {args.host}:{args.port}  adapter={args.adapter}  {auth}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("停止微信桥", flush=True)
        server.shutdown()


def loopback(host: str) -> bool:
    return (host or "").strip().lower() in {"127.0.0.1", "::1", "localhost"}


if __name__ == "__main__":
    main()
