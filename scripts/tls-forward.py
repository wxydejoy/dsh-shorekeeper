#!/usr/bin/env python3
"""TLS 前门：把 https://<lan>:3092 解密后转发到 dsh web (:3090)。
用途：局域网设备（k20/手机）开语音模式——getUserMedia 需要 secure context，
HTTP 不行，自签 HTTPS 可以（浏览器点一次「继续访问」）。
证书：~/.config/dsh-web-tls/{cert.pem,key.pem}（SAN 含 10.14.14.117/127.0.0.1/k20.lan）。
跑法：python3 scripts/tls-forward.py  （建议挂 launchd 常驻）
"""
import socket
import ssl
import threading
import os
import sys

LISTEN_PORT = 3092
UPSTREAM = ("10.14.14.117", 3090)
TLS_DIR = os.path.expanduser("~/.config/dsh-web-tls")
BUF = 65536


def pump(src, dst):
    try:
        while True:
            data = src.recv(BUF)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass
        try:
            dst.close()
        except OSError:
            pass
        try:
            src.close()
        except OSError:
            pass


def handle(tls_sock):
    try:
        upstream = socket.create_connection(UPSTREAM, timeout=5)
    except OSError as e:
        print(f"upstream connect failed: {e}", flush=True)
        try:
            tls_sock.close()
        except OSError:
            pass
        return
    t1 = threading.Thread(target=pump, args=(tls_sock, upstream), daemon=True)
    t2 = threading.Thread(target=pump, args=(upstream, tls_sock), daemon=True)
    t1.start()
    t2.start()
    t1.join()
    t2.join()


def main():
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(
        os.path.join(TLS_DIR, "cert.pem"), os.path.join(TLS_DIR, "key.pem")
    )
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("0.0.0.0", LISTEN_PORT))
    srv.listen(16)
    print(f"tls-forward listening on 0.0.0.0:{LISTEN_PORT} -> {UPSTREAM}", flush=True)
    while True:
        raw, addr = srv.accept()
        try:
            tls_sock = ctx.wrap_socket(raw, server_side=True)
        except ssl.SSLError as e:
            print(f"tls handshake failed from {addr}: {e}", flush=True)
            try:
                raw.close()
            except OSError:
                pass
            continue
        threading.Thread(target=handle, args=(tls_sock,), daemon=True).start()


if __name__ == "__main__":
    sys.exit(main())
