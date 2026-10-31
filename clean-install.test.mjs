import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('startup tests work in a clean source folder without author runtime or generated artifacts', async t => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  await mkdir(join(root, 'artifacts'), { recursive: true });
  const directory = await mkdtemp(join(root, 'artifacts', 'clean-install-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['launcher.test.mjs', 'credential-startup.test.mjs', 'server.mjs', 'tmdb.mjs', 'local-credentials.mjs', 'start-watchbible.zsh', 'setup-watchbible-token.zsh']) {
    await copyFile(join(root, name), join(directory, name));
  }
  const home = join(directory, 'empty-home'); await mkdir(home);
  const env = { ...process.env, HOME: home, TMDB_READ_ACCESS_TOKEN: '' };
  delete env.NODE_TEST_CONTEXT; // A nested runner otherwise skips all files with exit 0.
  const result = spawnSync(process.execPath, ['--test', 'launcher.test.mjs', 'credential-startup.test.mjs'], {
    cwd: directory, env, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /(?:#|ℹ) tests 8(?:\n|\r)/, 'the child actually ran all eight startup checks');
});
