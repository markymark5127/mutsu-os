"""Test offline deployment with fake Flatpak/OSTree and an isolated filesystem."""
from pathlib import Path
import os
import shutil
import shlex
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which('bash'), 'Requires Bash')
class NewelleBuildEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        (self.folder / 'bin').mkdir()
        seed = self.folder / 'seed'
        (seed / 'flatpak/repo/objects').mkdir(parents=True)
        app = seed / 'flatpak/app/io.github.qwersyk.Newelle'
        app.mkdir(parents=True)
        (app / 'installed').write_text('app checkout', encoding='utf-8')
        (seed / 'flathub.flatpakrepo').write_text(
            '[Flatpak Repo]\nUrl=https://dl.flathub.org/repo/\nGPGKey=dGVzdA==\n', encoding='utf-8')
        self.command('flatpak', '''
case "$1" in
  info) test -f ./system/app/io.github.qwersyk.Newelle/installed ;;
  remote-add) exit 0 ;;
  *) echo "Unexpected Flatpak command: $*" >&2; exit 93 ;;
esac
''')
        self.command('ostree', """
echo "$*" >> ./ostree.log
case "$2" in
  refs) case "$3" in --list) printf '%s\n' 'flathub:runtime/org.freedesktop.Platform.GL.default/x86_64/25.08' ;; esac ;;
  rev-parse) printf '%064d\n' 1 ;;
  pull-local)
    test "$#" -eq 4 || { echo 'Implicit ref import is unsafe' >&2; exit 91; }
    case "$4" in *:*) exit 92 ;; esac
    exit "${MUTSU_TEST_OSTREE_RESULT:-0}" ;;
esac
""")
        self.command('chown', 'exit 0\n')
        self.command('restorecon', 'exit 0\n')
        self.command('tar', 'for target; do :; done\ncp -a ./seed/. "$target/"\n')
        self.command('python3', 'exec ' + shlex.quote(sys.executable.replace('\\', '/')) + ' "$@"\n')
        self.env = dict(os.environ, PATH=str(self.folder / 'bin') + os.pathsep + os.environ['PATH'])

    def command(self, name, content):
        path = self.folder / 'bin' / name
        path.write_text('#!/bin/sh\n' + content, encoding='utf-8')
        path.chmod(0o755)

    def run_worker(self):
        source = (ROOT / 'packaging/install-newelle.sh').read_text(encoding='utf-8')
        worker = source.split("cat > /usr/libexec/mutsu-os/install-newelle-once <<'EOF'\n", 1)[1].split('\nEOF', 1)[0]
        worker = worker.replace('/var/lib/mutsu-os', './state').replace('/var/lib/flatpak', './system')
        worker = worker.replace('/var/tmp/mutsu-newelle-install.', './install.')
        # Git Bash prepends its own bin directory on Windows; explicitly put
        # the fixture commands first inside Bash as well as in the environment.
        worker = 'export PATH="$(pwd)/bin:$PATH"\n' + worker
        return subprocess.run(['bash', '-c', worker], cwd=self.folder, env=self.env,
                              capture_output=True, text=True, check=False)

    def test_offline_deploy_preserves_other_system_apps(self):
        other = self.folder / 'system/app/other'
        other.mkdir(parents=True)
        (other / 'keep').write_text('unchanged', encoding='utf-8')
        result = self.run_worker()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.folder / 'system/app/io.github.qwersyk.Newelle/installed').is_file())
        self.assertEqual((other / 'keep').read_text(), 'unchanged')
        self.assertTrue((self.folder / 'state/newelle-preinstall-complete').is_file())

    def test_remote_ref_is_restored_after_commit_import(self):
        result = self.run_worker()
        self.assertEqual(result.returncode, 0, result.stderr)
        commands = (self.folder / 'ostree.log').read_text()
        self.assertIn('pull-local ', commands)
        self.assertIn('refs --force --create=flathub:runtime/org.freedesktop.Platform.GL.default/x86_64/25.08', commands)

    def test_image_build_preinstalls_without_consuming_first_boot_marker(self):
        self.env['MUTSU_IMAGE_BUILD'] = '1'
        result = self.run_worker()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.folder / 'system/app/io.github.qwersyk.Newelle/installed').is_file())
        self.assertFalse((self.folder / 'state/newelle-preinstall-complete').exists())

    def test_import_failure_does_not_mark_install_complete(self):
        self.env['MUTSU_TEST_OSTREE_RESULT'] = '1'
        result = self.run_worker()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('pull-local', (self.folder / 'ostree.log').read_text())
        self.assertFalse((self.folder / 'state/newelle-preinstall-complete').exists())

    def test_marker_respects_later_user_uninstall(self):
        (self.folder / 'state').mkdir()
        (self.folder / 'state/newelle-preinstall-complete').touch()
        result = self.run_worker()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.folder / 'ostree.log').exists())
        self.assertFalse((self.folder / 'system').exists())

    def test_oci_build_never_runs_flatpak(self):
        install = (ROOT / 'packaging/install-newelle.sh').read_text(encoding='utf-8')
        preamble = install.split("cat > /usr/lib/systemd/user/ai-desktop-newelle.service", 1)[0]
        self.assertNotIn('flatpak ', preamble.lower().replace('#', ''))
        self.assertNotIn('bwrap --', preamble)
        image = (ROOT / 'Containerfile').read_text(encoding='utf-8')
        self.assertIn('COPY vendor/newelle/flatpak.tar.zst', image)
        self.assertNotIn('COPY packaging/build-newelle-dependencies.sh', image)
        just = (ROOT / 'Justfile').read_text(encoding='utf-8')
        self.assertIn('bash packaging/prepare-newelle.sh', just)
        self.assertNotIn('--cap-add SYS_ADMIN', just)

    def test_host_preparation_runs_before_confined_build(self):
        workflow = (ROOT / '.github/workflows/build.yml').read_text(encoding='utf-8')
        self.assertLess(workflow.index('dbus-run-session -- bash packaging/prepare-newelle.sh'),
                        workflow.index('id: build-image'))
        script = (ROOT / 'packaging/prepare-newelle.sh').read_text(encoding='utf-8')
        self.assertIn('export FLATPAK_USER_DIR="$staging/flatpak"', script)
        self.assertIn('-C "$staging" flatpak flathub.flatpakrepo', script)


@unittest.skipUnless(shutil.which('ostree') and sys.platform == 'linux', 'Requires Linux OSTree')
class RealOstreeImportTests(unittest.TestCase):
    def test_remote_refs_and_objects_survive_offline_import(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            seed = root / 'seed'
            target = root / 'target'
            tree = root / 'tree'
            seed.mkdir()
            tree.mkdir()
            (tree / 'payload').write_text('offline fixture')
            def ostree(repo, *args):
                return subprocess.check_output(['ostree', '--repo=' + str(repo), *args], text=True).strip()
            ostree(seed / 'repo', 'init', '--mode=bare-user-only')
            ostree(target, 'init', '--mode=bare-user-only')
            commit = ostree(seed / 'repo', 'commit', '--branch=fixture', '--subject=fixture', '--tree=dir=' + str(tree))
            refs = ['flathub:runtime/org.freedesktop.Platform.GL.default/x86_64/25.08',
                    'flathub:app/io.github.qwersyk.Newelle/x86_64/stable']
            for ref in refs:
                ostree(seed / 'repo', 'refs', '--create=' + ref, commit)
            ostree(seed / 'repo', 'refs', '--delete', 'fixture')
            source = (ROOT / 'packaging/install-newelle.sh').read_text()
            block = source.split('# BEGIN OFFLINE REF IMPORT\n', 1)[1].split('# END OFFLINE REF IMPORT', 1)[0]
            block = block.replace('/var/lib/flatpak/repo', str(target))
            script = 'set -euo pipefail\nseed=' + shlex.quote(str(seed)) + '\nstaging=' + shlex.quote(str(root)) + '\n' + block
            subprocess.run(['bash', '-c', script], check=True, capture_output=True, text=True)
            for ref in refs:
                self.assertEqual(ostree(target, 'rev-parse', ref), commit)
            self.assertEqual(ostree(target, 'cat', commit, '/payload'), 'offline fixture')
