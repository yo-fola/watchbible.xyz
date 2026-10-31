# GitHub readiness and reliability check

## Result

The current source is prepared for a deliberate first GitHub migration. The project itself has **not** been initialised as a Git repository, staged, committed, pushed or publicly deployed. No account or remote is configured by this work.

This is a tested development build, not a guarantee of perfection or production-hosting readiness.

## Publication preparation

- Public README, setup instructions, contribution/security guidance, testing instructions and migration checklist.
- Protective ignore rules for local credentials, diary exports, original personal notes, development handoffs/plans, backups, generated evidence and caches. Local material is retained rather than indiscriminately deleted.
- A fictional public import example instead of publishing personal source notes.
- A dependency-free `package.json`, consistent editor/line-ending configuration and bug-report/pull-request templates.
- A pinned-action GitHub verification workflow for macOS with Node 24/26. It requires no live provider credential or dependency installation.
- A publication guard checking actual ignore semantics, unsafe file paths and known credential patterns without printing matched secret values. It passes with zero findings on current publishable candidates.

The scanner is heuristic and checks working-tree bytes, not previous staged blobs or commit history. Review the actual staged diff before committing. GitHub's remote workflow has not run; local tests cannot claim its result.

## Targeted optimisations and reliability improvements

- Recommendation ranking indexes saved identities and positive seeds once rather than repeatedly scanning the library for every candidate. A regression test exercises 10,000 library entries and 100 candidates while preserving ranking semantics.
- Saving a recommendation rebuilds the grid once, not twice. Browser verification measures the actual DOM replacement and confirms identity exclusion and keyboard focus remain correct.
- Episode commits and title-status commits avoid duplicate rendering. Availability-only retry preserves the selected season and episode DOM instead of re-fetching the episode guide.
- Card posters load lazily; the prominent title poster remains eager. Local Anime presentation edits do not trigger unnecessary catalogue requests.
- Persisted browser Back navigation refreshes saved state, resumes interrupted work and ignores stale responses. Older in-memory state cannot silently overwrite externally changed browser storage.
- Recovery export retains the latest known committed snapshot even if storage later becomes inaccessible. Observer errors do not falsely report that an already-committed transaction failed.
- Credential setup distinguishes replacement from an unconfirmed durability flush, rather than claiming an already-replaced file was unchanged.
- Browser verification found and reproduced a Refresh regression: a newly saved positive seed incorrectly reset the current recommendation page to page one. A new Node regression test and the existing rendered pagination check now pass: explicit Refresh retains the viewed page, uses fresh seeds, invalidates old caches and continues excluding saved titles.

## Executed verification

Environment exercised: macOS, Node **26.12.1**, Python **3.9.6**. Node 24 is configured in the future CI matrix but was not independently run locally.

- `npm run verify`: **173 Node tests and 15 Python tests passed**, alongside JavaScript/zsh syntax checks and publication guardrails.
- The same verifier passed from a clean copy of publishable source with an isolated HOME and no real credential, author-specific files or pre-existing generated artifacts. The temporary final verification copy was removed afterward.
- Browser checks passed for onboarding, recommendation search/actions, numbered pagination/Refresh, title pages, episode tracking, native cover links, Library editing, both collections, profile/achievements, TXT draft review and Settings controls.
- Performance checks verified single-render commits, preserved focus/status, lazy/eager artwork policy and no redundant episode request during availability retry.
- Desktop and 390px title-layout checks passed without horizontal overflow.
- An independent source review found no additional blocking issue within its examined publication, persistence and lifecycle boundaries. That scoped review is not a full security audit or independent certification of every final edit.

Browser actions used synthetic catalogue data and isolated test state. They do not claim that the real user watched or liked any fixture title. Live authentication and third-party availability are separate checks; no actual credential was read for this verification pass. Detailed local evidence/logs remain under ignored development artifacts rather than being published with personal data.

## Before the first push

1. Export your diary privately; GitHub source control does not back up browser history.
2. Choose repository visibility and a license deliberately. No license has been selected; package publication remains disabled.
3. Follow [the migration checklist](github-migration.md), run `npm run verify` again and review staged filenames/content before committing.
4. Do not upload a ZIP of the entire development folder. Git ignore rules do not protect arbitrary ZIP uploads.
5. Check the actual GitHub Actions result after pushing. A configured workflow is not proof of a successful remote run.

The application remains loopback-only and macOS-first. GitHub Pages does not host its private Node API. Cross-device sync, accounts, IMDb integration and final TXT catalogue matching/import remain separate unfinished work.
