"""Japandi liquid-glass app and folder icons."""

import configparser
import importlib.util
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "branding/icons/glass/draw-glass-icons.py"


def load():
    spec = importlib.util.spec_from_file_location("glass", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GlassIconTests(unittest.TestCase):
    def test_every_drawing_has_full_and_small_versions(self):
        glass = load()
        for app in glass.NAMES:
            full, small = glass.drawing(app), glass.drawing(app, small=True)
            self.assertIn("<svg", full)
            self.assertIn("feGaussianBlur", full, app)   # real glass: soft shadow, edge
            self.assertNotIn("filter=", small, app)      # nothing blurred at 16-32 px
            self.assertNotIn("<rect x=\"16\" y=\"16\" width=\"224\"", full, "no tile")

    def test_names_cover_mutsu_apps_folders_and_bazzite_variants(self):
        glass = load()
        names = {n for _, ns in glass.NAMES.values() for n in ns}
        for name in ("org.gnome.Nautilus", "org.gnome.Ptyxis", "io.github.kolunmi.Bazaar",
                     "mutsu-ai", "mutsu-updater", "folder", "folder-download", "user-home",
                     "user-desktop", "user-trash", "folder-pictures"):
            self.assertIn(name, names)
        # Mechanic is a screwdriver, not a lens
        self.assertIn("screwdriver", glass.mechanic.__doc__)

    def test_theme_lists_every_rendered_size(self):
        glass = load()
        theme = configparser.ConfigParser(interpolation=None)
        theme.read(ROOT / "branding/icon-theme/MutsuJapandi/index.theme")
        dirs = theme["Icon Theme"]["Directories"].split(",")
        for size in glass.SIZES:
            for context in ("apps", "places"):
                d = f"{size}x{size}/{context}"
                self.assertIn(d, dirs)
                self.assertEqual(theme[d]["Type"], "Fixed")
                self.assertEqual(int(theme[d]["Size"]), size)
        # fixed sizes come first, so they win over any scalable copy
        self.assertLess(dirs.index("512x512/places"), dirs.index("scalable/apps"))

    def test_installed_at_build_before_the_icon_cache(self):
        script = (ROOT / "packaging/install-branding.sh").read_text()
        render = script.index("draw-glass-icons.py\" --render /usr/share/icons/MutsuJapandi")
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
