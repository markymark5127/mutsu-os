"""Validate native GNOME image gates without booting a VM.

An actual GNOME 50 graphical session remains a separate release requirement.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest import mock
import subprocess

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "verify_native_desktop", ROOT / "packaging/verify-native-desktop.py")
checker = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(checker)


class NativeDesktopVerificationTests(unittest.TestCase):
    def build_fixture(self, root: Path):
        dbdir = root / "etc/dconf/db"
        (dbdir / "mutsu.d").mkdir(parents=True)
        (root / "etc/dconf/profile").mkdir(parents=True)
        (root / "etc/dconf/profile/user").write_text(
            "user-db:user\nsystem-db:mutsu\nsystem-db:local\n")
        (dbdir / "mutsu").write_bytes(b"compiled dconf database")
        names = list(checker.REQUIRED_EXTENSIONS)
        (dbdir / "mutsu.d/10-mutsu-shell").write_text(
            "[org/gnome/shell]\nenabled-extensions=" + repr(names) + "\n")
        wallpaper = root / checker.REQUIRED_WALLPAPER.removeprefix("file:///")
        wallpaper.parent.mkdir(parents=True)
        wallpaper.write_bytes(b"dummy wallpaper")
        for uuid in checker.REQUIRED_EXTENSIONS:
            ext = root / "usr/share/gnome-shell/extensions" / uuid
            ext.mkdir(parents=True)
            (ext / "metadata.json").write_text(json.dumps({
                "uuid": uuid, "shell-version": ["49", "50"],
            }))
        return dbdir

    def test_native_image_passes_with_active_mutsu_profile(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            self.build_fixture(root)
            self.assertEqual(checker.verify_source_layout(root), [])
            self.assertTrue(checker.native_profile_ok([
                "user-db:user", "system-db:mutsu", "system-db:local",
            ]))

    def test_old_bazzite_first_profile_is_rejected(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            self.build_fixture(root)
            (root / "etc/dconf/profile/user").write_text(
                "user-db:user\nsystem-db:local\nsystem-db:mutsu\n")
            self.assertTrue(any("first system dconf database" in error
                                for error in checker.verify_source_layout(root)))

    def test_missing_native_extension_and_login_script_fail(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            self.build_fixture(root)
            (root / "usr/share/gnome-shell/extensions" /
             checker.REQUIRED_EXTENSIONS[0] / "metadata.json").unlink()
            autostart = root / "etc/xdg/autostart/mutsu-first-boot.desktop"
            autostart.parent.mkdir(parents=True)
            autostart.write_text("legacy")
            errors = checker.verify_source_layout(root)
            self.assertTrue(any("not installed" in s for s in errors))
            self.assertTrue(any("per-login appearance" in s for s in errors))

    def test_effective_gsettings_must_resolve_to_mutsu(self):
        expected = repr(list(checker.REQUIRED_EXTENSIONS))
        def fake_run(cmd, **kwargs):
            schema, key = cmd[-2:]
            responses = {
                ("org.gnome.shell", "enabled-extensions"): expected,
                ("org.gnome.desktop.background", "picture-uri"):
                    repr(checker.REQUIRED_WALLPAPER),
                ("org.gnome.desktop.interface", "color-scheme"): "'prefer-light'",
            }
            return subprocess.CompletedProcess(cmd, 0, responses[(schema, key)], "")
        with mock.patch.object(checker.subprocess, "run", side_effect=fake_run):
            self.assertEqual(checker.verify_fresh_user_effective_defaults(), [])

        def stock_response(cmd, **kwargs):
            schema, key = cmd[-2:]
            val = {
                ("org.gnome.shell", "enabled-extensions"): "['logomenu@aryan_k']",
                ("org.gnome.desktop.background", "picture-uri"):
                    "'file:///usr/share/backgrounds/bazzite/default.jpg'",
                ("org.gnome.desktop.interface", "color-scheme"): "'prefer-dark'",
            }[(schema, key)]
            return subprocess.CompletedProcess(cmd, 0, val, "")
        with mock.patch.object(checker.subprocess, "run", side_effect=stock_response):
            errors = checker.verify_fresh_user_effective_defaults()
        self.assertTrue(any("Mutsu Japandi" in s for s in errors))
        self.assertTrue(any("Bazzite Logo" in s for s in errors))

    def test_image_runs_native_check_before_bootc_lint(self):
        image = (ROOT / "Containerfile").read_text()
        self.assertIn("COPY packaging/verify-native-desktop.py", image)
        self.assertLess(
            image.index("python3 /tmp/mutsu-configure-native-desktop.py"),
            image.index("python3 /tmp/mutsu-verify-native-desktop.py"),
        )
        self.assertLess(
            image.index("python3 /tmp/mutsu-verify-native-desktop.py"),
            image.index("bootc container lint"),
        )
        self.assertNotIn("COPY packaging/mutsu-first-boot ", image)
        self.assertNotIn("COPY packaging/mutsu-first-boot.desktop", image)


if __name__ == "__main__":
    unittest.main()
