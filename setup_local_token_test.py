import importlib.util
import pathlib
import tempfile
import unittest
from unittest import mock
import io
import contextlib
import stat

ROOT = pathlib.Path(__file__).resolve().parent

class SetupTests(unittest.TestCase):
    def test_checked_token_is_saved_privately(self):
        spec = importlib.util.spec_from_file_location('setup_local_token', ROOT / 'setup_local_token.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(prefix='.setup-token-test-', dir=ROOT) as directory:
            module.save_token('synthetic-local-token', directory=directory,
                              check_fn=lambda token: {'status': 'connected', 'http_status': 200})
            folder = pathlib.Path(directory) / '.watchbible'
            target = folder / 'tmdb-read-access-token'
            self.assertEqual(target.read_text(), 'synthetic-local-token\n')
            self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def load_module(self):
        import setup_local_token
        return setup_local_token

    def test_failed_validation_preserves_existing_file(self):
        module = self.load_module()
        with tempfile.TemporaryDirectory(prefix='.setup-token-test-', dir=ROOT) as directory:
            module.save_token('synthetic-old', directory, lambda token: {'status': 'connected', 'http_status': 200})
            target = pathlib.Path(directory) / '.watchbible' / 'tmdb-read-access-token'
            for status in ['rejected', 'network_error', 'access_denied', 'rate_limited']:
                with self.assertRaises(ValueError):
                    module.save_token('synthetic-new', directory, lambda token: {'status': status})
                self.assertEqual(target.read_text(), 'synthetic-old\n')

    def test_bad_format_never_calls_network(self):
        module = self.load_module()
        check = mock.Mock(side_effect=AssertionError('network forbidden'))
        for token in ['', ' bad', 'bad ', 'Bearer-token', 'a' * 32, 'bad\n', '"bad"', 'bad\x00token', 'a' * 8193]:
            with self.assertRaises(ValueError):
                module.save_token(token, ROOT / '.must-never-be-created', check)
        check.assert_not_called()

    def test_unsafe_and_symlink_targets_rejected(self):
        module = self.load_module()
        connected = lambda token: {'status': 'connected', 'http_status': 200}
        for mode in ['file', 'directory', 'file_link', 'directory_link', 'owner']:
            with tempfile.TemporaryDirectory(prefix='.setup-token-test-', dir=ROOT) as directory:
                module.save_token('synthetic-old', directory, connected)
                folder = pathlib.Path(directory) / '.watchbible'
                target = folder / 'tmdb-read-access-token'
                if mode == 'file':
                    target.chmod(0o644)
                elif mode == 'directory':
                    folder.chmod(0o755)
                elif mode == 'file_link':
                    original = pathlib.Path(directory) / 'original'
                    target.rename(original)
                    target.symlink_to(original)
                elif mode == 'directory_link':
                    original = pathlib.Path(directory) / 'original-folder'
                    folder.rename(original)
                    folder.symlink_to(original, target_is_directory=True)
                with mock.patch.object(module.os, 'getuid', return_value=-1) if mode == 'owner' else contextlib.nullcontext():
                    with self.assertRaises(ValueError):
                        module.save_token('synthetic-new', directory, connected)
                self.assertEqual(target.read_text(), 'synthetic-old\n')

    def test_replace_failure_preserves_old_file_and_removes_temp(self):
        module = self.load_module()
        connected = lambda token: {'status': 'connected', 'http_status': 200}
        with tempfile.TemporaryDirectory(prefix='.setup-token-test-', dir=ROOT) as directory:
            module.save_token('synthetic-old', directory, connected)
            with mock.patch.object(module.os, 'replace', side_effect=OSError('synthetic-error-secret')):
                with self.assertRaises(OSError):
                    module.save_token('synthetic-new', directory, connected)
            folder = pathlib.Path(directory) / '.watchbible'
            self.assertEqual([p.name for p in folder.iterdir()], ['tmdb-read-access-token'])
            self.assertEqual((folder / 'tmdb-read-access-token').read_text(), 'synthetic-old\n')

    def test_post_replace_durability_error_never_claims_rollback(self):
        module = self.load_module()
        connected = lambda token: {'status': 'connected', 'http_status': 200}
        tty = mock.Mock()
        tty.isatty.return_value = True
        with tempfile.TemporaryDirectory(prefix='.setup-token-test-', dir=ROOT) as directory:
            module.save_token('synthetic-old', directory, connected)
            real_fsync = module.os.fsync
            def fault(fd):
                if stat.S_ISDIR(module.os.fstat(fd).st_mode):
                    raise OSError('synthetic-new')
                return real_fsync(fd)
            output = io.StringIO()
            with mock.patch.object(module.os, 'fsync', side_effect=fault), contextlib.redirect_stdout(output):
                result = module.main([], directory=directory, stdin=tty,
                    input_fn=lambda _: 'synthetic-new', check_fn=connected)
            self.assertEqual(result, 1)
            self.assertEqual((pathlib.Path(directory) / '.watchbible' / 'tmdb-read-access-token').read_text(), 'synthetic-new\n')
            self.assertIn('replaced', output.getvalue())
            self.assertIn('durability', output.getvalue())
            self.assertNotIn('Existing credential unchanged', output.getvalue())
            self.assertNotIn('synthetic-new', output.getvalue())

    def test_main_hidden_prompt_output_and_no_secret_arguments(self):
        module = self.load_module()
        tty = mock.Mock()
        tty.isatty.return_value = True
        with tempfile.TemporaryDirectory(prefix='.setup-token-test-', dir=ROOT) as directory:
            output = io.StringIO()
            prompt = mock.Mock(return_value='synthetic-hidden-token')
            with contextlib.redirect_stdout(output):
                result = module.main([], directory=directory, input_fn=prompt,
                    check_fn=lambda token: {'status': 'connected', 'http_status': 200}, stdin=tty)
            self.assertEqual(result, 0)
            prompt.assert_called_once_with('TMDB read-access token (hidden): ')
            self.assertNotIn('synthetic-hidden-token', output.getvalue())
            self.assertIn('NOT your Mac password', output.getvalue())
            with contextlib.redirect_stdout(output):
                self.assertEqual(module.main(['no-secrets-allowed'], input_fn=prompt, stdin=tty), 1)
            self.assertEqual(prompt.call_count, 1)

    def test_main_failure_sanitizes_exceptions(self):
        module = self.load_module()
        tty = mock.Mock()
        tty.isatty.return_value = True
        with tempfile.TemporaryDirectory(prefix='.setup-token-test-', dir=ROOT) as directory:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                result = module.main([], directory=directory, stdin=tty,
                    input_fn=lambda prompt: 'synthetic-hidden-token',
                    check_fn=mock.Mock(side_effect=RuntimeError('synthetic-hidden-token')))
            self.assertEqual(result, 1)
            self.assertNotIn('synthetic-hidden-token', output.getvalue())

    def test_noninteractive_main_never_prompts_or_checks_network(self):
        module = self.load_module()
        tty = mock.Mock()
        tty.isatty.return_value = False
        prompt = mock.Mock(side_effect=AssertionError('must not prompt'))
        check = mock.Mock(side_effect=AssertionError('must not request'))
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(module.main([], stdin=tty, input_fn=prompt, check_fn=check), 1)
        prompt.assert_not_called()
        check.assert_not_called()

if __name__ == '__main__':
    unittest.main()
