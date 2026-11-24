"""Swap sizing: zram as large as RAM, plus a backup swap file on disk.

On an 8 GB laptop Bazzite's half-RAM zram (3.8 GB) was 100% full after a few
days of Firefox and the desktop slowed down; the kernel had already
OOM-killed programs. zstd packed that 3.5 GB of swapped pages into 1.1 GB.
"""
from __future__ import annotations

import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEM = ROOT / "packaging/memory"
COMMANDS = ["df", "stat", "btrfs", "chmod", "chcon", "swapon", "mkswap", "fallocate", "mkdir"]


class SwapfileScriptTests(unittest.TestCase):
    def run_script(self, fstype="btrfs", avail_kib=50 * 1024 * 1024):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp, "calls")
            outputs = {"df": f"Avail\n{avail_kib}", "stat": fstype}
            for name in COMMANDS:
                fake = Path(tmp, name)
                out = outputs.get(name, "")
                fake.write_text(f'#!/bin/sh\necho "{name} $*" >> {log}\nprintf "%s\\n" "{out}"\n')
                fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
            env = {**os.environ, "PATH": f"{tmp}:{os.environ['PATH']}"}
            result = subprocess.run(["bash", str(MEM / "ensure-swapfile.sh")], env=env,
                                    capture_output=True, text=True, timeout=30)
            calls = log.read_text().splitlines() if log.exists() else []
        return result, calls

    def test_btrfs_gets_a_subvolume_and_a_lower_priority_swap_file(self):
        if Path("/var/swap/swapfile").exists():
            self.skipTest("this machine already has the swap file")
        result, calls = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("btrfs subvolume create /var/swap", calls)
        self.assertIn("btrfs filesystem mkswapfile --size 4096m /var/swap/swapfile", calls)
        self.assertIn("chcon -t swapfile_t /var/swap/swapfile", calls)
        self.assertEqual(calls[-1], "swapon --priority 10 /var/swap/swapfile")

    def test_other_filesystems_use_fallocate_and_mkswap(self):
        if Path("/var/swap/swapfile").exists():
            self.skipTest("this machine already has the swap file")
        result, calls = self.run_script(fstype="xfs")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("fallocate -l 4096M /var/swap/swapfile", calls)
        self.assertIn("mkswap /var/swap/swapfile", calls)
        self.assertFalse(any(c.startswith("btrfs") for c in calls))

    def test_a_nearly_full_disk_gets_no_swap_file(self):
        if Path("/var/swap/swapfile").exists():
            self.skipTest("this machine already has the swap file")
        result, calls = self.run_script(avail_kib=8 * 1024 * 1024)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(c.startswith(("btrfs", "fallocate", "swapon")) for c in calls))


class SwapConfigTests(unittest.TestCase):
    def test_zram_matches_ram(self):
        text = (MEM / "50-mutsu-zram.conf").read_text()
        self.assertIn("[zram0]", text)
        self.assertIn("zram-size = min(ram, 16384)", text)

    def test_swap_file_skips_the_live_usb(self):
        text = (MEM / "mutsu-swapfile.service").read_text()
        self.assertIn("ConditionKernelCommandLine=!tacklebox.live.squashimg", text)

    def test_image_installs_and_enables_both(self):
        text = (ROOT / "Containerfile").read_text()
        self.assertIn("/usr/lib/systemd/zram-generator.conf.d/50-mutsu-zram.conf", text)
        self.assertIn("/usr/libexec/mutsu-os/ensure-swapfile.sh", text)
        self.assertIn("systemctl enable mutsu-swapfile.service", text)


if __name__ == "__main__":
    unittest.main()
