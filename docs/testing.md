# Testing watchbible

## Offline command checks

Run `npm run verify` from the project folder. It runs the Node tests, module syntax checks, Python helper tests, zsh syntax and publication guard. Individual commands are `npm test`, `npm run check` and `npm run test:python`.

No package installation is needed. Tests use synthetic provider responses, fake credentials and isolated files. They must not depend on an existing `.watchbible/`, an author's HOME, generated `artifacts/` contents, or a working provider connection. Temporary directories belong inside the project and must be cleaned by the test that created them. Node tests which launch a nested `node --test` runner must remove inherited `NODE_TEST_CONTEXT` and assert that tests actually ran—otherwise Node can skip the child suite with a successful exit.

The normal Node command does **not** run the browser-only check modules. Syntax checking is not linting, an accessibility audit, or proof that a rendered interaction works. No third-party linter or browser package is installed.

## Synthetic browser verification

Start the explicitly fake QA server:

```sh
npm run qa
```

Use **http://127.0.0.1:8767/** in a disposable browser profile. Never substitute the real 8766 origin in checks that write fixture history. Synthetic catalogue names and provider badges are not live search results. Stop the QA server with Control-C afterwards.

The following commands run in that test page's browser developer console:

| Page | Check |
| --- | --- |
| Any QA page | `await (await import('./watch-picker-checks.mjs')).checkWatchPicker()` (isolated in-memory chooser fixtures) |
| Any QA page | `await (await import('./title-page-checks.mjs')).checkTitlePreferences()` (in-memory Like/star actions, failure rollback and recovery) |
| `title.html?format=series&id=2010` | `await (await import('./title-page-checks.mjs')).checkTitlePage()` |
| Any QA page | `await (await import('./cover-navigation-checks.mjs')).checkCoverNavigation()` |
| `title.html?format=series&id=2010` | `await (await import('./tv-browser-checks.mjs')).checkTVBrowser()` |
| `library.html` | `await (await import('./discovery-browser-checks.mjs')).checkLibraryFlow()` |
| `library.html` | `await (await import('./discovery-browser-checks.mjs')).checkLibraryPreferences()` (synthetic Add likes, unsaved/cancelled ratings, existing-title preservation) |
| `library.html` | `await (await import('./cover-navigation-checks.mjs')).checkLibraryEditControl()` |
| `collections.html` | `await (await import('./collection-ui-checks.mjs')).checkCollectionsOverview()` |
| `collections.html?collection=mcu-phase-one` | `await (await import('./collection-ui-checks.mjs')).checkCollectionDetail()` |
| `collections.html?collection=harry-potter` | `await (await import('./collection-ui-checks.mjs')).checkHarryPotter()` |
| `import.html` | `await (await import('./discovery-browser-checks.mjs')).checkDraftPersistence()` |
| `setup.html` | `await (await import('./discovery-browser-checks.mjs')).checkDataTools()` |

Check every returned boolean/result rather than assuming a fulfilled promise means every assertion passed. Some suites return a boolean plus check records; others return a count and throw on failure.

On fresh QA storage, `checkOnboardingSurface()` from `discovery-flow-checks.mjs` stages three synthetic choices. Clicking Finish then enables `checkHomeFlow()` on the redirected homepage. Reload the QA homepage before `checkHomePagination()` from `home-pagination-checks.mjs`; the pagination suite expects the fixture provider's five real fixture page numbers. Restore/reset **only the disposable test origin** between incompatible suites. Never clear a real diary to make a test pass.

Older `browser-checks.mjs`, `gui-checks.mjs` and some minimal-interface checks reflect historical milestones. They are retained source, not substitutes for the current persistent/title-page browser suites.

## Manual acceptance checks

Use desktop and 390px widths; verify the actual viewport after navigating, since an automation harness may reset it. Check:

- Cover link → correct title format/ID → full details → TV season/episode list on the same page → Back.
- Watch later, Watched, Like and episode corrections remain distinct; refresh/navigation retain only explicit choices.
- A full season completes from episode evidence; empty/upcoming/unknown rosters never falsely complete.
- Home pages replace cards, scroll to the top, retain query/filter and exclude saved/dismissed identities after refresh.
- What to watch shows one suggestion, Pick another does not repeat within the filter session, and format/genre overrides do not change saved preferences. Cover/View details use the same identity; close/Escape restores focus. Opening, filtering and skipping must leave the For you page and viewing history unchanged.
- Random picker requests learn real discovery/related page totals and then sample unvisited valid pages independently; explicit Likes supply its related-title seeds. Use an injected random source for deterministic fixtures, not a flaky assertion that two independent real draws can never coincide. Keep ordinary For you pagination discovery-only.
- Add likes can save a new untracked title or update an existing one without duplicate entries or changing its watched state/manual Anime tag/old rating. Likes and ratings do not grant watched XP.
- Five native radio stars and Clear work by keyboard, survive reload/backup restore, remain independent of Like/status/IMDb, and roll back on storage failure. Library form stars stay unsaved until confirmation; cancelling discards them. Legacy unscaled scores retain their original value and scale.
- Long titles/actions fit without clipping or split labels; keyboard focus and 44px targets remain; selected Like fills its heart.
- Failed API requests show retry rather than invented data; storage denial/quota/corrupt backup paths preserve prior data.
- JSON export/restore requires review and confirmation; unmatched TXT drafts cannot become library history.

## Live checks

Real TMDB verification is separate and private. Use the normal 8766 server with your own token entered through setup, never in test source. Test connection, inspect a real movie/TV result and change seasons without marking test content as your viewing history. Inspect API status/public metadata only; never print credentials or raw request headers. A fake provider success is not proof of live authentication or availability.

## CI and reporting

The GitHub workflow targets the configured macOS/Node matrix and requires no real credential. Remote CI status is unknown until GitHub actually runs it. Report the exact commands, runtime versions and failures/limitations; no test suite can guarantee a perfect or bug-free application.
