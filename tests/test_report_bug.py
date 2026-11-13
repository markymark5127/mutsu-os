"""Report a Bug, the power-state splash labels and the branded login screen."""

import importlib.machinery
import importlib.util
import tempfile
import unittest
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_reporter():
    path = ROOT / "packaging" / "mutsu-report-bug"
    loader = importlib.machinery.SourceFileLoader("mutsu_report_bug", str(path))
    spec = importlib.util.spec_from_loader("mutsu_report_bug", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.m = load_reporter()

    def test_report_has_the_sections_asked_for(self):
        title, body = self.m.build_report("Dock vanished", "Desktop, top bar or dock",
                                          "It went away", "1. Open Files", "Kernel: 7", "boom error")
        self.assertEqual(title, "Dock vanished")
        self.assertIn("### What happened\nIt went away", body)
        self.assertIn("### Steps to make it happen\n1. Open Files", body)
        self.assertIn("```\nKernel: 7\n```", body)
        self.assertIn("<details><summary>Recent error messages</summary>", body)

    def test_optional_parts_are_left_out(self):
        _, body = self.m.build_report("x", "Updates", "y", "  ")
        self.assertNotIn("Steps", body)
        self.assertNotIn("### System", body)
        self.assertNotIn("<details>", body)

    def test_private_names_are_hidden(self):
        text = "/var/home/kim/file kim@laptop-7 laptop-7 kimberly"
        out = self.m.redact(text, home="/var/home/kim", user="kim", host="laptop-7")
        self.assertEqual(out, "~/file <user>@<computer> <computer> kimberly")

    def test_short_report_link_is_not_trimmed(self):
        link, trimmed = self.m.issue_link("https://github.com/o/r/issues", "T", "body")
        self.assertFalse(trimmed)
        q = urllib.parse.parse_qs(urllib.parse.urlparse(link).query)
        self.assertEqual(q["title"], ["T"])
        self.assertEqual(q["body"], ["body"])
        self.assertEqual(q["labels"], ["bug"])
        self.assertTrue(link.startswith("https://github.com/o/r/issues/new?"))

    def test_long_report_is_trimmed_and_points_to_the_copy(self):
        errors = "\n".join(f"line {i} error something went wrong" for i in range(2000))
        _, body = self.m.build_report("T", "Updates", "what", "", "Kernel: 7", errors)
        link, trimmed = self.m.issue_link("https://github.com/o/r/issues", "T", body,
                                          Path("/x/mutsu-bug-1.md"))
        self.assertTrue(trimmed)
        self.assertLessEqual(len(link), self.m.MAX_URL)
        sent = urllib.parse.parse_qs(urllib.parse.urlparse(link).query)["body"][0]
        self.assertIn("mutsu-bug-1.md", sent)
        self.assertEqual(sent.count("```") % 2, 0, "code fences stay balanced")

    def test_copy_is_saved(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.m.save_copy("Title", "Body", tmp)
            self.assertEqual(path.read_text(), "# Title\n\nBody\n")

    def test_installed_and_reachable(self):
        container = (ROOT / "Containerfile").read_text()
        self.assertIn("COPY packaging/mutsu-report-bug /usr/bin/mutsu-report-bug", container)
        self.assertIn("/usr/share/applications/mutsu-report-bug.desktop", container)
        desktop = (ROOT / "packaging/mutsu-report-bug.desktop").read_text()
        self.assertIn("Exec=/usr/bin/mutsu-report-bug", desktop)
        ext = (ROOT / "extensions/mutsu-branding@mutsu-os/extension.js").read_text()
        self.assertIn("'/usr/bin/mutsu-report-bug'", ext)


class SplashAndLoginTests(unittest.TestCase):
    def test_splash_names_the_power_state(self):
        script = (ROOT / "branding/plymouth/mutsu.script").read_text()
        self.assertIn("Plymouth.GetMode()", script)
        for label in ("Starting Mutsu OS", "Shutting down", "Restarting", "Installing updates"):
            self.assertIn(label, script)
        self.assertNotIn('"Preparing Mutsu OS', script)
        self.assertIn("Plymouth.SetSystemUpdateFunction", script)

    def test_login_screen_is_the_japandi_dawn(self):
        css = (ROOT / "branding/shell/login.css").read_text()
        self.assertIn("#lockDialogGroup", css)
        self.assertIn("/tmp/mutsu-shell-css/login.css", (ROOT / "Containerfile").read_text())
        self.assertIn("/usr/share/backgrounds/mutsu/mutsu-login.png", css)
        self.assertTrue((ROOT / "branding/wallpapers/mutsu-login-2560.png").stat().st_size > 100_000)
        install = (ROOT / "packaging/install-branding.sh").read_text()
        self.assertIn("/usr/share/backgrounds/mutsu/mutsu-login.png", install)

    def test_menus_drop_gnomes_square_shadow(self):
        css = (ROOT / "branding/shell/japandi.css").read_text()
        block = css[css.index(".popup-menu-content {"):]
        block = block[:block.index("}")]
        self.assertIn("box-shadow: none", block)


if __name__ == "__main__":
    unittest.main()
