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


def pick_writable_prop(props, *keys):
    """TS pickKey 的 python 镜像：键名归一化后 includes 匹配，只挑可写属性。"""
    for key in keys:
        for prop_name, definition in props.items():
            norm = prop_name.lower().replace("-", "_")
            if key.lower() in norm and "w" in getattr(definition, "rw", ""):
                return prop_name
    return None


def cmd_light_set(api, args):
    """单进程控灯：设备解析 + 属性挑选 + 写入一次完成（提速②：省 2 次云设备列表 + 1 次云读 + 2 次解释器启动）。"""
    name = args.name
    devices = api.get_devices_list()
    matches = [d for d in devices if str(d.get("name")) == name]
    if not matches:
        fail("error", "米家里没有叫「%s」的设备" % name)
    entry = matches[0]
    if entry.get("isOnline") is not True:
        fail("error", "%s 离线，动不了。" % name)
    device = mijiaDevice(api, did=str(entry["did"]))
    props = canonical_props(device)
    if args.action == "brightness":
        target = pick_writable_prop(props, "brightness", "亮度")
        if target is None:
            fail("error", "%s 不支持调亮度" % name)
        if args.brightness is None or args.brightness < 1 or args.brightness > 100:
            fail("error", "brightness 需要 1-100")
        value = int(round(args.brightness))
    else:
        target = pick_writable_prop(props, "switch", "on", "开关")
        if target is None:
            fail("error", "%s 上没找到开关属性" % name)
        value = args.action == "on"
    device.set(target, value)
    json.dump({"did": str(entry["did"]), "name": name, "prop": target, "value": value, "ok": True}, sys.stdout, ensure_ascii=False)


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
    p_light = sub.add_parser("light_set", help="单进程控灯：解析设备+挑属性+写入")
    p_light.add_argument("--name", required=True)
    p_light.add_argument("--action", required=True, choices=["on", "off", "brightness"])
    p_light.add_argument("--brightness", type=float, default=None)
    args = parser.parse_args()

    check_auth(args.auth_path)
    try:
        api = mijiaAPI(args.auth_path)
        if args.cmd == "list":
            cmd_list(api)
        elif args.cmd == "state":
            cmd_state(api, args.did)
        elif args.cmd == "light_set":
            cmd_light_set(api, args)
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
