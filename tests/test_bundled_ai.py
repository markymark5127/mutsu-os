"""Offline model integrity, native Newelle defaults and local readiness tests."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'packaging' / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Settings:
    def __init__(self, selected='newelle', llm=None, explicit=False):
        self.values = {'language-model': selected, 'llm-settings': json.dumps(llm or {}),
                       'interfaces-settings': json.dumps({'other-interface': {'keep': True}})}
        self.explicit = explicit

    def get_string(self, key):
        return self.values[key]

    def get_user_value(self, key):
        return object() if self.explicit else None

    def set_string(self, key, value):
        self.values[key] = value
        return True


class NewelleDefaultsTests(unittest.TestCase):
    def setUp(self):
        self.module = load('newelle_defaults', 'configure-newelle.py')
        self.model = {'endpoint': 'http://127.0.0.1:11435', 'model': 'qwen3.5:9b'}

    def test_new_user_is_connected_to_bundled_ollama(self):
        settings = Settings()
        self.module.configure(settings, 'test-token', self.model)
        self.assertEqual(settings.values['language-model'], 'ollama')
        llm = json.loads(settings.values['llm-settings'])['ollama']
        self.assertEqual(llm['model'], 'qwen3.5:9b')
        self.assertEqual(llm['endpoint'], 'http://127.0.0.1:11435')
        interfaces = json.loads(settings.values['interfaces-settings'])
        self.assertEqual(interfaces['gui-api']['api_key'], 'test-token')
        self.assertEqual(interfaces['gui-api']['host'], '127.0.0.1')
        self.assertEqual(interfaces['gui-api']['port'], 8081)
        self.assertTrue(interfaces['other-interface']['keep'])

    def test_existing_online_demo_migrates_to_requested_model(self):
        settings = Settings(explicit=True)
        self.module.configure(settings, 'test-token', self.model)
        self.assertEqual(settings.values['language-model'], 'ollama')

    def test_custom_cloud_provider_is_not_overwritten(self):
        llm = {'openai': {'api': 'test-only-key', 'model': 'chosen-model'}}
        settings = Settings('openai', llm, explicit=True)
        self.module.configure(settings, 'test-token', self.model)
        self.assertEqual(settings.values['language-model'], 'openai')
        self.assertEqual(json.loads(settings.values['llm-settings']), llm)

    def test_other_ollama_models_are_retained(self):
        llm = {'ollama': {'model': 'another-model', 'endpoint': 'http://127.0.0.1:11434'}}
        settings = Settings('ollama', llm, explicit=True)
        self.module.configure(settings, 'test-token', self.model)
        self.assertEqual(json.loads(settings.values['llm-settings']), llm)

    def test_remote_ollama_is_retained(self):
        llm = {'ollama': {'model': 'qwen3.5:9b', 'endpoint': 'http://test-server:11434'}}
        settings = Settings('ollama', llm, explicit=True)
        self.module.configure(settings, 'test-token', self.model)
        self.assertEqual(json.loads(settings.values['llm-settings']), llm)

    def test_existing_requested_local_model_is_connected_to_packaged_engine(self):
        settings = Settings('ollama', {'ollama': {'model': 'qwen3.5:9b',
                            'endpoint': 'http://localhost:11434', 'thinking': True}}, explicit=True)
        self.module.configure(settings, 'test-token', self.model)
        llm = json.loads(settings.values['llm-settings'])['ollama']
        self.assertEqual(llm['endpoint'], self.model['endpoint'])
        self.assertTrue(llm['thinking'])

    def test_bad_token_and_remote_default_are_rejected(self):
        with self.assertRaises(ValueError):
            self.module.configure(Settings(), 'bad\ntoken', self.model)
        with self.assertRaises(ValueError):
            self.module.configure(Settings(), 'test-token', {**self.model, 'endpoint': 'https://example.com'})

    def test_login_unit_is_tied_to_graphical_session_without_order_cycle(self):
        unit = (ROOT / 'packaging/mutsu-newelle-link.service').read_text()
        self.assertIn('WantedBy=graphical-session.target', unit)
        self.assertIn('After=graphical-session-pre.target', unit)
        self.assertNotIn('After=graphical-session.target\n', unit)
        self.assertIn('Restart=on-failure', unit)


class ModelReadinessTests(unittest.TestCase):
    def setUp(self):
        self.module = load('local_model_health', 'wait-local-model.py')
        self.opener = MagicMock()
        self.module.build_opener = lambda _: self.opener
        sleep = patch.object(self.module.time, 'sleep')
        sleep.start()
        self.addCleanup(sleep.stop)

    def response(self, obj):
        return io.BytesIO(json.dumps(obj).encode())

    def tags(self):
        return {'models': [{'name': self.module.MODEL, 'digest': self.module.DIGEST}]}

    def test_boot_health_check_does_not_send_a_prompt(self):
        self.opener.open.return_value = self.response(self.tags())
        self.module.wait_ready('http://127.0.0.1:11435', attempts=1)
        self.assertEqual(self.opener.open.call_args.args[0], 'http://127.0.0.1:11435/api/tags')
        self.assertEqual(self.opener.open.call_count, 1)

    def test_cold_start_retries(self):
        self.opener.open.side_effect = [URLError('starting'), self.response(self.tags())]
        self.module.wait_ready('http://127.0.0.1:11435', attempts=2)

    def test_wrong_model_or_digest_is_not_ready(self):
        self.opener.open.return_value = self.response({'models': []})
        with self.assertRaises(RuntimeError):
            self.module.wait_ready('http://127.0.0.1:11435', attempts=1)

    def test_explicit_build_smoke_test_requires_actual_model_reply(self):
        self.opener.open.side_effect = [self.response(self.tags()),
                                       self.response({'message': {'content': 'READY'}})]
        self.module.wait_ready('http://127.0.0.1:11435', attempts=1, smoke=True)
        payload = json.loads(self.opener.open.call_args.args[0].data)
        self.assertEqual(payload['model'], 'qwen3.5:9b')
        self.assertEqual(payload['messages'][0]['content'], 'Say READY.')
        self.assertFalse(payload['think'])


class ModelIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.module = load('model_fetch', 'fetch-ollama-model.py')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def test_checksum_mismatch_never_leaves_a_complete_blob(self):
        target = self.folder / 'blob'
        with patch.object(self.module, 'urlopen', return_value=io.BytesIO(b'wrong')):
            with self.assertRaises(ValueError):
                self.module.verified_download('https://example.test/blob', target, 'a' * 64)
        self.assertFalse(target.exists())
        self.assertFalse(target.with_suffix('.partial').exists())

    def test_manifest_uses_tag_and_rejects_changed_content_before_layers(self):
        raw = b'{"changed":true}'
        with patch.object(self.module, 'urlopen', return_value=io.BytesIO(raw)) as request:
            with self.assertRaisesRegex(ValueError, 'checksum'):
                self.module.fetch_model(self.folder, 'sha256:' + 'a' * 64)
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args[0].full_url,
                         self.module.REGISTRY + '/manifests/9b')
        self.assertFalse((self.folder / 'models').exists())
        self.assertFalse((self.folder / 'manifest.json').exists())

    def test_http_failure_identifies_the_failed_asset(self):
        url = self.module.REGISTRY + '/manifests/9b'
        with patch.object(self.module, 'urlopen', side_effect=HTTPError(url, 404, 'Not Found', {}, None)):
            with self.assertRaisesRegex(RuntimeError, 'HTTP 404 for ' + url):
                self.module.verified_download(url, self.folder / 'manifest.json', 'a' * 64)
        self.assertFalse((self.folder / 'manifest.partial').exists())

    def test_complete_model_store_includes_license_and_verified_manifest(self):
        config, weights, license = b'{}', b'fixture weights', b'fixture model license'
        def item(content, media):
            return {'mediaType': media, 'size': len(content),
                    'digest': 'sha256:' + hashlib.sha256(content).hexdigest()}
        data = {'config': item(config, 'config'), 'layers': [item(weights, 'model'),
                item(license, 'application/vnd.ollama.image.license')]}
        raw = json.dumps(data).encode()
        digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
        responses = [raw, config, weights, license]
        with patch.object(self.module, 'urlopen', side_effect=lambda *a, **k: io.BytesIO(responses.pop(0))):
            self.module.fetch_model(self.folder, digest)
        self.assertEqual((self.folder / 'models/manifests/registry.ollama.ai/library/qwen3.5/9b').read_bytes(), raw)
        self.assertEqual((self.folder / 'licenses/Qwen-3.5-LICENSE').read_bytes(), license)
