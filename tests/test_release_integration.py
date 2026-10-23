"""Pre-boot integration checks for the Mutsu OS image repository.

These deliberately use only Python's standard library, so the build workflow
catches cross-repository breakage before spending time compiling the OCI image.
They are NOT a substitute for a booted GNOME session or a working ISO.
"""
from __future__ import annotations

import json
import pathlib
import re
import unittest
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class ImageIntegrationTests(unittest.TestCase):
    def test_pinned_desktop_source_is_single_and_recorded_in_image(self):
        manifest = read("packaging/desktop-source.env")
        commits = re.findall(r"^MUTSU_DESKTOP_COMMIT=([a-f0-9]{40})$", manifest, re.M)
        self.assertEqual(len(commits), 1)
        prep = read("packaging/prepare-desktop.sh")
        image = read("Containerfile")
        self.assertIn('source "$repo_root/packaging/desktop-source.env"', prep)
        self.assertIn('desktop_commit="$MUTSU_DESKTOP_COMMIT"', prep)
        self.assertIn(
            "COPY packaging/desktop-source.env /usr/share/mutsu-os/build-info/desktop-source.env",
            image,
        )
        self.assertIn("COPY vendor/ai-desktop/src/", image)

    def test_installed_gnome_launcher_and_first_login_match(self):
        image = read("Containerfile")
        search = read("packaging/mutsu-search")
        first_login = read("packaging/mutsu-first-login")
        desktop = read("packaging/io.github.markymark5127.AIDesktop.desktop")
        autostart = read("packaging/mutsu-first-login.desktop")
        self.assertIn("PYTHONPATH=", search)
        self.assertIn("/usr/libexec/mutsu-os/src", search)
        self.assertIn('from aidesktop.onboarding import is_setup_done', first_login)
        self.assertIn("if not is_setup_done():", first_login)
        self.assertIn("Exec=/usr/bin/mutsu-search", desktop)
        self.assertIn("Exec=/usr/libexec/mutsu-os/mutsu-first-login", autostart)
        self.assertIn("COPY packaging/mutsu-first-login.desktop", image)
        self.assertIn("COPY packaging/20-mutsu-shortcut.dconf", image)
        self.assertIn("PYTHONPATH=/usr/libexec/mutsu-os/src", image)

    def test_extension_does_not_steal_bazzite_enabled_extensions(self):
        installer = read("packaging/install-adaptive-extension.sh")
        image = read("Containerfile")
        self.assertNotIn("\nenabled-extensions=", installer)
        self.assertNotIn("cat > /etc/dconf/db/mutsu.d/40-mutsu-adaptive", installer)
        self.assertIn("glib-compile-schemas --strict", installer)
        self.assertIn("Mutsu Adaptive Desktop installed (not enabled", installer)
        self.assertIn("COPY extensions/mutsu-adaptive@mutsu-os", image)

    def test_touch_interception_is_explicit_opt_in(self):
        schema = ET.fromstring(
            read("extensions/mutsu-adaptive@mutsu-os/schemas/"
                 "org.gnome.shell.extensions.mutsu-adaptive.gschema.xml")
        )
        matches = [
            k for k in schema.iter("key")
            if k.attrib.get("name") == "enable-experimental-gestures"
        ]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].findtext("default"), "false")
        source = read("extensions/mutsu-adaptive@mutsu-os/extension.js")
        self.assertIn("get_boolean('enable-experimental-gestures')", source)
        self.assertIn("this._installBottomGesture();", source)
        self.assertIn("Quick Settings unavailable", source)

    def test_extension_metadata_and_schema_are_well_formed(self):
        metadata = json.loads(
            read("extensions/mutsu-adaptive@mutsu-os/metadata.json")
        )
        self.assertEqual(metadata["uuid"], "mutsu-adaptive@mutsu-os")
        self.assertEqual(
            metadata["settings-schema"], "org.gnome.shell.extensions.mutsu-adaptive"
        )
        self.assertTrue(metadata.get("shell-version"))
        ET.fromstring(
            read("extensions/mutsu-adaptive@mutsu-os/schemas/"
                 "org.gnome.shell.extensions.mutsu-adaptive.gschema.xml")
        )

    def test_image_branding_preserves_bazzite_machine_identifiers(self):
        script = read("packaging/install-branding.sh")
        self.assertIn('"PRETTY_NAME"', script)
        self.assertIn('"LOGO"', script)
        self.assertNotIn('"ID":', script)
        self.assertNotIn('"ID_LIKE":', script)
        self.assertNotIn('"VERSION_ID":', script)
        self.assertIn("mutsu-logo-symbol.svg", script)
        self.assertIn("mutsu-japandi-4k.png", script)

    def test_preflight_runs_before_expensive_build(self):
        just = read("Justfile")
        ci = read(".github/workflows/build.yml")
        self.assertIn("bash packaging/prepare-desktop.sh", just)
        self.assertIn("python3 packaging/check-integration.py", just)
        self.assertIn("python3 packaging/check-integration.py", ci)
        self.assertIn("PYTHONPATH=vendor/ai-desktop/src", ci)


if __name__ == "__main__":
    unittest.main()
