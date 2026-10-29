"""Regression checks for Flatpak namespaces during OCI image builds."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which('bash'), 'Requires a Linux/Bash build host')
class NewelleBuildEnvironmentTests(unittest.TestCase):
    def _preflight(self, result):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            for name, code in [('flatpak', 0), ('bwrap', result)]:
                command = folder / name
                command.write_text(f'#!/bin/sh\nexit {code}\n', encoding='utf-8')
                command.chmod(0o755)
            script = (ROOT / 'packaging/install-newelle.sh').read_text(encoding='utf-8')
            # Only exercise the read-only preflight, never image installation.
            preflight = script.split('flatpak remote-add --system', 1)[0]
            environment = dict(os.environ, PATH=str(folder) + os.pathsep + os.environ['PATH'])
            return subprocess.run(['bash', '-c', preflight], env=environment,
                                  capture_output=True, text=True, check=False)

    def test_blocked_namespaces_fail_before_downloading(self):
        result = self._preflight(1)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('builder blocks Flatpak namespaces', result.stderr)

    def test_supported_namespaces_pass_preflight(self):
        result = self._preflight(0)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_build_arguments_enable_nested_namespaces(self):
        source = (ROOT / 'Justfile').read_text(encoding='utf-8')
        block = source.split('    # Flatpak deployment', 1)[1].split('    LABELS=()', 1)[0]
        result = subprocess.run(['bash', '-c', textwrap.dedent('# Flatpak deployment' + block) +
                                 '\nprintf "%s\\n" "${BUILD_ARGS[@]}"'],
                                capture_output=True, text=True, check=True)
        args = result.stdout.splitlines()
        self.assertIn('SYS_ADMIN', args)
        self.assertIn('seccomp=unconfined', args)
