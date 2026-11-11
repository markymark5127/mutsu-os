"""Software Updates: the root backend and the GNOME Settings patch."""

import importlib.machinery
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent


def load_backend():
    path = ROOT / "packaging" / "mutsu-update-backend"
    loader = importlib.machinery.SourceFileLoader("mutsu_update_backend", str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


BOOTC_STATUS = {
    "spec": {"image": {"image": "ghcr.io/markymark5127/mutsu-os:stable"}},
    "status": {
        "booted": {"image": {"image": {"image": "ghcr.io/markymark5127/mutsu-os:stable"},
                             "version": "45.20261109", "timestamp": "2026-11-09T05:09:00Z",
                             "imageDigest": "sha256:aaa"}},
        "staged": None,
        "rollback": {"image": {"image": {"image": "ghcr.io/markymark5127/mutsu-os:stable"},
                               "version": "45.20261102", "imageDigest": "sha256:old"}},
    },
}


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.b = load_backend()
        self.tmp = tempfile.TemporaryDirectory()
        self.b.STATE_DIR = self.tmp.name
        self.b.STATE = os.path.join(self.tmp.name, "state.json")
        self.b.AUTO_OFF = os.path.join(self.tmp.name, "var", "auto-install-off")
        self.calls = []
        self.replies = {}
        self.b.run = self.fake_run

    def tearDown(self):
        self.tmp.cleanup()

    def fake_run(self, argv, **kw):
        self.calls.append(argv)
        key = " ".join(argv[:3])
        code, out, err = self.replies.get(key, (1, "", "unexpected"))
        return SimpleNamespace(returncode=code, stdout=out, stderr=err)

    def state(self):
        with open(self.b.STATE) as f:
            return json.load(f)

    def test_progress_lines(self):
        p = self.b.parse_progress
        self.assertEqual(p('{"bytes": 50, "bytesTotal": 200}'), 0.25)
        self.assertEqual(p('{"steps": 3, "stepsTotal": 3}'), 1.0)
        self.assertIsNone(p('{"bytes": 5, "bytesTotal": 0}'))
        self.assertIsNone(p("not json"))

    def test_check_output(self):
        says = self.b.check_output_says
        self.assertTrue(says("Update available for: docker://ghcr.io/x:stable\n  Version: 45.1"))
        self.assertFalse(says("No changes in: docker://ghcr.io/x:stable"))
        self.assertIsNone(says("error: something else"))

    def test_check_reports_update_and_versions(self):
        self.replies["bootc status --format=json"] = (0, json.dumps(BOOTC_STATUS), "")
        self.replies["bootc upgrade --check"] = (0, "Update available for: docker://ghcr.io/x:stable", "")
        self.assertEqual(self.b.cmd_check(), 0)
        s = self.state()
        self.assertTrue(s["available"])
        self.assertEqual(s["phase"], "idle")
        self.assertEqual(s["booted"]["version"], "45.20261109")
        self.assertEqual(s["rollback"]["digest"], "sha256:old")
        self.assertTrue(s["auto"])

    def test_check_up_to_date(self):
        self.replies["bootc status --format=json"] = (0, json.dumps(BOOTC_STATUS), "")
        self.replies["bootc upgrade --check"] = (0, "No changes in: docker://ghcr.io/x:stable", "")
        self.b.cmd_check()
        self.assertFalse(self.state()["available"])
        self.assertIn("up to date", self.state()["message"])

    def test_check_falls_back_to_the_registry_digest(self):
        self.replies["bootc status --format=json"] = (0, json.dumps(BOOTC_STATUS), "")
        self.replies["bootc upgrade --check"] = (2, "", "unknown flag")
        self.replies["skopeo inspect --format"] = (0, "sha256:aaa\n", "")
        self.b.cmd_check()
        self.assertFalse(self.state()["available"])
        self.replies["skopeo inspect --format"] = (0, "sha256:new\n", "")
        self.b.cmd_check()
        self.assertTrue(self.state()["available"])

    def test_offline_is_an_error_not_up_to_date(self):
        self.replies["bootc status --format=json"] = (0, json.dumps(BOOTC_STATUS), "")
        self.replies["bootc upgrade --check"] = (1, "", "network unreachable")
        self.replies["skopeo inspect --format"] = (1, "sha256:junk", "network unreachable")
        self.assertEqual(self.b.cmd_check(), 1)
        s = self.state()
        self.assertIsNone(s["available"])
        self.assertEqual(s["phase"], "error")

    def test_automatic_installs_switch(self):
        self.assertTrue(self.b.auto_enabled())
        self.b.cmd_auto(False)
        self.assertFalse(self.b.auto_enabled())
        self.assertFalse(self.state()["auto"])
        self.b.cmd_auto(True)
        self.assertTrue(self.b.auto_enabled())

    def test_timer_installs_only_when_automatic(self):
        applied = []
        self.b.cmd_apply = lambda: applied.append(1) or 0
        self.replies["bootc status --format=json"] = (0, json.dumps(BOOTC_STATUS), "")
        self.replies["bootc upgrade --check"] = (0, "Update available for: x", "")
        self.b.cmd_auto(False)
        self.b.cmd_timer()
        self.assertEqual(applied, [])
        self.b.cmd_auto(True)
        self.b.cmd_timer()
        self.assertEqual(applied, [1])

    def test_rollback(self):
        self.replies["bootc rollback"] = (0, "", "")
        self.replies["bootc status --format=json"] = (0, json.dumps(BOOTC_STATUS), "")
        self.assertEqual(self.b.cmd_rollback(), 0)
        self.assertEqual(self.state()["phase"], "rollback-staged")


class SettingsPatchTests(unittest.TestCase):
    """apply-mutsu-panels.py against the anchors of gnome-control-center 51."""

    def make_tree(self, root: Path):
        (root / "panels").mkdir(parents=True)
        (root / "shell").mkdir()
        (root / "panels" / "meson.build").write_text(
            "subdir('common')\n\npanels = [\n  'applications',\n  'background',\n]\n\n"
            "dependent_panels = [\n  'network',\n]\n")
        (root / "shell" / "cc-panel-loader.c").write_text(
            "extern GType cc_applications_panel_get_type (void);\n"
            "extern GType cc_background_panel_get_type (void);\n\n"
            "static CcPanelLoaderVtable default_panels[] =\n{\n"
            '    PANEL_TYPE ("applications", cc_applications_panel_get_type, NULL),\n'
            '    PANEL_TYPE ("background", cc_background_panel_get_type, NULL),\n};\n')
        (root / "shell" / "cc-panel-list.c").write_text(
            'static const gchar * const panel_order[] = {\n    "notifications",\n    "search",\n'
            '    "privacy",\n    "system",\n'
            '    "reset-settings",\n};\n')

    def test_adds_the_updates_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.make_tree(root)
            script = ROOT / "packaging" / "settings" / "apply-mutsu-panels.py"
            subprocess.run([sys.executable, str(script), tmp], check=True, capture_output=True)
            meson = (root / "panels" / "meson.build").read_text()
            self.assertIn("  'mutsu-updates',\n  'applications'", meson)
            self.assertNotIn("'mutsu-updates'", meson.split("dependent_panels")[1])
            loader = (root / "shell" / "cc-panel-loader.c").read_text()
            self.assertIn("extern GType cc_mutsu_updates_panel_get_type (void);", loader)
            self.assertIn('PANEL_TYPE ("mutsu-updates", cc_mutsu_updates_panel_get_type, NULL),', loader)
            order = (root / "shell" / "cc-panel-list.c").read_text()
            self.assertIn('"privacy",\n    "mutsu-updates",\n    "system",', order)
            self.assertTrue((root / "panels" / "mutsu-updates" / "cc-mutsu-updates-panel.c").is_file())
            # Mutsu Search sits just above GNOME's Search.
            self.assertIn("'mutsu-search',", meson)
            self.assertIn('PANEL_TYPE ("mutsu-search", cc_mutsu_search_panel_get_type, NULL),', loader)
            self.assertIn('"notifications",\n    "mutsu-search",\n    "search",', order)
            self.assertTrue((root / "panels" / "mutsu-search" / "cc-mutsu-search-panel.c").is_file())
            # Running it twice changes nothing more.
            subprocess.run([sys.executable, str(script), tmp], check=True, capture_output=True)
            self.assertEqual((root / "shell" / "cc-panel-list.c").read_text().count("mutsu-updates"), 1)

    def test_fails_loudly_when_an_anchor_moves(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.make_tree(root)
            (root / "shell" / "cc-panel-list.c").write_text("static const gchar *order[] = {};\n")
            script = ROOT / "packaging" / "settings" / "apply-mutsu-panels.py"
            result = subprocess.run([sys.executable, str(script), tmp], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("sidebar order", result.stderr)


class ImageWiringTests(unittest.TestCase):
    def test_containerfile_installs_the_update_system(self):
        text = (ROOT / "Containerfile").read_text()
        for needle in ("AS settings", "build-gnome-settings.sh /out", "COPY --from=settings /out/",
                       "mutsu-update-backend", "systemctl enable mutsu-update-timer.timer",
                       "systemctl --global enable mutsu-update-notify.path", "uupd.timer"):
            self.assertIn(needle, text)

    def test_polkit_rule_covers_every_unit_the_page_starts(self):
        rule = (ROOT / "packaging" / "updates" / "50-mutsu-updates.rules").read_text()
        panel = (ROOT / "packaging" / "settings" / "mutsu-updates" / "cc-mutsu-updates-panel.c").read_text()
        import re
        for unit in set(re.findall(r'"(mutsu-update-[a-z-]+\.service)"', panel)):
            self.assertIn(unit, rule)

    def test_search_settings_page_is_installed(self):
        text = (ROOT / "Containerfile").read_text()
        self.assertIn("mutsu-search-settings", text)
        self.assertIn("gnome-mutsu-search-panel.desktop", text)
        helper = (ROOT / "packaging" / "mutsu-search-settings").read_text()
        self.assertIn("aidesktop.search_settings", helper)
        panel = (ROOT / "packaging" / "settings" / "mutsu-search" / "cc-mutsu-search-panel.c").read_text()
        self.assertIn('"/usr/libexec/mutsu-os/mutsu-search-settings"', panel)

    def test_pages_are_top_level_in_the_sidebar(self):
        """X-GNOME-SystemSettings marks a sub-page of System: Settings then
        shows the System page instead (and the OS Updater lands there too)."""
        for panel in ("mutsu-updates", "mutsu-search"):
            desktop = (ROOT / "packaging" / "settings" / panel / f"gnome-{panel}-panel.desktop.in").read_text()
            categories = next(l for l in desktop.splitlines() if l.startswith("Categories="))
            self.assertNotIn("X-GNOME-SystemSettings", categories, panel)
            self.assertNotIn("X-GNOME-PrivacySettings", categories, panel)

    def test_sidebar_icons_are_symbolic(self):
        """Only -symbolic icons are tinted like the rest of the sidebar, and
        only if the theme has them: ship Mutsu's own for Software Updates."""
        desktop = (ROOT / "packaging/settings/mutsu-updates/gnome-mutsu-updates-panel.desktop.in").read_text()
        self.assertIn("Icon=mutsu-software-update-symbolic", desktop)
        svg = ROOT / "packaging/settings/mutsu-updates/mutsu-software-update-symbolic.svg"
        self.assertTrue(svg.is_file())
        self.assertIn("hicolor/scalable/apps/mutsu-software-update-symbolic.svg",
                      (ROOT / "Containerfile").read_text())

    def test_updater_opens_settings(self):
        text = (ROOT / "packaging" / "mutsu-updater").read_text()
        self.assertIn("gnome-control-center mutsu-updates", text)


if __name__ == "__main__":
    unittest.main()
