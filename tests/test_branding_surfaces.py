import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "branding"
SCRIPT = (ROOT / "packaging/install-branding.sh").read_text(encoding="utf-8")


class BrandingSurfacesTest(unittest.TestCase):
    def test_brand_svgs_are_valid(self):
        svgs = [*BRAND.glob("icons/apps/*/*.svg"), *BRAND.glob("avatars/*.svg"),
                *BRAND.glob("cursors/*/*.svg"), *BRAND.glob("grub/*.svg")]
        self.assertGreaterEqual(len(svgs), 15)
        for svg in svgs:
            ET.parse(svg)  # raises on malformed artwork

    def test_icon_cache_is_built_after_every_icon_install(self):
        # OSTree flattens file times, so a cache built before later icon
        # copies is never seen as stale and GTK misses the new icons.
        cache = SCRIPT.index("gtk-update-icon-cache -f /usr/share/icons/MutsuJapandi")
        for marker in ("$brand/icons/apps/$theme", "build-xcursor.py",
                       "user-desktop.svg", "folder-desktop-cyberpunk.svg"):
            self.assertLess(SCRIPT.index(marker), cache, marker)
        self.assertEqual(SCRIPT.count("gtk-update-icon-cache -f /usr/share/icons/MutsuJapandi"), 1)

    def test_terminal_icon_covers_ptyxis(self):
        self.assertIn("org.gnome.Ptyxis.svg", SCRIPT)
        self.assertIn("io.github.kolunmi.Bazaar.svg", SCRIPT)

    def test_interface_font_only_set_when_installed(self):
        self.assertIn("fc-list : family", SCRIPT)
        self.assertIn("font-name='%s 11'", SCRIPT)
        self.assertIn("'Inter Variable'", SCRIPT)
        self.assertIn("rsms-inter-fonts", (ROOT / "Containerfile").read_text(encoding="utf-8"))

    def test_version_is_visible(self):
        self.assertIn('"PRETTY_NAME": \'"Mutsu OS 1.0 (Shibui)"\'', SCRIPT)

    def test_fallback_hostname_is_mutsu(self):
        # Without /etc/hostname (live USB, fresh install) systemd uses
        # DEFAULT_HOSTNAME: the terminal prompt and KDE Connect show it.
        self.assertIn('"DEFAULT_HOSTNAME": \'"mutsu"\'', SCRIPT)

    @unittest.skipUnless(shutil.which("rsvg-convert"), "needs rsvg-convert")
    def test_cursor_builds_as_xcursor(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "left_ptr"
            subprocess.run([sys.executable, str(BRAND / "cursors/build-xcursor.py"),
                            str(BRAND / "cursors/japandi/left_ptr.svg"), str(out), "4", "2"],
                           check=True)
            data = out.read_bytes()
            magic, _header, _version, count = struct.unpack("<4sIII", data[:16])
            self.assertEqual(magic, b"Xcur")
            self.assertEqual(count, 5)
            _type, size, offset = struct.unpack("<III", data[28:40])
            image = struct.unpack("<IIIIIIIII", data[offset:offset + 36])
            self.assertEqual((size, image[4], image[5], image[6], image[7]), (32, 32, 32, 4, 2))


if __name__ == "__main__":
    unittest.main()
