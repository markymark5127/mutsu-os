"""Regression checks for Mutsu OS bootc disk and ISO workflow wiring.

These run before the expensive privileged image-builder action and use only
Python's standard library (GitHub's Ubuntu runner has Python >= 3.11).
They deliberately cannot claim that an installer ISO has been boot-tested.
"""

from __future__ import annotations

import pathlib
import re
import tomllib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class DiskImageWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (
            ROOT / ".github/workflows/build-disk.yml"
        ).read_text(encoding="utf-8")
        cls.just = (ROOT / "Justfile").read_text(encoding="utf-8")

    def test_root_filesystem_matches_justfile_btrfs(self):
        self.assertRegex(self.just, r"--rootfs=btrfs")
        self.assertRegex(
            self.workflow, r"(?m)^          rootfs: btrfs\s*$"
        )
        # Do not pass two conflicting --rootfs flags to the action.
        self.assertNotIn("additional-args: --rootfs", self.workflow)

    def test_matrix_preserves_both_artifacts(self):
        self.assertIn('disk-type: ["qcow2", "anaconda-iso"]', self.workflow)
        self.assertIn("types: ${{ matrix.disk-type }}", self.workflow)
        self.assertIn(
            "name: mutsu-os-${{ matrix.disk-type }}-${{ inputs.platform || 'amd64' }}",
            self.workflow,
        )

    def test_pull_request_defaults_to_x86_not_arm(self):
        # workflow_dispatch has inputs.platform, pull_request does not.
        self.assertIn(
            "runs-on: ${{ inputs.platform == 'arm64' && "
            "'ubuntu-24.04-arm' || 'ubuntu-24.04' }}",
            self.workflow,
        )
        for path in (
            "'disk_config/disk.toml'",
            "'disk_config/iso.toml'",
            "'.github/workflows/build-disk.yml'",
        ):
            self.assertIn(path, self.workflow)
        self.assertNotIn("'./disk_config", self.workflow)

    def test_config_file_paths_are_absolute_workspace_binds(self):
        # Relative 'disk_config/foo.toml' is parsed as a Podman named
        # volume, not a host bind-mount path.
        self.assertIn("format('{0}/disk_config/iso.toml', github.workspace)", self.workflow)
        self.assertIn("format('{0}/disk_config/disk.toml', github.workspace)", self.workflow)
        self.assertNotIn("config-file: ${{ matrix.disk-type == 'anaconda-iso' && './", self.workflow)

    def test_disk_image_runner_stays_on_ubuntu_24(self):
        # The privileged osbuild mount operation fails with EPERM on
        # ubuntu-26.04 for both artifacts (2026-10-23 CI logs).
        self.assertIn("'ubuntu-24.04-arm' || 'ubuntu-24.04'", self.workflow)
        self.assertNotIn("'ubuntu-26.04-arm' || 'ubuntu-26.04'", self.workflow)

    def test_toml_blueprints_exist_and_parse(self):
        for name in ("disk", "iso"):
            with self.subTest(name=name):
                content = (ROOT / f"disk_config/{name}.toml").read_bytes()
                values = tomllib.loads(content.decode("utf-8"))
                self.assertIsInstance(values, dict)
        with (ROOT / "disk_config/disk.toml").open("rb") as handle:
            disk = tomllib.load(handle)
        self.assertEqual(
            disk["customizations"]["filesystem"][0]["mountpoint"], "/"
        )

    def test_automatic_disk_builds_only_follow_published_main_images(self):
        self.assertIn('workflows: ["Build container image"]', self.workflow)
        self.assertIn("types: [completed]", self.workflow)
        self.assertRegex(self.workflow, r"(?s)workflow_run:\n.*?branches: \[main\]")
        self.assertIn("github.event.workflow_run.conclusion == 'success'", self.workflow)
        self.assertIn("github.event.workflow_run.head_branch == 'main'", self.workflow)
        self.assertIn("github.event.workflow_run.event == 'push'", self.workflow)
        self.assertIn("github.event.workflow_run.event == 'workflow_dispatch'", self.workflow)
        self.assertIn("github.event_name == 'workflow_dispatch'", self.workflow)

    def test_other_workflow_runs_cannot_cancel_live_disk_builds(self):
        # workflow_run uses main as github.ref even for completed PR builds.
        self.assertNotIn("cancel-in-progress: true", self.workflow)
        self.assertNotIn("group: ", self.workflow)

    def test_only_real_images_are_uploaded_with_provenance(self):
        self.assertIn("Verify fresh ISO / QCOW2", self.workflow)
        self.assertIn("-type f -name '*.iso'", self.workflow)
        self.assertIn("-type f -name '*.qcow2'", self.workflow)
        self.assertIn("MUTSU-SHA256SUMS.txt", self.workflow)
        self.assertIn("MUTSU-BUILD-INFO.txt", self.workflow)
        self.assertIn("MUTSU_SOURCE_SHA=", self.workflow)
        self.assertIn("MUTSU_CONTAINER_IMAGE=", self.workflow)
        self.assertIn("/images/product.img", self.workflow)
        self.assertIn("-report_el_torito plain", self.workflow)
        self.assertIn("if-no-files-found: error", self.workflow)

    def test_action_still_uses_read_only_builder_config(self):
        self.assertIn("uses: osbuild/bootc-image-builder-action@", self.workflow)
        self.assertIn("config-file: ${{ matrix.disk-type", self.workflow)
        self.assertIn("additional-args: --use-librepo=True", self.workflow)


if __name__ == "__main__":
    unittest.main()
