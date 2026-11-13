#!/usr/bin/env python3
"""把 Windows 探针打到 :17890/v1/telemetry 的样本转到 dsh 的 k20 网关。

探针默认上报 http://mini.lan:17890/v1/telemetry，身体是 {pc, running, idle_sec}。
旧 hub 停了之后这个口没人接，手机上的 CPU / 内存 / GPU 就空了。
这里只转发这一条 POST，其余路径 404。不把 hub 进程叫回来。
"""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

UPSTREAM = sys.argv[1] if len(sys.argv) > 1 else "http://10.14.14.117:3090"
LISTEN = ("0.0.0.0", 17890)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path == "/health":
            self._json(200, {"ok": True, "service": "telemetry-forward"})
            return
        self._json(404, {"error": {"code": "not_found", "message": "只转发 /v1/telemetry"}})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        length = int(self.headers.get("Content-Length") or "0")
        body = self.rfile.read(length) if length else b""
        if path != "/v1/telemetry":
            self._json(404, {"error": {"code": "not_found", "message": "只转发 /v1/telemetry"}})
            return
        headers = {"Content-Type": self.headers.get("Content-Type") or "application/json", "Accept": "application/json"}
        auth = self.headers.get("Authorization")
        if auth:
            headers["Authorization"] = auth
        req = Request(UPSTREAM.rstrip("/") + "/v1/telemetry", data=body, method="POST", headers=headers)
        try:
            with urlopen(req, timeout=3) as resp:
                payload = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("Content-Type") or "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except HTTPError as exc:
            payload = exc.read()
            self.send_response(exc.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except URLError as exc:
            self._json(502, {"error": {"code": "upstream", "message": str(exc.reason)}})

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def _json(self, status: int, payload: dict[str, object]) -> None:
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def main() -> None:
    server = ThreadingHTTPServer(LISTEN, Handler)
    print(f"telemetry-forward {LISTEN[0]}:{LISTEN[1]} -> {UPSTREAM}/v1/telemetry", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
