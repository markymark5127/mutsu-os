"""Exercise pairing readiness without starting Flatpak or making network calls."""
import pathlib
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

ROOT = pathlib.Path(__file__).resolve().parents[1]


class PairingReadinessTests(unittest.TestCase):
    def setUp(self):
        source = (ROOT / 'packaging/setup-newelle-user.sh').read_text(encoding='utf-8')
        probe = source.rsplit('import json\nfrom pathlib import Path\n', 1)[1].split('\nPY\n', 1)[0]
        self.scope = {'__name__': 'pairing_probe'}
        exec('import json\nfrom pathlib import Path\n' + probe, self.scope)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.token = pathlib.Path(self.temp.name) / 'token'
        self.token.write_text('test-only-token', encoding='utf-8')
        self.opener = MagicMock()
        self.scope['build_opener'] = lambda handler: self.opener
        self.sleep = patch('time.sleep').start()
        self.addCleanup(patch.stopall)

    def response(self, payload):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = payload
        return response

    def check(self):
        return self.scope['wait_for_api'](str(self.token), 8081, attempts=2)

    def test_ready_authenticated_api(self):
        self.opener.open.return_value = self.response(b'{"data": []}')
        self.assertTrue(self.check())
        request = self.opener.open.call_args.args[0]
        self.assertEqual(request.full_url, 'http://127.0.0.1:8081/v1/models')
        self.assertEqual(request.get_header('Authorization'), 'Bearer test-only-token')

    def test_delayed_start_retries(self):
        self.opener.open.side_effect = [URLError('refused'), self.response(b'{"data": []}')]
        self.assertTrue(self.check())

    def test_unreachable_service_does_not_pair(self):
        self.opener.open.side_effect = URLError('refused')
        self.assertFalse(self.check())

    def test_wrong_token_does_not_pair(self):
        self.opener.open.side_effect = HTTPError('', 401, 'Unauthorized', {}, None)
        self.assertFalse(self.check())
        self.assertEqual(self.opener.open.call_count, 1)

    def test_wrong_protocol_does_not_pair(self):
        self.opener.open.return_value = self.response(b'{"unexpected": true}')
        self.assertFalse(self.check())

