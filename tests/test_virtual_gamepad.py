import importlib.machinery
import importlib.util
import struct
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load():
    path = ROOT / "packaging" / "mutsu-virtual-gamepad"
    loader = importlib.machinery.SourceFileLoader("mutsu_virtual_gamepad", str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class VirtualGamepadTests(unittest.TestCase):
    def setUp(self):
        self.g = load()

    def test_kernel_struct_sizes_match_the_ioctl_numbers(self):
        # The size is encoded in the ioctl number: 0x5c for uinput_setup,
        # 0x1c for uinput_abs_setup.
        self.assertEqual(len(self.g.setup_struct()), (self.g.UI_DEV_SETUP >> 16) & 0x3FFF)
        self.assertEqual(len(self.g.abs_setup_struct(0, self.g.STICK)), (self.g.UI_ABS_SETUP >> 16) & 0x3FFF)
        self.assertEqual(self.g.EVENT.size, 24)

    def test_parse_buttons_axes_hat(self):
        g = self.g
        events = g.parse("k a 1;a lx -40000;h 1 -1;a zr 255")
        self.assertEqual(events, [
            (g.EV_KEY, 0x130, 1),
            (g.EV_ABS, 0x00, -32768),  # clamped
            (g.EV_ABS, 0x10, 1), (g.EV_ABS, 0x11, -1),
            (g.EV_ABS, 0x05, 255),
        ])

    def test_bad_input_is_ignored(self):
        self.assertEqual(self.g.parse("k nope 1;a lx abc;zz;;"), [])

    def test_device_setup_and_events(self):
        g = self.g
        calls, writes = [], []
        dev = g.Device(opener=lambda path, flags: 7,
                       ioctl=lambda fd, req, arg=None: calls.append((req, arg)),
                       write=lambda fd, data: writes.append(data))
        reqs = [c[0] for c in calls]
        self.assertEqual(reqs[-1], g.UI_DEV_CREATE)
        self.assertIn((g.UI_SET_KEYBIT, 0x130), calls)
        self.assertEqual(sum(1 for r in reqs if r == g.UI_ABS_SETUP), len(g.AXES))
        name = [a for r, a in calls if r == g.UI_DEV_SETUP][0]
        self.assertEqual(struct.unpack("HHHH", name[:8])[1:3], (0x045E, 0x028E))
        dev.emit(g.parse("k b 1"))
        data = writes[-1]
        self.assertEqual(len(data), 48)  # the key event + SYN_REPORT
        self.assertEqual(g.EVENT.unpack(data[24:])[2:], (g.EV_SYN, g.SYN_REPORT, 0))

    def test_close_releases_everything(self):
        g = self.g
        writes, calls = [], []
        import os
        r, w = os.pipe()
        os.close(r)
        dev = g.Device(opener=lambda p, f: w, ioctl=lambda fd, req, arg=None: calls.append(req),
                       write=lambda fd, data: writes.append(data))
        dev.close()
        released = [g.EVENT.unpack(writes[-1][i:i + 24]) for i in range(0, len(writes[-1]), 24)]
        self.assertTrue(all(e[4] == 0 for e in released))
        self.assertEqual(calls[-1], g.UI_DEV_DESTROY)


if __name__ == "__main__":
    unittest.main()
