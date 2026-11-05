#!/usr/bin/env python3
"""本地 TCP 转发：127.0.0.1:3091 -> 10.14.14.117:3090。

用途：dsh web 只允许绑定单一具体地址（拒 0.0.0.0），而浏览器端
getUserMedia 只在 secure context（https 或 loopback）可用。这个转发器
让浏览器以 http://127.0.0.1:3091 访问 :3090，拿 secure context；
服务端侧 socket 源是本机 LAN 地址，由 voice-mode allowLan=true 放行。
"""
import asyncio
import sys

LISTEN = ('127.0.0.1', 3091)
TARGET = ('10.14.14.117', 3090)


async def pipe(r: asyncio.StreamReader, w: asyncio.StreamWriter) -> None:
    try:
        while True:
            chunk = await r.read(65536)
            if not chunk:
                break
            w.write(chunk)
            await w.drain()
    except (ConnectionResetError, BrokenPipeError, OSError):
        pass
    finally:
        try:
            w.close()
        except Exception:
            pass


async def handle(cr: asyncio.StreamReader, cw: asyncio.StreamWriter) -> None:
    try:
        ur, uw = await asyncio.open_connection(*TARGET)
    except OSError:
        cw.close()
        return
    await asyncio.gather(pipe(cr, uw), pipe(ur, cw))


async def main() -> None:
    server = await asyncio.start_server(handle, *LISTEN)
    print(f'forwarding {LISTEN} -> {TARGET}', flush=True)
    async with server:
        await server.serve_forever()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
