# watchbible

A local-first movie and TV diary with catalogue discovery, episode tracking, and collection progress. Built with HTML, CSS, JavaScript modules, and a small Node.js server—no application framework or third-party runtime dependencies.

**Development build, macOS first.** This is a loopback-only personal app, not a public hosting server. GitHub stores the source; it does not automatically host the Node API or synchronise your diary.

## What works

- **For you:** real TMDB discovery and related titles, numbered pages, previous/next, refresh, and exclusion of saved or dismissed identities.
- **What to watch:** an independent random catalogue sample, with selection biased toward explicitly liked titles rather than simply choosing the next For you card. Includes a reason, Pick another, View details and optional Movie/Series/genre filters. Picks do not repeat within a filter session or change saved preferences/history. Saved, dismissed and adult identities remain excluded; no preference signal is honestly labelled Popular picks. This is bounded sampling, not uniform access to every title in TMDB or a guarantee of no overlap with For you.
- **Likes and personal stars:** Add likes searches movies/series to steer random picks; homepage hearts and the Library's Liked filter make taste explicit. Set or clear a separate **1–5-star personal rating** on title pages or in Library Add/Edit. Liking/rating alone does not invent viewing status, mark a title watched or earn watched XP.
- **Library:** independent watching status and Like, search/filter/sort, grid/list, and explicit title editing. Anime is a category, not a separate movie/TV format.
- **Title pages:** larger artwork/backdrop, synopsis, genres, runtime or TV counts, regional watch options, and labelled colour-coded actions.
- **TV:** season selection, episode artwork and summaries, Watched/Currently watching/correction controls, and completion derived from individual episode records.
- **Collections and achievements:** bounded MCU Phase One and eight-film Harry Potter sets, follow without adding history, progress, local profile, and movie-only XP.
- **Data tools:** browser-local persistence, validated JSON export/restore and safe older-schema migration.
- **TXT review:** automatic checkbox parsing and editable suggestions. The fictional public sample is `examples/sample-import.txt`.

### Intentionally unfinished

IMDb ratings are **not connected**, and TMDB scores are not substituted. Final TXT catalogue matching/import, cloud accounts, cross-device synchronisation, TV XP and public deployment are not implemented. TXT drafts are not confirmed library history.

## Requirements

- macOS with `/bin/zsh` and Python 3.9 or newer.
- Node.js 24 or newer, with npm, available on your Terminal PATH. There are no npm packages to install.
- A current browser with JavaScript modules and local storage.
- Your own TMDB **API Read Access Token** for live catalogue features. The separate API key is not required.

The CI configuration targets macOS and Node 24/26. Local verification and the remote CI run are separate: a committed workflow is not proof that GitHub has executed it. Windows and Linux are not currently supported release targets.

## Run locally

Open a Terminal **inside the project folder**.

### 1. One-time private credential setup

```sh
/bin/zsh setup-watchbible-token.zsh
```

Copy the command unchanged. Paste the actual token **only** at `TMDB read-access token (hidden):`. This is not your Mac password. Setup verifies the token with TMDB before saving; a failed check does not replace the previous token.

### 2. Start the app

```sh
npm start
```

Alternatively, use `/bin/zsh start-watchbible.zsh`. That launcher can also use an explicitly configured `WATCHBIBLE_NODE` executable when Node is not on your ordinary PATH.

Open **http://127.0.0.1:8766/**. Settings has a **Test connection** control. Stop the server with **Control-C**. Normal restarts do not ask for the token again. Without credentials, the server can show the interface, but live catalogue requests remain unavailable rather than returning fake results.

If an old environment override causes credential rejection, `env -u TMDB_READ_ACCESS_TOKEN /bin/zsh start-watchbible.zsh` starts from the saved local file. Never put the actual token into that command.

### Credential safety

The private file is `.watchbible/tmdb-read-access-token`, with directory mode `0700` and file mode `0600`. The server rejects unsafe ownership, permissions, symlinks and invalid formats. It reads the credential internally; browser code and responses never receive it. An explicitly supplied `TMDB_READ_ACCESS_TOKEN` environment value takes precedence.

**This is plaintext, not encryption.** Software running as your OS user or an administrator may still read it. Keep it out of Git, screenshots, logs, shared backups, exports and issue reports. Keychain is not used. See [SECURITY.md](SECURITY.md).

## Your data

History, likes, episode evidence, preferences and review drafts live in the browser under a validated schema. There is no account or server-side diary database.

- Keep the **same browser and origin**: `localhost`, `127.0.0.1`, different ports and different browsers have separate storage.
- Use one editing tab and export backups regularly.
- Clearing browser data may remove your diary. Moving the code to GitHub does not back it up.
- Export in Settings before changing how or where you run the app; restore intentionally after reviewing the preview.
- Exported diary files contain personal viewing data. Do not commit them.

Schema v4 adds **Not tracked** for titles saved only as a Like or personal rating. Older valid backups migrate in memory without an automatic write. New ratings store an explicit five-point scale; any older unscaled 0–10 personal score is preserved and displayed divided by two, not silently reinterpreted or rounded. Only an explicit rating edit replaces that original score. Refresh older open tabs after an application update.

## Verify changes

```sh
npm test
npm run check
npm run test:python
npm run verify
```

`verify` runs the offline checks and repository-publication guard. Automated tests use synthetic data, isolated credential files and fake provider responses; they do not read your real token or call TMDB. Browser interaction checks are a separate layer, not automatically covered by Node's test runner. See [Testing](docs/testing.md).

For a clearly synthetic browser QA server:

```sh
npm run qa
```

Open **http://127.0.0.1:8767/** in a test profile. This uses fake catalogue responses, not live results. Do not use that origin for your real diary. Stop it with Control-C.

## Project layout

| Area | Main files |
| --- | --- |
| Local HTTP/API boundary | `server.mjs`, `tmdb.mjs`, `catalogue-service.mjs` |
| Private credential setup | `setup_local_token.py`, `local-credentials.mjs`, zsh launchers |
| Validated browser data | `app-state.mjs`, `library-actions.mjs`, `episode-progress.mjs` |
| Discovery and library | `home.mjs`, `onboarding.mjs`, `library.mjs` |
| Full title/episode views | `title-page.mjs`, `title-panel.mjs`, `series.mjs` |
| Collections and rewards | `collection-definitions.mjs`, `gamification-model.mjs` |
| Shared presentation | `theme.css`, `film-card.mjs`, `poster.mjs` |
| Verification | `*.test.mjs`, `*_test.py`, browser-check modules, `scripts/` |

There is no compilation or bundling step. Retained legacy style/check files are not the current app entry points. Private development handoffs, historical plans, local evidence and source backups are intentionally excluded from publication, not deleted.

## GitHub preparation

Read the [migration checklist](docs/github-migration.md) before your first commit. The guard checks candidate files against Git ignore rules and known secret patterns, but no scanner guarantees the absence of secrets. Review the staged filenames and diff yourself. A license has not been selected; choose one deliberately before inviting reuse. Package publication is disabled.

The [readiness report](docs/readiness-report.md) records tested optimisations, the clean-source verification and remaining limits. Local checks currently pass 204 Node tests and 15 Python tests; the browser checks, including the What to watch chooser and personal stars, are a separate verification layer, not part of the Node test count.

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Security and local-only limits: [SECURITY.md](SECURITY.md).

## Data attribution

Metadata and artwork are provided by [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB. Preserve the included TMDB attribution/logo when modifying the app. Availability data is attributed to [JustWatch](https://www.justwatch.com/); links use verified upstream watch-options pages, not guessed service URLs. An empty listing is not proof that a title is unavailable.

Review [TMDB's API terms](https://www.themoviedb.org/api-terms-of-use) for your intended use. External metadata, artwork and service marks remain subject to their owners' rights; this repository does not grant a license to them.
