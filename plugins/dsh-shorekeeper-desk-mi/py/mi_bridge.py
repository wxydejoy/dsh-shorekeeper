#!/usr/bin/env python3
"""desk-mi 薄桥：dsh 工具层与米家云之间的唯一 Python 入口。

契约：stdout 永远只有一个 JSON 文档；诊断走 stderr + 退出码
（语义沿用 dsh-mijia-sidebar/lib/state.py，MIT）：3=无凭据 4=过期 5=缺依赖 1=错误。

命令：
  list                              全量设备（did/name/model/online）
  state  --did <did>                一台设备的全部可读属性
  set    --did <did> --prop <名> --value <JSON>   写一个属性（host 侧闸门之后的唯一写通道）
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

EXIT_BY_CODE = {"auth-missing": 3, "auth-expired": 4, "dependency-missing": 5, "error": 1}


def fail(code, message, **extra):
    payload = {"code": code, "message": message}
    payload.update(extra)
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr, flush=True)
    sys.exit(EXIT_BY_CODE.get(code, 1))


def default_auth_path():
    return Path.home() / ".config" / "mijia-api" / "auth.json"


def check_auth(auth_path):
    if not Path(auth_path).exists():
        fail("auth-missing", "还没有米家登录凭证，请先运行：%s -m mijiaAPI login 扫码" % sys.executable, auth_path=str(auth_path))


AUTH_HINTS = ("401", "unauthorized", "access_token", "invalid token", "登录", "not logged in")


def is_auth_expired(error):
    status = getattr(error, "status_code", None) or getattr(error, "code", None)
    text = str(error).lower()
    return status == 401 or any(hint in text for hint in AUTH_HINTS)


try:
    from mijiaAPI import mijiaAPI, mijiaDevice
except ImportError:
    fail("dependency-missing", "当前 Python 缺少 mijiaAPI，请运行：%s -m pip install --user mijiaAPI" % sys.executable)


def canonical_props(device):
    """mijiaDevice 的 prop_list：名字 → DevProp（rw / method）。"""
    return getattr(device, "prop_list", {}) or {}


def cmd_list(api):
    devices = []
    for d in api.get_devices_list():
        devices.append({
            "did": str(d.get("did")),
            "name": d.get("name"),
            "model": d.get("model"),
            "online": bool(d.get("isOnline")),
        })
    json.dump({"devices": devices}, sys.stdout, ensure_ascii=False)


def cmd_state(api, did):
    device = mijiaDevice(api, did=did)
    states = {}
    props = canonical_props(device)
    for name, prop in props.items():
        if "r" not in prop.rw:
            continue
        if "-" in name and name.replace("-", "_") in props:
            continue  # 蛇形别名与连字符重复时只报连字符那份
        try:
            states[name] = device.get(name)
        except Exception as error:
            states[name] = None
            print(f"prop {name}: {error}", file=sys.stderr)
    json.dump({"did": did, "states": states}, sys.stdout, ensure_ascii=False)


def cmd_set(api, did, prop, value):
    device = mijiaDevice(api, did=did)
    props = canonical_props(device)
    target = None
    for name, definition in props.items():
        if name == prop or name.lower() == prop.lower():
            if "w" not in definition.rw:
                fail("error", f"属性 {prop} 不可写（rw={definition.rw}）")
            target = name
            break
    if target is None:
        known = ", ".join(sorted(props))
        fail("error", f"没找到属性 {prop}；这台设备有：{known}")
    device.set(target, value)
    json.dump({"did": did, "prop": target, "value": value, "ok": True}, sys.stdout, ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--auth_path", default=str(default_auth_path()))
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    p_state = sub.add_parser("state")
    p_state.add_argument("--did", required=True)
    p_set = sub.add_parser("set")
    p_set.add_argument("--did", required=True)
    p_set.add_argument("--prop", required=True)
    p_set.add_argument("--value", required=True)
    args = parser.parse_args()

    check_auth(args.auth_path)
    try:
        api = mijiaAPI(args.auth_path)
        if args.cmd == "list":
            cmd_list(api)
        elif args.cmd == "state":
            cmd_state(api, args.did)
        else:
            try:
                value = json.loads(args.value)
            except json.JSONDecodeError:
                fail("error", f"--value 不是合法 JSON：{args.value!r}")
            cmd_set(api, args.did, args.prop, value)
    except SystemExit:
        raise
    except Exception as error:
        if is_auth_expired(error):
            fail("auth-expired", "米家登录已过期，请重新：%s -m mijiaAPI login 扫码" % sys.executable)
        fail("error", "米家操作失败：%s" % error)


if __name__ == "__main__":
    main()
