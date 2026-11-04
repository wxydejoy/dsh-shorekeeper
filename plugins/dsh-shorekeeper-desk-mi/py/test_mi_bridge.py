"""mi_bridge light_set 单测（stdlib unittest，不引 pytest）。

提速②的行为钉子：设备名解析/在线判定/属性挑选（includes 匹配+只挑可写）/亮度域校验。
mijiaDevice 用桩替换（不联网、不动真灯）。
"""

import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import mi_bridge  # noqa: E402


class Prop:
    def __init__(self, rw):
        self.rw = rw
        self.type = "bool"
        self.range = None
        self.value_list = []


def fake_device_props():
    return {
        "on-2": Prop("rnw"),
        "brightness": Prop("rnw"),
        "read-only-switch": Prop("r"),  # 不可写：挑选时必须跳过
    }


class FakeDevice:
    def __init__(self, props=None):
        self.prop_list = props if props is not None else fake_device_props()
        self.set_calls = []

    def set(self, prop, value):
        self.set_calls.append((prop, value))
        return None


class FakeApi:
    def __init__(self, devices, device):
        self._devices = devices
        self._device = device

    def get_devices_list(self):
        return self._devices


def run_light_set(api, argv):
    args = SimpleNamespace(name=argv["name"], action=argv["action"], brightness=argv.get("brightness"))
    with mock.patch.object(mi_bridge, "mijiaDevice", lambda api, did: api._device):
        buf = io.StringIO()
        with redirect_stdout(buf):
            mi_bridge.cmd_light_set(api, args)
        return json.loads(buf.getvalue())


class LightSetTest(unittest.TestCase):
    def setUp(self):
        self.devices = [{"did": "2052660114", "name": "台灯", "isOnline": True}]

    def test_on_挑可写开关属性并写入(self):
        device = FakeDevice()
        api = FakeApi(self.devices, device)
        out = run_light_set(api, {"name": "台灯", "action": "on"})
        self.assertTrue(out["ok"])
        self.assertEqual(out["prop"], "on-2")  # on 命中 on-2；read-only-switch 被跳过但优先级在后
        self.assertEqual(out["value"], True)
        self.assertEqual(device.set_calls, [("on-2", True)])

    def test_off写入False(self):
        device = FakeDevice()
        api = FakeApi(self.devices, device)
        out = run_light_set(api, {"name": "台灯", "action": "off"})
        self.assertEqual(out["value"], False)
        self.assertEqual(device.set_calls, [("on-2", False)])

    def test亮度写入int(self):
        device = FakeDevice({"brightness": Prop("rnw")})
        api = FakeApi(self.devices, device)
        out = run_light_set(api, {"name": "台灯", "action": "brightness", "brightness": 37.4})
        self.assertEqual(out["prop"], "brightness")
        self.assertEqual(out["value"], 37)
        self.assertEqual(device.set_calls, [("brightness", 37)])

    def test亮度越界拒绝(self):
        with self.assertRaises(SystemExit):
            run_light_set(FakeApi(self.devices, FakeDevice({"brightness": Prop("rnw")})),
                          {"name": "台灯", "action": "brightness", "brightness": 200})

    def test离线拒绝(self):
        api = FakeApi([{"did": "x", "name": "台灯", "isOnline": False}], FakeDevice())
        with self.assertRaises(SystemExit):
            run_light_set(api, {"name": "台灯", "action": "on"})

    def test设备不存在拒绝(self):
        api = FakeApi([], FakeDevice())
        with self.assertRaises(SystemExit):
            run_light_set(api, {"name": "不存在的灯", "action": "on"})

    def test只挑可写属性(self):
        # 只有只读 switch 时：'on' 命中也得挑不出不可写的 → 报「没找到开关属性」
        device = FakeDevice({"read-only-switch": Prop("r")})
        api = FakeApi(self.devices, device)
        with self.assertRaises(SystemExit):
            run_light_set(api, {"name": "台灯", "action": "on"})


if __name__ == "__main__":
    unittest.main()
