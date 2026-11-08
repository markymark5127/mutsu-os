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

    def test_live_session_skips_heavy_first_boot_seeding(self):
        # The live ISO's /var is a RAM overlay. Copying the bundled model
        # (gigabytes) and the Newelle Flatpak there ran QEMU out of memory
        # and held the login prompt behind a 15-minute start timeout.
        live = "ConditionKernelCommandLine=!tacklebox.live.squashimg"
        for name in ("packaging/mutsu-local-model.service",
                     "packaging/mutsu-newelle-link.service",
                     "packaging/install-newelle.sh"):
            self.assertIn(live, (ROOT / name).read_text(encoding="utf-8"), name)
        model = (ROOT / "packaging/mutsu-local-model.service").read_text(encoding="utf-8")
        self.assertNotIn("Before=systemd-user-sessions.service", model)

    def test_live_usb_logs_in_automatically(self):
        # Tacklebox only adds its live user when a recipe lists
        # live_customize scripts; Mutsu's recipe has none, so the image
        # sets up liveuser itself, only on the live USB.
        unit = (ROOT / "packaging/mutsu-live-session.service").read_text(encoding="utf-8")
        self.assertIn("ConditionKernelCommandLine=tacklebox.live.squashimg", unit)
        self.assertIn("Before=display-manager.service", unit)
        script = (ROOT / "packaging/live-session-setup.sh").read_text(encoding="utf-8")
        for needle in ('AutomaticLogin', 'passwd --delete', 'lock-enabled=false', 'useradd'):
            self.assertIn(needle, script)
        # live-iso-mode makes fisherman demand media-input.json, which this
        # USB does not have: installs failed with "required local source".
        self.assertNotIn(": > /etc/bootc-installer/live-iso-mode", script)
        containerfile = (ROOT / "Containerfile").read_text(encoding="utf-8")
        self.assertIn("systemctl enable mutsu-hostname.service mutsu-live-session.service", containerfile)
        self.assertIn("Finished mutsu-live-sess", WORKFLOW.read_text(encoding="utf-8"))

    def test_upstream_builder_revision_is_pinned(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("repository: tuna-os/tacklebox", workflow)
        self.assertRegex(workflow, r"ref: [a-f0-9]{40}")
        self.assertIn("go-version-file: .tacklebox/go.mod", workflow)


    def test_live_usb_carries_the_installer_and_its_image(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(".offline_payloads = [{source: $image, ref: $ref}]", workflow)
        self.assertIn("options: [offline, online]", workflow)
        online = (ROOT / ".github/workflows/build-live-iso-online.yml").read_text(encoding="utf-8")
        self.assertIn("uses: ./.github/workflows/build-live-iso.yml", online)
        self.assertIn("variant: online", online)
        self.assertIn("live_customize", workflow)
        self.assertIn("TBOX_CUSTOMIZE_CAPS=NET_ADMIN", workflow)
        script = (ROOT / "packaging" / "live" / "customize.sh").read_text(encoding="utf-8")
        for needle in ("images.json", "superiso-store", "mutsu-install.desktop",
                       "polkit.addRule", "org.mozilla.firefox"):
            self.assertIn(needle, script)

    def test_live_usb_drops_dead_weight(self):
        script = (ROOT / "packaging" / "live" / "customize.sh").read_text(encoding="utf-8")
        self.assertIn("rm -rf /usr/share/mutsu-os/local-ai/models", script)
        self.assertIn("find /sysroot/ostree -mindepth 1 -maxdepth 1 -exec rm -rf {} +", script)
        self.assertIn('.shared_store.compression = "release"', WORKFLOW.read_text(encoding="utf-8"))

if __name__ == "__main__":
    unittest.main()
