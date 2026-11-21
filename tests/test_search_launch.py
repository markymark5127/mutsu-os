"""Super+Space reaches a running Mutsu Search over D-Bus, not a new Python.

Measured in a headless GNOME session: showing Search again took ~600 ms
(after clicking away) to 1.6 s and more (after Escape, which quit it); kept
running and reached with gapplication it takes ~30 ms and ~150 ms.
"""
from __future__ import annotations

import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = "io.github.markymark5127.AIDesktop"


class SearchLaunchTests(unittest.TestCase):
    def run_wrapper(self, *args, gapplication_exit=0):
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp, "gapplication")
            log = Path(tmp, "calls")
            fake.write_text(f'#!/bin/sh\necho "$@" >> {log}\nexit {gapplication_exit}\n')
            fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
            env = {**os.environ, "PATH": f"{tmp}:{os.environ['PATH']}"}
            result = subprocess.run(["bash", str(ROOT / "packaging/mutsu-search"), *args],
                                    env=env, capture_output=True, text=True, timeout=30)
            calls = log.read_text().splitlines() if log.exists() else []
        return result, calls

    def test_super_space_asks_the_running_search_over_dbus(self):
        result, calls = self.run_wrapper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, [f"launch {APP}"])

    def test_wrapper_keeps_the_python_entrypoint_for_everything_else(self):
        text = (ROOT / "packaging/mutsu-search").read_text()
        # Arguments (--setup, --query, --background...) and any gapplication
        # failure fall through to Python, as before.
        self.assertIn('if [[ $# -eq 0 ]] && command -v gapplication >/dev/null &&', text)
        self.assertIn('exec /usr/bin/python3 -m aidesktop "$@"', text)
        self.assertLess(text.index("gapplication launch"), text.index("exec /usr/bin/python3"))

    def test_search_is_dbus_activatable(self):
        desktop = (ROOT / f"packaging/{APP}.desktop").read_text()
        self.assertIn("DBusActivatable=true", desktop)
        service = (ROOT / f"packaging/{APP}.service").read_text()
        self.assertIn(f"Name={APP}", service)
        self.assertIn("Exec=/usr/bin/mutsu-search --gapplication-service", service)

    def test_search_is_ready_after_login(self):
        unit = (ROOT / "packaging/mutsu-search.service").read_text()
        self.assertIn("ExecStart=/usr/bin/mutsu-search --background", unit)
        self.assertIn("PartOf=graphical-session.target", unit)
        self.assertIn("ExecStartPre=/usr/bin/sleep", unit)  # after the desktop settles
        self.assertIn("RestartPreventExitStatus=2", unit)

    def test_image_installs_the_launch_pieces(self):
        image = (ROOT / "Containerfile").read_text()
        self.assertIn(f"/usr/share/dbus-1/services/{APP}.service", image)
        self.assertIn("COPY packaging/mutsu-search.service /usr/lib/systemd/user/mutsu-search.service", image)
        self.assertIn("graphical-session.target.wants/mutsu-search.service", image)
        # The keyboard shortcut still runs the wrapper, so accounts with their
        # own saved copy of the shortcut get the fast path too.
        shortcut = (ROOT / "packaging/20-mutsu-shortcut.dconf").read_text()
        self.assertIn("command='/usr/bin/mutsu-search'", shortcut)


if __name__ == "__main__":
    unittest.main()
