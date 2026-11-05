"""Guard the separate Mutsu USB Live Desktop workflow from automatic runs.

The installer ISO and QCOW2 jobs are intentionally unaffected by this file.
These checks cover the recipe and workflow wiring, not graphical boot success.
"""

from __future__ import annotations

import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/build-live-iso.yml"
RECIPE = ROOT / "packaging/live/recipe.json"


class LiveISOTests(unittest.TestCase):
    def test_only_manual_dispatch(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertRegex(workflow, r"(?m)^on:\n  workflow_dispatch:\n")
        self.assertNotRegex(
            workflow, r"(?m)^  (push|pull_request|schedule|workflow_run):"
        )
        self.assertIn("name: Build Mutsu Live USB ISO (manual)", workflow)

    def test_live_not_installer(self):
        recipe = json.loads(RECIPE.read_text(encoding="utf-8"))
        self.assertEqual(recipe["default_boot"], "mutsu")
        self.assertEqual(recipe["media_name"], "MUTSU_LIVE")
        self.assertEqual(len(recipe["bootable_environments"]), 1)
        entry = recipe["bootable_environments"][0]
        self.assertEqual(entry["id"], "mutsu")
        self.assertEqual(entry["desktop"], "gnome")
        self.assertEqual(entry["modes"], ["live"])
        self.assertEqual(entry["image"], "ghcr.io/markymark5127/mutsu-os:latest")
        self.assertNotIn("offline_payloads", recipe)

    def test_builds_from_published_immutable_container(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('default: latest', workflow)
        self.assertIn('skopeo inspect', workflow)
        self.assertIn('PINNED_IMAGE=', workflow)
        self.assertIn('sudo podman pull "$pinned"', workflow)
        self.assertIn('jq --arg image "$PINNED_IMAGE"', workflow)
        self.assertIn('tacklebox build mutsu-live-out/recipe.json', workflow)
        self.assertIn('tacklebox verify mutsu-live-out/mutsu-os-live.iso', workflow)
        self.assertIn('qemu-live-boot.log', workflow)
        self.assertIn('mutsu-os-live-amd64', workflow)
        self.assertNotIn('clearpart', workflow)
        self.assertNotIn('install to-disk', workflow)
        self.assertNotIn('bootc-image-builder', workflow)

    def test_failed_qemu_boot_blocks_success_but_keeps_diagnostics(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("bash .tacklebox/scripts/test-live-boot.sh", workflow)
        self.assertNotIn("continue-on-error: true", workflow)
        self.assertIn("if: always() && steps.iso.outcome == 'success'", workflow)
        self.assertIn("FAILED: Live optical/USB boot not fully confirmed", workflow)
        self.assertIn("::error::QEMU optical or raw USB boot failed", workflow)
        self.assertIn("mutsu-live-out/qemu-usb-boot.log", workflow)
        self.assertIn("mutsu-live-out/qemu-live-boot.log", workflow)

    def test_dd_written_usb_boot_is_patched_and_tested(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        usb_test = ROOT / "packaging/live/test-usb-boot.sh"
        self.assertTrue(usb_test.is_file())
        script = usb_test.read_text(encoding="utf-8")
        self.assertIn("partition_entry=gpt_basdat", workflow)
        self.assertIn("part_like_isohybrid=on", workflow)
        self.assertIn("Raw USB UEFI boot smoke test", workflow)
        self.assertIn("bash packaging/live/test-usb-boot.sh", workflow)
        self.assertIn("QEMU_LIVE_LOG:", workflow)
        self.assertIn("qemu-usb-boot.log", workflow)
        self.assertIn('USB_SMOKE_RESULT: ${{ steps.usb-smoke.outcome }}', workflow)
        self.assertNotIn("continue-on-error: true", workflow)
        self.assertIn("-device usb-storage,drive=usb-image,bootindex=1", script)
        self.assertIn("if=none,id=usb-image,format=raw,readonly=on", script)
        self.assertIn('grep -aq "login:" "$LOG"', script)

    def test_boot_tests_use_kvm_and_publish_readable_logs(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        kvm = workflow.index("Enable KVM acceleration for boot tests")
        self.assertLess(kvm, workflow.index("Headless QEMU UEFI boot smoke test"))
        self.assertIn('KERNEL=="kvm", GROUP="kvm", MODE="0666"', workflow)
        self.assertIn("mutsu-os-live.iso 900", workflow)
        self.assertNotIn("mutsu-os-live.iso 600", workflow)
        self.assertIn("Show end of boot logs", workflow)
        self.assertIn("mutsu-os-live-boot-logs", workflow)

    def test_upstream_builder_revision_is_pinned(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("repository: tuna-os/tacklebox", workflow)
        self.assertRegex(workflow, r"ref: [a-f0-9]{40}")
        self.assertIn("go-version-file: .tacklebox/go.mod", workflow)


if __name__ == "__main__":
    unittest.main()
