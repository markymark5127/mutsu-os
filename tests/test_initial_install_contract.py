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
        self.assertIn("github.event_name != 'pull_request'", flow)

    def test_script_plugin_available_before_branding(self):
        container = read("Containerfile")
        self.assertIn("dnf5 install -y plymouth-plugin-script librsvg2-tools", container)
        self.assertLess(
            container.index("dnf5 install -y plymouth-plugin-script"),
            container.index("COPY packaging/install-branding.sh"),
        )
        self.assertIn("packaging/rebuild-plymouth-initramfs.sh", container)
        self.assertIn("DRACUT_NO_XATTR=1 dracut -f", read("packaging/rebuild-plymouth-initramfs.sh"))
        self.assertNotIn("plymouth-set-default-theme -R", read("packaging/install-branding.sh"))
        script = read("branding/plymouth/mutsu.script")
        self.assertIn("Plymouth.SetDisplayPasswordFunction", script)
        self.assertIn("Plymouth.SetDisplayQuestionFunction", script)
        self.assertIn('masked = masked + "*"', script)

    def test_newelle_is_requested_on_installed_system_not_during_build(self):
        script = read("packaging/install-newelle.sh")
        self.assertIn("/usr/share/flatpak/preinstall.d/90-mutsu-newelle.preinstall", script)
        self.assertIn("[Flatpak Preinstall io.github.qwersyk.Newelle]", script)
        self.assertIn("ExecStart=/usr/bin/flatpak preinstall --assumeyes", script)
        self.assertIn("systemctl enable mutsu-newelle-preinstall.service", script)
        self.assertNotIn("--no-deploy", script)
        self.assertNotIn("flatpak install --system", script)

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
            module.MARKER = Path(directory) / "first-boot-done"
            failed = subprocess.CompletedProcess(
                args=["gnome-extensions"], returncode=1, stdout="",
                stderr="Extension incompatible",
            )
            with mock.patch.object(module, "run", return_value=failed):
                self.assertEqual(module.main(), 1)
            self.assertFalse(module.MARKER.exists())

    def test_first_boot_safely_activates_and_is_idempotent(self):
        module = self._load_first_boot()
        with TemporaryDirectory() as directory:
            module.MARKER = Path(directory) / "first-boot-done"
            ok = subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")
            with mock.patch.object(module, "run", return_value=ok) as runner:
                self.assertEqual(module.main(), 0)
                self.assertTrue(module.MARKER.exists())
                self.assertEqual(module.main(), 0)
                self.assertEqual(runner.call_count, 2)
                names = [call.args[0] for call in runner.call_args_list]
                self.assertEqual(names, ["gnome-extensions", "gsettings"])
                self.assertEqual(
                    runner.call_args_list[-1].kwargs["env"]["GSETTINGS_SCHEMA_DIR"],
                    module.EXTENSION_SCHEMAS,
                )
                self.assertEqual(module.MARKER.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('enabled-extensions', read("packaging/mutsu-first-boot"))
        self.assertNotIn('"picture-uri"', read("packaging/mutsu-first-boot"))
