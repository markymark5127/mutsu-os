"""Validate offline GUI API dependency setup without Flatpak or network access."""
import json
from pathlib import Path
import platform
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class NewelleDependencyTests(unittest.TestCase):
    def setUp(self):
        source = (ROOT / 'packaging/setup-newelle-user.sh').read_text(encoding='utf-8')
        code = source.split("<<'NEWELLE_DEPS'\n", 1)[1].split('\nNEWELLE_DEPS', 1)[0]
        scope = {'__name__': 'dependency_test'}
        exec(compile(code, 'newelle-dependencies', 'exec'), scope)
        self.prepare = scope['prepare_dependencies']
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.bundle = Path(self.temp.name) / 'bundle'
        packages = self.bundle / 'packages'
        packages.mkdir(parents=True)
        (packages / 'example.py').write_text('# bundled dependency', encoding='utf-8')
        self.target = Path(self.temp.name) / 'pip'
        self.metadata = {'python': list(sys.version_info[:2]), 'machine': platform.machine()}
        self.write_metadata()
        old_path = sys.path[:]
        self.addCleanup(lambda: sys.path.__setitem__(slice(None), old_path))

    def write_metadata(self):
        (self.bundle / 'runtime.json').write_text(json.dumps(self.metadata), encoding='utf-8')

    def test_copies_and_checks_imports_without_downloading(self):
        with patch('importlib.import_module') as load:
            self.prepare(self.bundle, self.target)
        self.assertTrue((self.target / 'example.py').is_file())
        self.assertEqual([call.args[0] for call in load.call_args_list], ['fastapi', 'uvicorn', 'multipart'])

    def test_preserves_unrelated_user_dependencies(self):
        self.target.mkdir()
        (self.target / 'user_package.py').write_text('# keep', encoding='utf-8')
        with patch('importlib.import_module'):
            self.prepare(self.bundle, self.target)
            self.prepare(self.bundle, self.target)
        self.assertTrue((self.target / 'user_package.py').is_file())

    def test_wrong_architecture_rejected_before_copy(self):
        self.metadata['machine'] = 'wrong-architecture'
        self.write_metadata()
        with self.assertRaisesRegex(RuntimeError, 'runtime changed'):
            self.prepare(self.bundle, self.target)
        self.assertFalse(self.target.exists())

    def test_wrong_python_rejected_before_copy(self):
        self.metadata['python'] = [0, 0]
        self.write_metadata()
        with self.assertRaises(RuntimeError):
            self.prepare(self.bundle, self.target)
        self.assertFalse(self.target.exists())

    def test_missing_dependency_is_a_failure(self):
        with patch('importlib.import_module', side_effect=ImportError('missing')):
            with self.assertRaises(ImportError):
                self.prepare(self.bundle, self.target)

    def test_bundle_is_built_and_first_login_has_no_package_download(self):
        image = (ROOT / 'Containerfile').read_text(encoding='utf-8')
        install = (ROOT / 'packaging/install-newelle.sh').read_text(encoding='utf-8')
        setup = (ROOT / 'packaging/setup-newelle-user.sh').read_text(encoding='utf-8')
        self.assertIn('COPY vendor/newelle/gui-api/', image)
        self.assertIn('/usr/share/mutsu-os/newelle-gui-api/runtime.json', install)
        self.assertNotIn('install_module(', setup)
        self.assertNotIn('pip install', setup)
        service = (ROOT / 'packaging/mutsu-newelle-link.service').read_text(encoding='utf-8')
        self.assertNotIn('ConditionPathExists=', service)
