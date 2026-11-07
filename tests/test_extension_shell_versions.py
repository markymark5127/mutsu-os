import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXTENSIONS = ROOT / "extensions"


class ExtensionShellVersionTest(unittest.TestCase):
    def test_mutsu_extensions_support_newest_bundled_gnome(self):
        # GNOME refuses to load an extension whose shell-version list lacks the
        # running Shell ("OUT OF DATE"). Bazzite moved to GNOME 51 while the
        # Mutsu extensions still stopped at 50, so tablet mode and branding
        # silently never ran. Bundled third-party extensions track the base
        # image, so the newest version any of them declares is the floor.
        versions = {}
        for metadata in EXTENSIONS.glob("*/metadata.json"):
            versions[metadata.parent.name] = json.loads(metadata.read_text())["shell-version"]
        newest = max(int(v) for name, vs in versions.items()
                     if not name.endswith("@mutsu-os") for v in vs)
        for name in ("mutsu-adaptive@mutsu-os", "mutsu-branding@mutsu-os"):
            self.assertIn(str(newest), versions[name], f"{name} must list GNOME {newest}")

    def test_no_removed_clutter_backend_call(self):
        # GNOME 51 removed Clutter.get_default_backend(); an unguarded call
        # crashes the extension on enable (Touchshell did).
        for script in EXTENSIONS.rglob("*.js"):
            for line in script.read_text(encoding="utf-8", errors="replace").splitlines():
                if "Clutter.get_default_backend()" in line and "get_context" not in line \
                        and not line.strip().startswith("//"):
                    self.fail(f"{script.relative_to(ROOT)}: {line.strip()}")

    def test_no_options_gnome_51_rejects(self):
        # GNOME 51 throws on St.BoxLayout's removed `vertical` property and on
        # addChrome's removed `affectsInputRegion` option. Either one stops the
        # part of the extension that uses it from starting.
        for script in EXTENSIONS.rglob("*.js"):
            if "prefs" in script.parts or script.name == "prefs.js":
                continue
            for line in script.read_text(encoding="utf-8", errors="replace").splitlines():
                code = line.split("//")[0]
                if re.search(r"\bvertical:\s*(true|false)", code) or "affectsInputRegion" in code:
                    self.fail(f"{script.relative_to(ROOT)}: {line.strip()}")


if __name__ == "__main__":
    unittest.main()
