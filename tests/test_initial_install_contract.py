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
        # A generic dracut rebuild from the image-build container lost
        # ostree-prepare-root in PR #52, even with --no-hostonly enabled.
        # Preserve the known-OSTree-capable vendor initramfs as a release gate.
        self.assertIn("packaging/verify-upstream-initramfs.sh", container)
        self.assertNotIn("COPY packaging/rebuild-mutsu-initramfs.sh", container)
        self.assertNotIn("RUN bash /tmp/mutsu-rebuild-initramfs.sh", container)
        verifier = read("packaging/verify-upstream-initramfs.sh")
        self.assertIn("ostree-prepare-root", verifier)
        self.assertIn("lsinitrd", verifier)
        self.assertIn('[[ -s "$img" ]]', verifier)
        self.assertNotIn("DRACUT_NO_XATTR=1 dracut -f", container)
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

    def _load_native_desktop(self):
        path = ROOT / "packaging/configure-native-desktop.py"
        spec = importlib.util.spec_from_file_location("mutsu_native_desktop_test", path)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return module

    def test_native_japandi_requires_no_login_hooks(self):
        image = read("Containerfile")
        native_installer = read("packaging/install-shell-branding.sh")
        self.assertIn("COPY packaging/configure-native-desktop.py", image)
        self.assertIn("python3 /tmp/mutsu-configure-native-desktop.py", image)
        self.assertNotIn("COPY packaging/mutsu-first-boot ", image)
        self.assertNotIn("COPY packaging/mutsu-first-boot.desktop", image)
        self.assertNotIn("install -Dm0644 /tmp/mutsu-first-boot.desktop", native_installer)
        self.assertIn("glib-compile-schemas --strict", native_installer)
        self.assertFalse((ROOT / "packaging/mutsu-first-boot").exists())
        self.assertFalse((ROOT / "packaging/mutsu-first-boot.desktop").exists())
        self.assertIn("system-db:mutsu", read("packaging/configure-shortcut-defaults.sh"))
        self.assertIn('subprocess.run(["dconf", "update"], check=True)',
                      read("packaging/configure-native-desktop.py"))

    def test_native_shell_extensions_preserve_upstream_defaults(self):
        module = self._load_native_desktop()
        upstream = ["gsconnect@andyholmes.github.io", "appindicatorsupport@rgcjonas.gmail.com"]
        schema = ["dash-to-panel@jderose9.github.com", "user-theme@gnome-shell-extensions.gcampax.github.com"]
        merged = module.merged_extensions(upstream, schema)
        self.assertEqual(merged[:2], upstream)
        self.assertNotIn("dash-to-panel@jderose9.github.com", merged)
        self.assertIn(module.BRANDING, merged)
        self.assertIn(module.DOCK, merged)
        self.assertIn(module.ADAPTIVE, merged)
        self.assertEqual(len(merged), len(set(merged)))
        self.assertEqual(module.parse_array("@as []"), [])
        self.assertEqual(module.parse_array("['one@example', 'two@example']"),
                         ["one@example", "two@example"])
        with TemporaryDirectory() as directory:
            vendor = Path(directory) / "vendor.d"
            vendor.mkdir()
            (vendor / "00-test").write_text(
                "[org/gnome/shell]\nenabled-extensions=['keep@vendor']\n",
                encoding="utf-8",
            )
            got = module.vendor_dconf_extensions(Path(directory))
            self.assertEqual(got, ["keep@vendor"])
        generated = module.render_extensions(merged)
        self.assertIn("[org/gnome/shell]", generated)
        self.assertIn("enabled-extensions=", generated)
        self.assertIn("'mutsu-branding@mutsu-os'", generated)
        self.assertIn("'dash-to-dock@micxgx.gmail.com'", generated)
        self.assertIn("'mutsu-adaptive@mutsu-os'", generated)

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
