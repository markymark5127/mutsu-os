"""Static and unit checks for Mutsu clean-install provisioning.

They check source contracts, not an actual GNOME session, disk unlock, or VM.
"""
from __future__ import annotations

import importlib.util
from importlib.machinery import SourceFileLoader
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, mock
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class CleanInstallTests(TestCase):
    def test_iso_is_produced_after_container_workflow(self):
        flow = read(".github/workflows/build-disk.yml")
        self.assertIn('workflows: ["Build container image"]', flow)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", flow)
        self.assertIn("github.event.workflow_run.head_branch == 'main'", flow)
        self.assertIn("workflow_run.head_sha", flow)
        self.assertIn("latest-${short_sha}", flow)
        self.assertIn("skopeo inspect", flow)
        self.assertIn("PINNED_IMAGE=", flow)
        self.assertIn("image: ${{ env.PINNED_IMAGE }}", flow)
        self.assertNotIn("image: ${{ env.IMAGE_REGISTRY }}/${{ env.IMAGE_NAME }}:latest", flow)
        self.assertIn("github.event_name == 'workflow_dispatch'", flow)
        self.assertIn("# PRs only validate.", flow)

    def test_installer_branding_preserves_original_hybrid_boot(self):
        injector = read("packaging/inject-iso-branding.sh")
        self.assertIn("-boot_image any replay", injector)
        self.assertIn("-report_el_torito plain", injector)
        self.assertIn("/images/product.img", injector)
        self.assertIn('sha256sum "$iso"', injector)
        self.assertNotIn("xorriso -as mkisofs", injector)
        self.assertNotIn("xorriso -osirrox", injector)

    def test_script_plugin_available_before_branding(self):
        container = read("Containerfile")
        self.assertIn("dnf5 install -y plymouth-plugin-script librsvg2-tools", container)
        self.assertLess(
            container.index("dnf5 install -y plymouth-plugin-script"),
            container.index("COPY packaging/install-branding.sh"),
        )
        # No host-specific initramfs is generated in a container build.
        self.assertIn("packaging/verify-upstream-initramfs.sh", container)
        self.assertNotIn("packaging/rebuild-plymouth-initramfs.sh", container)
        verifier = read("packaging/verify-upstream-initramfs.sh")
        self.assertIn("/usr/lib/modules/$kernel/initramfs.img", verifier)
        self.assertIn('[[ -s "$img" ]]', verifier)
        self.assertIn('lsinitrd "$img" | grep -E', verifier)
        self.assertIn("'ostree-prepare-root'", verifier)
        # Comments may mention prior unsafe commands, but the script must
        # never execute dracut while inheriting an image-build host context.
        self.assertNotRegex(verifier, r"(?m)^\\s*(?:DRACUT_NO_XATTR=\\S+\\s+)?dracut\\b")

        self.assertNotIn("DRACUT_NO_XATTR=1 dracut -f", container)
        self.assertNotIn("DRACUT_NO_XATTR=1 dracut -f", verifier)
        self.assertNotIn("plymouth-set-default-theme -R", read("packaging/install-branding.sh"))
        script = read("branding/plymouth/mutsu.script")
        self.assertIn("Plymouth.SetDisplayPasswordFunction", script)
        self.assertIn("Plymouth.SetDisplayQuestionFunction", script)
        self.assertIn('masked = masked + "*"', script)

    def test_newelle_is_installed_once_at_real_first_boot(self):
        script = read("packaging/install-newelle.sh")
        self.assertIn("install-newelle-once", script)
        self.assertIn("/var/lib/mutsu-os/newelle-preinstall-complete", script)
        self.assertIn("flatpak remote-add --system --if-not-exists flathub", script)
        self.assertIn("flatpak install --system --noninteractive --assumeyes", script)
        self.assertIn("flatpak info --system", script)
        self.assertIn("systemctl enable mutsu-newelle-preinstall.service", script)
        self.assertIn("After=network-online.target", script)
        self.assertIn("ConditionPathExists=!/var/lib/mutsu-os/newelle-preinstall-complete", script)
        self.assertNotIn("--no-deploy", script)
        self.assertNotIn("flatpak preinstall", script.split("cat > /usr/libexec/mutsu-os")[1])
        self.assertNotIn("flatpak install --system", script.split("cat > /usr/libexec/mutsu-os")[0])

    def _load_first_boot(self):
        path = ROOT / "packaging/mutsu-first-boot"
        loader = SourceFileLoader("mutsu_first_boot_test", str(path))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return module

    def test_first_boot_does_not_mark_failure_as_success(self):
        module = self._load_first_boot()
        with TemporaryDirectory() as directory:
            module.MARKER = Path(directory) / "first-boot-japandi-v2"
            module.APPEARANCE_MARKER = Path(directory) / "japandi-defaults-v1"
            failed = subprocess.CompletedProcess(
                args=["gnome-extensions"], returncode=1, stdout="",
                stderr="Extension incompatible",
            )
            with mock.patch.object(module, "apply_initial_japandi_defaults"), \
                 mock.patch.object(module, "run", return_value=failed):
                self.assertEqual(module.main(), 1)
            self.assertFalse(module.MARKER.exists())
            self.assertTrue(module.APPEARANCE_MARKER.exists())

    def test_first_boot_activates_branding_and_dock_only_once(self):
        module = self._load_first_boot()
        with TemporaryDirectory() as directory:
            module.MARKER = Path(directory) / "first-boot-japandi-v2"
            module.APPEARANCE_MARKER = Path(directory) / "japandi-defaults-v1"
            ok = subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")
            unavailable = subprocess.CompletedProcess(
                args=[], returncode=1, stdout="", stderr="Dock not installed",
            )
            with mock.patch.object(module, "apply_initial_japandi_defaults") as apply, \
                 mock.patch.object(module, "run", side_effect=[ok, unavailable]) as runner:
                self.assertEqual(module.main(), 0)
                self.assertEqual(module.main(), 0)
                self.assertEqual(apply.call_count, 1)
                self.assertEqual(runner.call_count, 2)
                self.assertEqual(
                    [call.args[:2] for call in runner.call_args_list],
                    [("gnome-extensions", "enable"), ("gnome-extensions", "info")],
                )
                self.assertTrue(module.MARKER.exists())
                self.assertEqual(module.MARKER.stat().st_mode & 0o777, 0o600)
                self.assertEqual(module.APPEARANCE_MARKER.stat().st_mode & 0o777, 0o600)
        source = read("packaging/mutsu-first-boot")
        self.assertNotIn('"enabled-extensions",', source)
        self.assertNotIn('"enable-experimental-gestures": "true"', source)
        self.assertNotIn('run("gnome-extensions", "enable", ADAPTIVE)', source)
        self.assertNotIn('"gsettings", "set", BRANDING_SCHEMA', source)

    def test_new_japandi_defaults_preserve_existing_personal_preferences(self):
        module = self._load_first_boot()
        writes = {}
        class FakeSettings:
            def __init__(self, schema):
                self.schema = schema
                self.keys = {key for name, key, _, _ in module.INITIAL_DEFAULTS
                             if name == schema}
            def list_keys(self):
                return self.keys
            def get_user_value(self, key):
                # Existing custom wallpaper must not be reset by upgrade.
                if self.schema == "org.gnome.desktop.background" and key == "picture-uri":
                    return "user-customized"
                return None
            def record(self, key, value):
                writes[(self.schema, key)] = value
                return True
            set_string = record
            set_boolean = record
            set_int = record
            set_double = record
        module.apply_initial_japandi_defaults(lambda schema: FakeSettings(schema))
        self.assertNotIn(("org.gnome.desktop.background", "picture-uri"), writes)
        self.assertEqual(
            writes[("org.gnome.desktop.background", "picture-uri-dark")],
            module.WALLPAPER,
        )
        self.assertEqual(
            writes[("org.gnome.desktop.interface", "color-scheme")], "prefer-light",
        )
        self.assertEqual(
            writes[(module.DOCK_SCHEMA, "dock-position")], "BOTTOM",
        )

    def test_image_ships_gnome50_japandi_and_real_floating_dock(self):
        container = read("Containerfile")
        meta = __import__("json").loads(
            read("extensions/mutsu-branding@mutsu-os/metadata.json")
        )
        self.assertIn("50", meta["shell-version"])
        self.assertIn("gnome-shell-extension-dash-to-dock", container)
        self.assertIn("40-mutsu-japandi-defaults.dconf", container)
        self.assertIn("dconf update", read("packaging/configure-shortcut-defaults.sh"))
        defaults = read("packaging/40-mutsu-japandi-defaults.dconf")
        self.assertIn("mutsu-japandi-4k.png", defaults)
        self.assertIn("dock-position='BOTTOM'", defaults)
        self.assertIn("extend-height=false", defaults)
        self.assertIn("color-scheme='prefer-light'", defaults)
        ext = read("extensions/mutsu-branding@mutsu-os/extension.js")
        self.assertIn("mutsu-logo-japandi.svg", ext)
        self.assertIn("mutsu-logo-symbolic-white.svg", ext)
