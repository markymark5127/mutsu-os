import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SageAccentTests(unittest.TestCase):
    def run_script(self, home):
        subprocess.run(["bash", str(ROOT / "packaging" / "mutsu-accent.sh")],
                       env={**os.environ, "HOME": str(home)}, check=True)

    def test_block_is_added_once_after_imports_and_keeps_user_css(self):
        with tempfile.TemporaryDirectory() as home:
            css = Path(home, ".config/gtk-4.0/gtk.css")
            css.parent.mkdir(parents=True)
            css.write_text('@import url("kiwi/css/x.css");\nwindow { color: red; }\n')
            self.run_script(home)
            self.run_script(home)
            text = css.read_text()
            self.assertEqual(text.count("mutsu-accent:start"), 1, "idempotent")
            self.assertTrue(text.startswith('@import'), "imports stay first")
            self.assertIn("window { color: red; }", text)
            self.assertIn("--accent-bg-color: #7F9A82", text)
            self.assertIn("@define-color accent_bg_color #7F9A82",
                          Path(home, ".config/gtk-3.0/gtk.css").read_text())

    def test_unchanged_file_is_not_rewritten(self):
        """A rewrite makes every open GTK app restyle at login."""
        with tempfile.TemporaryDirectory() as home:
            self.run_script(home)
            css = Path(home, ".config/gtk-4.0/gtk.css")
            os.utime(css, (1_000_000, 1_000_000))
            self.run_script(home)
            self.assertEqual(css.stat().st_mtime, 1_000_000)

    def test_new_accounts_start_themed(self):
        text = (ROOT / "Containerfile").read_text()
        self.assertIn("HOME=/etc/skel bash /usr/libexec/mutsu-os/mutsu-accent.sh", text)

    def test_opt_out(self):
        with tempfile.TemporaryDirectory() as home:
            Path(home, ".config/mutsu").mkdir(parents=True)
            Path(home, ".config/mutsu/no-sage-accent").touch()
            self.run_script(home)
            self.assertFalse(Path(home, ".config/gtk-4.0/gtk.css").exists())

    def test_pointer_is_warm_charcoal_and_shell_uses_sage(self):
        cursor = (ROOT / "branding/cursors/japandi/left_ptr.svg").read_text()
        self.assertIn('fill="#3B3632"', cursor)
        self.assertNotIn("#384B3C", cursor)
        css = (ROOT / "extensions/mutsu-adaptive@mutsu-os/stylesheet.css").read_text()
        for selector in (".quick-toggle:checked", ".toggle-switch:checked", ".check-box:checked StIcon", ".slider"):
            self.assertIn(selector, css)
        containerfile = (ROOT / "Containerfile").read_text()
        self.assertIn("mutsu-accent.service /etc/systemd/user/graphical-session.target.wants/", containerfile)


if __name__ == "__main__":
    unittest.main()
