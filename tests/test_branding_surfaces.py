import json
import re
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
        for marker in ("$brand/icons/apps/$theme", "build-cursor-theme.py",
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

    def test_scalable_cursors_for_gnome_51(self):
        # GNOME Shell 51 draws the pointer from cursors_scalable SVGs; with
        # only Xcursor files it used GNOME's own arrow (login screen and
        # Shell) and logged "Could not load cursor 'default'".
        self.assertIn("build-scalable-cursors.py", SCRIPT)
        self.assertIn("cursors_scalable/default/metadata.json", SCRIPT)
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run([sys.executable, str(BRAND / "cursors/build-scalable-cursors.py"), tmp,
                            str(BRAND / "cursors/japandi/left_ptr.svg"), "3", "5", "32"], check=True)
            folder = Path(tmp) / "cursors_scalable/default"
            meta = json.loads((folder / "metadata.json").read_text())
            self.assertEqual(meta, [{"filename": "default.svg", "hotspot_x": 3, "hotspot_y": 5,
                                     "nominal_size": 32}])
            self.assertEqual((folder / "default.svg").read_bytes(),
                             (BRAND / "cursors/japandi/left_ptr.svg").read_bytes())

    @unittest.skipUnless(shutil.which("rsvg-convert"), "needs rsvg-convert")
    def test_no_command_glued_to_its_quote(self):
        # `sed's/a/b/'` runs a command literally named "seds/a/b/" and only
        # fails inside the image build; bash -n can't catch it.
        for line_no, line in enumerate(SCRIPT.splitlines(), 1):
            self.assertNotRegex(line, r"(^|[\s;&|(])(sed|grep|awk|printf|echo|tr|cut)['\"]",
                                f"install-branding.sh:{line_no}: {line.strip()}")

    def test_whole_cursor_set_is_drawn_in_one_style(self):
        # The arrow alone was Mutsu's; hand, text, resize and busy cursors were
        # Adwaita's and looked out of place. Every common shape is now drawn.
        self.assertLess(SCRIPT.index("build-cursor-theme.py"), SCRIPT.index("build-scalable-cursors.py"))
        with tempfile.TemporaryDirectory() as tmp:
            theme = Path(tmp) / "MJ"
            subprocess.run([sys.executable, str(BRAND / "cursors/build-cursor-theme.py"),
                            str(BRAND / "cursors/japandi"), str(theme)], check=True, capture_output=True)
            for name in ("default", "pointer", "hand2", "text", "xterm", "grab", "grabbing", "move",
                         "ew-resize", "col-resize", "ns-resize", "nwse-resize", "nesw-resize",
                         "crosshair", "not-allowed", "help", "copy", "alias", "wait", "watch", "progress"):
                self.assertTrue((theme / "cursors" / name).exists(), name)
                self.assertTrue((theme / "cursors_scalable" / name / "metadata.json").exists(), name)
            wait = json.loads((theme / "cursors_scalable/wait/metadata.json").read_text())
            self.assertGreater(len(wait), 1, "wait spins")
            self.assertTrue(all(frame["delay"] > 0 for frame in wait))
            data = (theme / "cursors/wait").read_bytes()
            self.assertEqual(data[:4], b"Xcur")
            # drawing the set again must not touch the drawn pointer
            subprocess.run([sys.executable, str(BRAND / "cursors/build-scalable-cursors.py"), str(theme),
                            str(BRAND / "cursors/japandi/left_ptr.svg"), "3", "5", "32"],
                           check=True, capture_output=True)
            self.assertEqual(json.loads((theme / "cursors_scalable/pointer/metadata.json").read_text())[0]
                             ["filename"], "pointer.svg")

    def test_rice_paper_glass(self):
        css = (BRAND / "shell/japandi.css").read_text()
        self.assertIn("background-gradient-start: rgba(255, 253, 248", css)  # shoji sheen
        self.assertIn("border: 1px solid rgba(255, 255, 255, 0.80)", css)    # bright rim
        # St draws one box-shadow per element: never a layered list
        for decl in re.findall(r"box-shadow:([^;]*);", css):
            self.assertNotRegex(decl, r",(?![^()]*\))", decl)
        self.assertIn("background-gradient-end: rgba(246, 238, 222, 0.20)", css)  # top bar: thin washi veil
        self.assertIn("#panel.mutsu-glass-dark", css)          # cream ink over dark wallpapers
        slim = (ROOT / "extensions/mutsu-adaptive@mutsu-os/stylesheet.css").read_text()
        slim = slim[slim.index(".mutsu-status-slim {"):]
        self.assertNotIn("background", slim[:slim.index("}")])  # tablet bar keeps the glass
        self.assertNotIn("background-color: #FFFCF6;\n  border: 1px solid #D6DCCF", css)
        ext = ROOT / "extensions/mutsu-branding@mutsu-os"
        glass = (ext / "glass.js").read_text()
        self.assertIn("Shell.BlurMode.BACKGROUND", glass)
        self.assertIn("high-contrast", glass)
        self.assertIn("'mutsu-glass-dark'", glass)                # adaptive ink class
        self.assertIn("new_from_stream_at_scale_async", glass)   # sampled small, off the main thread
        self.assertIn("remove_style_class_name(DARK_CLASS)", glass[glass.index("    destroy() {"):])


    def test_shoji_glass_dock(self):
        """Dock is the hero: the focused app gets a liquid capsule in its icon's colour."""
        ext = ROOT / "extensions/mutsu-branding@mutsu-os"
        liquid = (ext / "dockLiquid.js").read_text()
        self.assertIn("'dashtodockContainer'", liquid)
        self.assertIn("set_style(null)", liquid[liquid.index("    destroy() {"):])  # capsule removed
        self.assertIn("high-contrast", liquid)
        main = (ext / "extension.js").read_text()
        self.assertIn("new DockLiquid()", main)
        self.assertIn("this._dockLiquid?.destroy()", main[main.index("    disable() {"):])
        # Kiwi's dock styling strips every highlight behind dock icons.
        self.assertIn("dock-styling=false", (ROOT / "packaging/60-mutsu-kiwi.dconf").read_text())
        accent = (ROOT / "extensions/mutsu-adaptive@mutsu-os/stylesheet.css").read_text()
        self.assertIn("background-gradient-end: #4F6B57", accent)  # liquid sage "on" moments
        for blue in ("#3D8C99", "#7466C2", "#5879AD"):
            self.assertNotIn(blue, accent, "the accent stays Japandi")
        # Liquid glass as an effect: a shader on menus, banners and the dock,
        # plus the dock's reflection; switchable, Japandi only, off in high contrast.
        glassfx = (ext / "liquidGlass.js").read_text()
        self.assertIn("extends Clutter.OffscreenEffect", glassfx)
        self.assertIn("Cogl.SnippetHook.FRAGMENT", glassfx)
        self.assertIn("PopupMenu.PopupMenu.prototype", glassfx)
        self.assertIn("_bannerBin", glassfx)
        self.assertIn("scale_y = -1", glassfx)               # mirrored icons
        self.assertIn("PopupMenu.PopupMenu.prototype.open = this._origOpen", glassfx)  # unpatched
        self.assertIn("new LiquidGlass()", main)
        self.assertIn("'liquid-glass'", main)
        self.assertIn("high-contrast", main[main.index("    _syncLiquidGlass() {"):])
        self.assertIn("this._liquidGlass?.destroy()", main[main.index("    disable() {"):])
        schema = (ext / "schemas/org.gnome.shell.extensions.mutsu-branding.gschema.xml").read_text()
        self.assertIn('<key name="liquid-glass" type="b">', schema)
        css = (ROOT / "branding/shell/japandi.css").read_text()
        floor = re.search(r"#dashtodockContainer.bottom #dashtodockBox \{\s*padding-bottom: (\d+)px", css)
        self.assertEqual(int(floor.group(1)), int(re.search(r"REFLECTION_DEPTH = (\d+)", glassfx).group(1)))
        # Running dots adapt: ink picked for contrast against the dock glass
        # over the wallpaper (glass.js), with an opposite-tone halo.
        riceglass = (ext / "glass.js").read_text()
        self.assertIn("export function dockReadsDark", riceglass)
        self.assertIn("this._clearDock()", riceglass[riceglass.index("    destroy() {"):])
        for cls in (".mutsu-dock-light .app-grid-running-dot", ".mutsu-dock-dark .app-grid-running-dot"):
            self.assertIn(cls, css)
        self.assertNotIn("#7F9A82", css[css.index("Running dots"):css.index("The dock floats")])
        # Show Apps: nine round dots, no tile
        show = (ROOT / "branding/icons/mutsu-show-apps-symbolic.svg").read_text()
        self.assertEqual(show.count("<circle"), 9)
        self.assertNotIn("<rect", show)
        main = (ext / "extension.js").read_text()
        self.assertIn("new RiceGlass()", main)
        self.assertIn("this._glass?.destroy()", main[main.index("    disable() {"):])

    def test_login_screen_uses_mutsu_look(self):
        # The greeter is the gdm account with its own settings.
        gdm = SCRIPT[SCRIPT.index("cat > /etc/dconf/db/gdm.d/90-mutsu-logo"):]
        gdm = gdm[:gdm.index("DCONF\n  dconf update")]
        for key in ("cursor-theme='MutsuJapandi'", "icon-theme='MutsuJapandi'", "clock-format='12h'",
                    "theme-name='MutsuJapandi'"):
            self.assertIn(key, gdm)
        self.assertIn("/etc/dconf/db/gdm.d/41-mutsu-fonts", SCRIPT)


if __name__ == "__main__":
    unittest.main()
