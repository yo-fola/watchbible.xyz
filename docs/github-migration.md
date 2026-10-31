# Preparing the first GitHub migration

This checklist prepares the source; it does not create a repository, make a commit, push files or deploy the application.

## Before starting

- Export your diary in Settings and keep that backup somewhere private outside the future repository's publishable files. GitHub source control is not a diary backup or synchronisation service.
- Keep `.watchbible/` private. Do not copy its contents into a new folder or upload it through GitHub's web interface.
- Use a fresh source checkout/copy—not a ZIP of the entire development workspace. `.gitignore` does not protect manual ZIP uploads or arbitrary file attachments.
- Decide repository visibility and a license. A public repository is not automatically open-source; no license has been chosen here.

## Checks

From the project folder:

```sh
npm run verify
```

This includes the publication guard. It excludes credentials, private development notes/handoffs, original personal import notes, generated evidence, caches and source backups. Public examples use fictional names instead. Nothing needs to be deleted from your local working folder to achieve that separation.

The guard may create disposable Git metadata inside ignored test artifacts to verify actual ignore semantics before the project is a Git repository. It does not initialise or stage the project itself. Secret scanning is pattern-based, not a guarantee; inspect what you intend to commit.

## When you choose to create the repository

Perform repository creation and the first commit deliberately. After initialising Git locally, inspect the candidate files **before** staging, then inspect the staged diff before committing. Useful read-only checks once the repository exists:

```sh
git status --short --ignored
node scripts/repository-check.mjs
git diff --cached --stat
git diff --cached
```

Do not paste an unredacted diff into chat if it contains a credential. A detected secret must be removed from publication and rotated if it has already been exposed. Do not rely on `.gitignore` to remove a previously tracked file.

The guard inspects working-tree files, not old staged blobs or commit history. Always inspect the **actual staged diff**: editing a secret out of a file does not automatically replace an earlier staged copy.

The GitHub Actions workflow is configured to run offline verification on the supported macOS/Node matrix. Its first real result can only be known after the repository has been pushed. No GitHub account, remote, repository name, release or deployment URL is configured by this checklist.

## Running after a clone

Follow the README requirements and one-time hidden token setup. Use `npm start` to run the private local Node API. There is no build or npm dependency installation step. Restore your diary manually in the intended browser/origin after reviewing the restore preview; never publish that backup.

If moving between machines, browser history does not follow the Git repository. A responsive page is not cross-device storage. Keep deployment/account/synchronisation work as a separate project milestone.
