"""User-run hidden entry; validated plaintext storage in this project only."""
import getpass
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

from token_diagnostic import check_token

ROOT = Path(__file__).resolve().parent
MAX_BYTES = 8192


class CredentialDurabilityError(OSError):
    """Replacement completed, but its disk durability was not confirmed."""


def _valid(token):
    return (isinstance(token, str) and 0 < len(token.encode('utf-8')) <= MAX_BYTES
            and re.fullmatch(r'[\x21-\x7e]+', token) is not None
            and not token.lower().startswith('bearer')
            and re.fullmatch(r'[a-fA-F0-9]{32}', token) is None
            and not token.startswith(('"', "'")) and not token.endswith(('"', "'")))


def _metadata(info, mode, directory=False):
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != mode or not kind(info.st_mode):
        raise ValueError('Unsafe local credential permissions. Nothing saved.')


def save_token(token, directory=ROOT, check_fn=check_token):
    if not _valid(token):
        raise ValueError('Invalid read-access token format. Nothing saved.')
    try:
        result = check_fn(token)
    except Exception:
        raise ValueError('TMDB verification failed. Existing credential unchanged.') from None
    if result.get('status') != 'connected' or result.get('http_status') != 200:
        raise ValueError('TMDB verification did not connect (HTTP 200 required). Existing credential unchanged.')
    folder = Path(directory) / '.watchbible'
    try:
        folder.mkdir(mode=0o700)
    except FileExistsError:
        pass
    _metadata(folder.lstat(), 0o700, directory=True)
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    directory_fd = os.open(str(folder), flags)
    temporary = None
    try:
        _metadata(os.fstat(directory_fd), 0o700, directory=True)
        try:
            _metadata(os.stat('tmdb-read-access-token', dir_fd=directory_fd, follow_symlinks=False), 0o600)
        except FileNotFoundError:
            pass
        fd, temporary = tempfile.mkstemp(prefix='.token-', dir=str(folder))
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, 'wb') as stream:
                stream.write((token + '\n').encode('utf-8'))
                stream.flush()
                os.fsync(stream.fileno())
            current = folder.lstat()
            opened = os.fstat(directory_fd)
            _metadata(current, 0o700, directory=True)
            if (current.st_dev, current.st_ino) != (opened.st_dev, opened.st_ino):
                raise ValueError('Unsafe local credential directory. Nothing saved.')
            os.replace(Path(temporary).name, 'tmdb-read-access-token',
                       src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
            temporary = None
            try:
                os.fsync(directory_fd)
            except OSError:
                raise CredentialDurabilityError('Credential replaced; durability unconfirmed.') from None
        finally:
            if temporary is not None:
                os.unlink(Path(temporary).name, dir_fd=directory_fd)
    finally:
        os.close(directory_fd)


def main(argv=None, *, directory=ROOT, input_fn=None, check_fn=check_token, stdin=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv:
        print('No arguments accepted. Never pass a token on the command line.')
        return 1
    if not (sys.stdin if stdin is None else stdin).isatty():
        print('Run this setup privately in an interactive Terminal. Nothing saved.')
        return 1
    print('Enter the TMDB API READ ACCESS TOKEN, NOT your Mac password or 32-character API key.')
    print('No Bearer prefix, quotes, spaces, or line breaks. Entry is hidden.')
    print('This saves plaintext only in project .watchbible with owner-only permissions.')
    try:
        token = (getpass.getpass if input_fn is None else input_fn)('TMDB read-access token (hidden): ')
        save_token(token, directory=directory, check_fn=check_fn)
    except (EOFError, KeyboardInterrupt):
        print('\nSetup interrupted. Check the existing configuration before retrying; no token displayed.')
        return 1
    except CredentialDurabilityError:
        print('Credential file replaced, but disk durability could not be confirmed. Test the connection before relying on it; rerun setup if needed. No token displayed.')
        return 1
    except Exception:
        print('Setup failed. Check token validity, connection and local permissions before retrying. No token displayed.')
        return 1
    print('Local token setup completed (TMDB HTTP 200). Start with: /bin/zsh start-watchbible.zsh')
    return 0


if __name__ == '__main__':
    sys.exit(main())
