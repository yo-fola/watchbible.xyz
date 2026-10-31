# Contributing

watchbible is a macOS-first, local development app. Keep changes small, understandable and backed by tests. No dependency installation is needed for the current project.

## Development workflow

1. Read the README and security boundaries.
2. Reproduce a defect or write a focused failing test for new behaviour before changing it.
3. Make the smallest appropriate fix; preserve the existing visual design and saved-data schema contracts.
4. Run `npm run verify`. Exercise changed interactions in a browser using `npm run qa` and a disposable test profile.
5. Review the diff and publishable filenames. Report tests actually run and any unverified behaviour.

CI runs on macOS with the configured Node versions. Do not claim a workflow passed until its actual GitHub run has completed. Browser checks are separate from the Node suite; see [Testing](docs/testing.md).

## Data and security rules

- Never commit credentials, diary exports, personal source notes, screenshots of private data, local plans/handoffs, caches or backup folders.
- Do not call the real credential loader or provider in tests. Use synthetic tokens and injected fake responses. Create temporary fixtures within the project and clean only fixtures owned by the test.
- Browsing, searching and following collections must not add watched/liked history without an explicit action.
- Keep movie/series identity namespaces separate. Anime is an independent category.
- Preserve manual tags, likes, personal metadata and episode evidence when refreshing catalogue details.
- Validate entire imports/backups before replacement; failed writes must not partially change history.
- Keep IMDb and personal ratings separate. Do not relabel another provider's score as IMDb or invent missing data.
- Preserve TMDB/JustWatch attribution and safe verified watch links.
- Do not expose the loopback server publicly or weaken host/origin/credential safeguards to simplify a test.

## Design and dependencies

Use the existing CSS tokens and accessible text labels, focus indicators and touch targets. Test desktop and narrow layouts, including long titles and error/recovery states. Prefer native links for navigation and explicit buttons for actions.

Discuss new frameworks, packages, paid services, data providers, authentication and public deployment before adding them. Do not commit generated dependency folders. The current package is private and has no chosen open-source license; do not assume permission to relicense the project or third-party artwork.

## Reporting bugs

Include expected behaviour, reproducible steps, browser/OS versions and whether it occurred on live or synthetic QA data. Remove titles, names and screenshots that reveal private history where not necessary. Never include tokens, private files, raw request headers or full diary exports. See [SECURITY.md](SECURITY.md) for sensitive reports.
