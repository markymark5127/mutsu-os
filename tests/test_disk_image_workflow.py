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
            self.workflow, r"--bootc-default-fs btrfs"
        )

    def test_matrix_preserves_both_artifacts(self):
        self.assertIn('disk-type: ["qcow2", "generic-iso"]', self.workflow)
        self.assertIn(
            "name: mutsu-os-${{ matrix.disk-type == 'generic-iso' && 'anaconda-iso' || matrix.disk-type }}-${{ inputs.platform || 'amd64' }}",
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

    def test_qcow2_uses_modern_supported_blueprint(self):
        self.assertIn('"${PWD}/disk_config/disk.toml:/config.toml:ro"', self.workflow)
        self.assertIn("--blueprint /config.toml", self.workflow)
        self.assertNotIn("format('{0}/disk_config/iso.toml', github.workspace)", self.workflow)

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
        self.assertEqual(disk["name"], "Mutsu OS VM")
        self.assertNotIn("customizations", disk)

    def test_ci_always_publishes_commit_specific_tag(self):
        build = (ROOT / ".github/workflows/build.yml").read_text(encoding="utf-8")
        self.assertIn('source_tag="${DEFAULT_TAG}-${GITHUB_SHA:0:7}"', build)
        self.assertIn('alias_tags+=" ${source_tag}"', build)
        self.assertIn('"${GITHUB_REF}" == "refs/heads/main"', build)
        # Image selection must remain immutable and commit-specific.
        self.assertIn('ref="${IMAGE_REGISTRY}/${IMAGE_NAME}:latest-${short_sha}"',
                      self.workflow)
        self.assertIn('pinned="${IMAGE_REGISTRY}/${IMAGE_NAME}@${digest}"',
                      self.workflow)
        ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("__pycache__/", ignore)

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
        self.assertIn("/LiveOS/squashfs.img", self.workflow)
        self.assertIn("-report_el_torito plain", self.workflow)
        self.assertIn("if-no-files-found: error", self.workflow)

    def test_modern_installer_is_interactive_and_digest_pinned(self):
        configs = sorted(path.name for path in (ROOT / "disk_config").glob("*.toml"))
        self.assertEqual(configs, ["disk.toml", "iso.toml"])
        script = (ROOT / "packaging/build-installer-iso.sh").read_text()
        containerfile = (ROOT / "packaging/installer/Containerfile").read_text()
        iso_yaml = (ROOT / "packaging/installer/iso.yaml").read_text()
        self.assertIn("--bootc-installer-payload-ref", script)
        self.assertIn("--bootc-default-fs ext4", script)
        self.assertIn("generic-iso", script)
        self.assertIn("MUTSU_PAYLOAD_REF", containerfile)
        self.assertIn("interactive-defaults.ks", containerfile)
        self.assertIn("containers-storage:%s", containerfile)
        self.assertIn("COPY branding/installer/.buildstamp", containerfile)
        self.assertIn("Install Mutsu OS", iso_yaml)
        self.assertIn("MUTSU_OS", iso_yaml)
        self.assertNotIn("clearpart", iso_yaml)
        self.assertNotIn("clearpart", containerfile)
        self.assertIn("packaging/build-installer-iso.sh", self.just)
        self.assertIn("(_rootful_load_image target_image tag)", self.just)
        self.assertNotIn('(_build-bib target_image tag "anaconda-iso"', self.just)

    def test_live_installer_includes_mutsu_artwork(self):
        main_image = (ROOT / ".github/workflows/build.yml").read_text()
        containerfile = (ROOT / "packaging/installer/Containerfile").read_text()
        self.assertIn('bash -n "$script"', main_image)
        self.assertIn("packaging/install-branding.sh", main_image)
        self.assertIn("COPY branding/installer/sidebar-bg.png", containerfile)
        self.assertIn("COPY branding/installer/.buildstamp", containerfile)
        self.assertNotIn("      - name: Inject Mutsu installer branding", self.workflow)
        self.assertIn("/LiveOS/squashfs.img", self.workflow)
        self.assertIn("-report_el_torito plain", self.workflow)

    def test_supported_builder_types_not_legacy_flags(self):
        self.assertIn("ghcr.io/osbuild/image-builder-cli:latest", self.workflow)
        self.assertIn('--bootc-ref "${PINNED_IMAGE}"', self.workflow)
        self.assertIn("--bootc-default-fs btrfs", self.workflow)
        self.assertIn("bash packaging/build-installer-iso.sh", self.workflow)
        self.assertNotIn("--force-repo", self.workflow)
        self.assertNotIn('image_type="anaconda-iso"', self.workflow)
        self.assertNotIn("osbuild/bootc-image-builder-action@", self.workflow)



if __name__ == "__main__":
    unittest.main()
