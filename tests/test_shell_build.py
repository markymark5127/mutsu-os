"""Mutsu's GNOME Shell: login waits for extensions; the look is built in."""

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHELL = ROOT / "packaging" / "shell"

LAYOUT = """import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from './main.js';
export class LayoutManager {
    async _prepareStartupAnimation() {
        await this._updateBackgrounds();

        // Hack: Work around grab issue when testing greeter UI in nested
        this.emit('startup-prepared');
    }
}
"""
EXTENSIONS = """export class ExtensionManager {
    init() {
        this._sessionUpdated().then(() => {
            ExtensionDownloader.checkForUpdates();
        }).catch(logError);
    }
}
"""


class ShellPatchTests(unittest.TestCase):
    def tree(self, tmp):
        ui = Path(tmp, "js/ui")
        ui.mkdir(parents=True)
        (ui / "layout.js").write_text(LAYOUT)
        (ui / "extensionSystem.js").write_text(EXTENSIONS)
        return ui

    def patch(self, tmp):
        return subprocess.run([sys.executable, str(SHELL / "apply-mutsu-shell.py"), tmp],
                              capture_output=True, text=True)

    def test_login_waits_for_extensions(self):
        with tempfile.TemporaryDirectory() as tmp:
            ui = self.tree(tmp)
            self.assertEqual(self.patch(tmp).returncode, 0)
            layout = (ui / "layout.js").read_text()
            self.assertIn("async _mutsuWaitForExtensions(limitMs)", layout)
            wait = layout.index("await this._mutsuWaitForExtensions(3000)")
            self.assertLess(wait, layout.index("this.emit('startup-prepared')"))
            self.assertIn("!Main.sessionMode.isGreeter", layout)
            # GNOME 51 has no Meta.is_restart(): calling it blacked out login.
            self.assertNotIn("is_restart", layout)
            self.assertIn("logError(e, 'Mutsu OS: waiting for extensions')", layout)
            ext = (ui / "extensionSystem.js").read_text()
            self.assertIn("this.startupComplete = this._sessionUpdated();", ext)
            # Twice is the same as once.
            self.patch(tmp)
            self.assertEqual((ui / "layout.js").read_text(), layout)
            if shutil.which("node"):
                for name in ("layout.js", "extensionSystem.js"):
                    mjs = Path(tmp, name.replace(".js", ".mjs"))
                    mjs.write_text((ui / name).read_text())
                    subprocess.run(["node", "--check", str(mjs)], check=True)

    def test_moved_code_stops_the_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            ui = self.tree(tmp)
            (ui / "layout.js").write_text("export class LayoutManager {}\n")
            result = self.patch(tmp)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("can't find", result.stderr)


@unittest.skipUnless(shutil.which("glib-compile-resources") and shutil.which("gresource"),
                     "needs glib-compile-resources and gresource")
class ThemeBakeTests(unittest.TestCase):
    def test_look_goes_into_light_and_dark_but_not_high_contrast(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp, "src")
            (src / "icons").mkdir(parents=True)
            for name in ("gnome-shell-light.css", "gnome-shell-dark.css", "gnome-shell-high-contrast.css"):
                (src / name).write_text(f"/* {name} */\n")
            (src / "icons" / "a.svg").write_text("<svg/>")
            xml = Path(tmp, "t.xml")
            xml.write_text('<gresources><gresource prefix="/org/gnome/shell/theme">'
                           "<file>gnome-shell-light.css</file><file>gnome-shell-dark.css</file>"
                           "<file>gnome-shell-high-contrast.css</file><file>icons/a.svg</file>"
                           "</gresource></gresources>")
            stock, out = Path(tmp, "in.gresource"), Path(tmp, "out.gresource")
            subprocess.run(["glib-compile-resources", f"--sourcedir={src}", f"--target={stock}", str(xml)], check=True)
            sage = str(ROOT / "extensions/mutsu-adaptive@mutsu-os/stylesheet.css") + "::/* ---- Mutsu sage accent"
            subprocess.run([sys.executable, str(SHELL / "bake-shell-theme.py"), str(stock), str(out),
                            str(ROOT / "branding/shell/japandi.css"), sage], check=True, capture_output=True)

            def css(name):
                return subprocess.run(["gresource", "extract", str(out), f"/org/gnome/shell/theme/{name}"],
                                      check=True, capture_output=True, text=True).stdout
            for name in ("gnome-shell-light.css", "gnome-shell-dark.css"):
                text = css(name)
                self.assertIn("Mutsu OS (built in)", text)
                self.assertIn("#FFFCF6", text, "Japandi")
                self.assertIn(".toggle-switch:checked { background: #7F9A82", text, "sage")
                self.assertNotIn(".mutsu-gamepad", text, "only the sage block of the tablet stylesheet")
            self.assertNotIn("Mutsu", css("gnome-shell-high-contrast.css"))


class ImageTests(unittest.TestCase):
    def test_shell_reads_the_overlay(self):
        conf = (SHELL / "mutsu-shell-overlay.conf").read_text()
        self.assertIn("Environment=G_RESOURCE_OVERLAYS=/org/gnome/shell/ui=/usr/share/mutsu-os/shell-overlay/ui", conf)
        script = (SHELL / "make-shell-overlay.sh").read_text()
        for name in ("layout.js", "extensionSystem.js"):
            self.assertIn(name, script)


    def test_image_installs_the_shell_and_theme(self):
        text = (ROOT / "Containerfile").read_text()
        for needle in ("AS shell", "make-shell-overlay.sh /out/overlay",
                       "bake-shell-theme.py", "COPY --from=shell /out/",
                       "org.gnome.Shell@.service.d/mutsu-shell-overlay.conf",
                       "/usr/share/mutsu-os/shell-theme-built-in"):
            self.assertIn(needle, text)
        branding = (ROOT / "extensions/mutsu-branding@mutsu-os/extension.js").read_text()
        self.assertIn("/usr/share/mutsu-os/shell-theme-built-in", branding)

    def test_cyberpunk_covers_everything_japandi_styles(self):
        """Japandi is built in, so another look must restyle all of it."""
        import re

        def selectors(name):
            text = (ROOT / "branding/shell" / name).read_text()
            text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
            found = set()
            for head in re.findall(r"([^{}]+)\{", text):
                found |= {s.strip() for s in head.split(",") if s.strip()}
            return found
        self.assertEqual(selectors("japandi.css") - selectors("cyberpunk.css"), set())


if __name__ == "__main__":
    unittest.main()
