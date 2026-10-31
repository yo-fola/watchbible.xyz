"""User-run private diagnostic. Optional dedicated-item read; never saves secrets."""
import getpass
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request


def _request(token):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    request = urllib.request.Request(
        'https://api.themoviedb.org/3/configuration',
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json'},
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=10) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        # Deliberately discard all upstream body text; return status only.
        error.close()
        return error.code, None


def check_token(token, request_fn=_request):
    if (not isinstance(token, str) or not token or token != token.strip()
            or any(character.isspace() for character in token)
            or token.lower().startswith('bearer')
            or re.fullmatch(r'[a-fA-F0-9]{32}', token)
            or token.startswith(('"', "'")) or token.endswith(('"', "'"))):
        return {'status': 'input_error'}
    try:
        code, data = request_fn(token)
        if code == 200 and isinstance(data, dict):
            images = data.get('images')
            if (isinstance(images, dict)
                    and images.get('secure_base_url') == 'https://image.tmdb.org/t/p/'
                    and isinstance(images.get('poster_sizes'), list)
                    and images['poster_sizes']):
                return {'status': 'connected', 'http_status': 200}
        status = {401: 'rejected', 403: 'access_denied', 429: 'rate_limited'}.get(code, 'provider_error')
        return {'status': status, 'http_status': code}
    except Exception:
        return {'status': 'network_error'}


def read_keychain(run=subprocess.run):
    try:
        result = run(['/usr/bin/security', 'find-generic-password', '-a', 'watchbible',
                      '-s', 'watchbible.tmdb-read-access-token', '-w'],
                     capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            return None
        return result.stdout.rstrip('\n') or None
    except Exception:
        return None


def main():
    if not sys.stdin.isatty():
        print('Run this check privately in your own interactive Terminal. No credential read.')
        return 1
    if sys.argv[1:] not in ([], ['--keychain']):
        print('Usage: python3 token_diagnostic.py [--keychain]. Never pass a token as an argument.')
        return 1
    keychain_mode = sys.argv[1:] == ['--keychain']
    if keychain_mode:
        print('Checking only the dedicated watchbible Keychain item; no value will be displayed.')
        token = read_keychain()
        if token is None:
            print('KEYCHAIN UNAVAILABLE. The dedicated item is missing, empty, locked, or access was denied. No credential displayed or changed.')
            return 1
    else:
        print('This check bypasses Keychain and does not save anything.')
        print('Paste the API READ ACCESS TOKEN, not the API key or your Mac password.')
        print('Do not include Bearer, quotation marks, spaces, or line breaks.')
        try:
            token = getpass.getpass('TMDB read-access token (hidden): ')
        except (EOFError, KeyboardInterrupt):
            print('\nCancelled. Nothing saved.')
            return 1
    result = check_token(token)
    token = None
    messages = {
        'connected': 'CONNECTED (HTTP 200). This token works directly; investigate the stored Keychain value/launcher path next.',
        'input_error': 'INPUT ERROR. Use the complete read-access token, not the API key, with no Bearer prefix, quotes, spaces, or line breaks.',
        'rejected': 'REJECTED (HTTP 401). TMDB rejects this directly entered value too; this is not caused by Keychain retrieval.',
        'access_denied': 'ACCESS DENIED (HTTP 403). TMDB refused access; this may be an account/access or provider restriction.',
        'rate_limited': 'RATE LIMITED (HTTP 429). Wait before retrying.',
        'network_error': 'NETWORK ERROR. The direct request failed; this does not prove the token is invalid.',
        'provider_error': 'UNEXPECTED PROVIDER RESPONSE. This does not establish a working connection.',
    }
    if keychain_mode and result['status'] == 'connected':
        print('KEYCHAIN CONNECTED (HTTP 200). The stored item works; investigate the running server or environment override next.')
    elif keychain_mode and result['status'] == 'rejected':
        print('KEYCHAIN REJECTED (HTTP 401). TMDB rejects the stored item; replace it with the value that passed the direct check.')
    else:
        print(('KEYCHAIN ' if keychain_mode else '') + messages[result['status']])
    print('Nothing was written to Keychain or a file. Share only the result message, never the token.')
    return 0 if result['status'] == 'connected' else 1


if __name__ == '__main__':
    sys.exit(main())
