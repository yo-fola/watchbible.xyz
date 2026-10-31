import unittest
from token_diagnostic import check_token


class TokenDiagnosticTests(unittest.TestCase):
    def test_keychain_read_is_scoped_and_never_accepts_partial_failure_output(self):
        import token_diagnostic
        from types import SimpleNamespace
        reader = getattr(token_diagnostic, 'read_keychain', None)
        self.assertTrue(callable(reader), 'dedicated-item reader exists')
        calls = []
        def fake_run(command, **options):
            calls.append((command, options))
            return SimpleNamespace(returncode=0, stdout='synthetic.readaccess.value\n', stderr='')
        self.assertEqual(reader(fake_run), 'synthetic.readaccess.value')
        self.assertEqual(calls[0][0], ['/usr/bin/security', 'find-generic-password', '-a', 'watchbible', '-s', 'watchbible.tmdb-read-access-token', '-w'])
        self.assertTrue(calls[0][1]['capture_output'])
        self.assertIsNone(reader(lambda *a, **k: SimpleNamespace(returncode=1, stdout='partial-secret', stderr='private failure')))

    def test_setup_uses_explicit_local_token_input_instead_of_keychain(self):
        from pathlib import Path
        source = Path(__file__).with_name('setup-watchbible-token.zsh').read_text()
        self.assertIn('setup_local_token.py', source)
        self.assertNotIn('/usr/bin/security', source)

    def test_rejects_api_key_and_bearer_prefix_before_network(self):
        def no_request(token):
            self.fail('Must not request with malformed input')
        for token in ['a' * 32, 'Bearer synthetic.token.value', ' synthetic.token.value', 'synthetic.token.value\n', '']:
            result = check_token(token, no_request)
            self.assertEqual(result['status'], 'input_error')
            self.assertNotIn(token, str(result)) if token else None

    def test_connected_result_never_contains_token(self):
        token = 'synthetic.readaccess.value'
        seen = []
        def request(value):
            seen.append(value)
            return 200, {'images': {'secure_base_url': 'https://image.tmdb.org/t/p/', 'poster_sizes': ['w500']}}
        self.assertEqual(check_token(token, request), {'status': 'connected', 'http_status': 200})
        self.assertEqual(seen, [token])

    def test_preserves_status_and_sanitizes_errors(self):
        for code, status in [(401, 'rejected'), (403, 'access_denied'), (429, 'rate_limited'), (502, 'provider_error')]:
            result = check_token('synthetic.readaccess.value', lambda token: (code, {'private': token}))
            self.assertEqual(result, {'status': status, 'http_status': code})
        def broken(token):
            raise RuntimeError(token)
        self.assertEqual(check_token('synthetic.readaccess.value', broken), {'status': 'network_error'})

    def test_invalid_success_response_is_not_claimed_connected(self):
        result = check_token('synthetic.readaccess.value', lambda token: (200, {'private': token}))
        self.assertEqual(result, {'status': 'provider_error', 'http_status': 200})


if __name__ == '__main__':
    unittest.main()
