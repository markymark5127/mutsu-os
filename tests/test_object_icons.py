"""Japandi app and folder icons: flat objects, no tile, no icons."""

import configparser
import importlib.util
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "branding/icons/objects/draw-icons.py"


def load():
    spec = importlib.util.spec_from_file_location("icons", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ObjectIconTests(unittest.TestCase):
    def test_every_drawing_has_full_and_small_versions(self):
        icons = load()
        for app in icons.NAMES:
            full, small = icons.drawing(app), icons.drawing(app, small=True)
            self.assertIn("<svg", full)
            for svg in (full, small):
                # flat: no glass, gloss or blur
                for glassy in ("Gradient", "feGaussianBlur", "filter="):
                    self.assertNotIn(glassy, svg, app)
            self.assertNotIn("<rect x=\"16\" y=\"16\" width=\"224\"", full, "no tile")
            self.assertIn("translate(0 7)", full, app)   # one small flat shadow
            self.assertNotIn("translate(0 7)", small, app)

    def test_names_cover_mutsu_apps_folders_and_bazzite_variants(self):
        icons = load()
        names = {n for _, ns in icons.NAMES.values() for n in ns}
        for name in ("org.gnome.Nautilus", "org.gnome.Ptyxis", "io.github.kolunmi.Bazaar",
                     "mutsu-ai", "mutsu-updater", "folder", "folder-download", "user-home",
                     "user-desktop", "user-trash", "folder-pictures"):
            self.assertIn(name, names)
        # Mechanic is a screwdriver, not a lens
        self.assertIn("screwdriver", icons.mechanic.__doc__)

    def test_theme_lists_every_rendered_size(self):
        icons = load()
        theme = configparser.ConfigParser(interpolation=None)
        theme.read(ROOT / "branding/icon-theme/MutsuJapandi/index.theme")
        dirs = theme["Icon Theme"]["Directories"].split(",")
        for size in icons.SIZES:
            for context in ("apps", "places"):
                d = f"{size}x{size}/{context}"
                self.assertIn(d, dirs)
                self.assertEqual(theme[d]["Type"], "Fixed")
                self.assertEqual(int(theme[d]["Size"]), size)
        # fixed sizes come first, so they win over any scalable copy
        self.assertLess(dirs.index("512x512/places"), dirs.index("scalable/apps"))

    def test_installed_at_build_before_the_icon_cache(self):
        script = (ROOT / "packaging/install-branding.sh").read_text()
        render = script.index("draw-icons.py\" --render /usr/share/icons/MutsuJapandi")
        self.assertLess(render, script.index("gtk-update-icon-cache -f /usr/share/icons/MutsuJapandi"))

    @unittest.skipUnless(shutil.which("rsvg-convert"), "needs rsvg-convert")
    def test_render_replaces_the_flat_drawings(self):
        with tempfile.TemporaryDirectory() as tmp:
            theme = Path(tmp)
            old = theme / "scalable/apps/org.gnome.Nautilus.svg"
            old.parent.mkdir(parents=True)
            old.write_text("<svg/>")
            subprocess.run([sys.executable, str(SCRIPT), "--render", str(theme)], check=True, capture_output=True)
            self.assertFalse(old.exists())
            for size in (16, 48, 512):
                png = theme / f"{size}x{size}/apps/org.gnome.Nautilus.png"
                self.assertEqual(png.read_bytes()[:4], b"\x89PNG")
            self.assertTrue((theme / "48x48/places/user-home.png").is_symlink())


if __name__ == "__main__":
    unittest.main()
