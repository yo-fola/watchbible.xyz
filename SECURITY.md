# Security policy and limits

## Supported boundary

watchbible is a macOS-first **loopback-only development app** for a trusted local user. It has no authentication system or public-hosting security model. Do not bind it to a public interface, expose it through a tunnel/reverse proxy or deploy it to GitHub Pages expecting a working private API. Public deployment requires a separate security design.

The server uses an explicit public-file allowlist, checks local hosts/origins and keeps the TMDB bearer credential server-side. Catalogue requests use validation, sanitised errors, timeouts and bounded caches/rate windows. These controls reduce risk; they do not make a compromised OS account or malicious local application safe.

## Credentials

- Setup accepts the token at a hidden interactive prompt, validates it with TMDB and saves atomically to `.watchbible/tmdb-read-access-token`.
- Directory `0700` and file `0600` restrict ordinary other-user access. Unsafe modes/ownership and symlinks are rejected.
- **The file is plaintext.** The same OS user or an administrator can access it. It is not an encrypted vault.
- An explicit environment override takes precedence and may have its own OS-level inspection risks.
- Do not put tokens in source, command arguments, browser code, GitHub secrets for offline tests, issue reports, shared backups or screenshots. The separate API key is unused.
- The private folder and local files must remain ignored by Git. Ignoring a file does not remove an earlier commit or revoke a leaked credential.

If a credential is exposed, revoke/rotate it with the provider first. Then replace it privately using setup and review any repository/history exposure. Do not paste a leaked token into an issue while asking for help.

## Personal data

Diary data lives in browser-local storage, not an encrypted database. Anyone with access to that browser profile may access it. Use the same browser/origin and export backups intentionally. Exports, source notes, profile names, screenshots and debug artifacts may reveal private viewing history; do not publish them.

Synthetic fixtures must remain separate from real history. Automated checks must not authenticate with the user's real token or modify live viewing records.

## Publication guard

The local repository check validates protective ignore rules and inspects candidate publishable files for known credential patterns. It reports locations/categories, not secret values. Review its findings before publishing. Pattern scanning has false negatives and is not a penetration test, certification or guarantee of security. Review staged changes and enable appropriate repository secret-scanning features after creating the repository.

The scan reads current **working-tree bytes**, not earlier staged blob contents or commit history, and does not unpack archives or decrypt content. If you staged a secret and then edited the file, a clean working-tree scan is not enough: review and update the index before committing. The guard rejects ignored private paths that are already tracked, but cannot revoke or remove a past exposure.

## Reporting a vulnerability

Do **not** open a public issue with credentials, diary exports or exploitable private details. Once a repository exists, use its private vulnerability reporting facility if enabled, or contact the maintainer through a private channel they explicitly publish. No private-report endpoint is configured by this local preparation work.

Provide a minimal synthetic reproduction, affected version/files, impact and suggested mitigation without real secrets or personal data. Treat older versions as unsupported development snapshots until a release/support policy is adopted.
