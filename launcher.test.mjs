import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, writeFile, mkdir, chmod, copyFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const synthetic = 'synthetic-local-token-NOT-REAL';
async function fixture(t, seed = true) {
  const dir = await mkdtemp(join(root, '.launcher-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // Exercise the legacy fallback without depending on the author's installation
  // or reading another user's HOME. The executable is this test's own Node.
  const home = join(dir, 'isolated-home');
  const runtime = join(home, '.hermes', 'tools', 'node-26.12.1-darwin-arm64', 'bin');
  await mkdir(runtime, { recursive: true });
  await symlink(process.execPath, join(runtime, 'node'));
  for (const name of ['start-watchbible.zsh', 'local-credentials.mjs']) await copyFile(join(root, name), join(dir, name));
  await writeFile(join(dir, 'server.mjs'), `import { loadServerToken } from './local-credentials.mjs';
try {
  const {token, source} = await loadServerToken();
  if (token !== process.env.EXPECTED_TOKEN) throw new Error('fixture mismatch');
  if (source === 'local_file' && process.env.TMDB_READ_ACCESS_TOKEN) throw new Error('unexpected export');
  console.log('fixture server started: ' + source);
} catch { console.error('Credential unavailable'); process.exitCode = 1; }
`);
  if (seed) {
    await mkdir(join(dir, '.watchbible'), { mode: 0o700 });
    await writeFile(join(dir, '.watchbible', 'tmdb-read-access-token'), synthetic + '\n', { mode: 0o600 });
  }
  return { dir, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, EXPECTED_TOKEN: synthetic } };
}
async function run(fixture, extraEnv = {}, flags = []) {
  const child = spawn('/bin/zsh', [...flags, join(fixture.dir, 'start-watchbible.zsh')], {
    env: { ...fixture.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const [code] = await once(child, 'close');
  return { code, output };
}
test('restricted normal Mac PATH resolves Node and loads only the copied fixture local file', async t => {
  const result = await run(await fixture(t));
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /fixture server started: local_file/);
  assert.ok(!result.output.includes(synthetic));
});
test('explicit environment wins without needing a local file', async t => {
  const result = await run(await fixture(t, false), { TMDB_READ_ACCESS_TOKEN: synthetic });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /environment/);
  assert.ok(!result.output.includes(synthetic));
});
test('missing local file gives setup instruction without prompting or starting', async t => {
  const result = await run(await fixture(t, false));
  assert.equal(result.code, 1);
  assert.match(result.output, /\/bin\/zsh setup-watchbible-token.zsh/);
  assert.ok(!result.output.includes('fixture server started'));
});
test('unsafe permissions fail without credential output', async t => {
  const f = await fixture(t);
  await chmod(join(f.dir, '.watchbible', 'tmdb-read-access-token'), 0o644);
  const result = await run(f);
  assert.equal(result.code, 1);
  assert.ok(!result.output.includes(synthetic));
});
test('shell tracing cannot expose either credential source', async t => {
  const f = await fixture(t);
  for (const env of [{}, { TMDB_READ_ACCESS_TOKEN: synthetic }]) {
    const result = await run(f, env, ['-x', '-v']);
    assert.equal(result.code, 0, result.output);
    assert.ok(!result.output.includes(synthetic));
  }
});
test('unavailable explicit Node gives a clear failure', async t => {
  const f = await fixture(t);
  const result = await run(f, { WATCHBIBLE_NODE: join(f.dir, 'missing-node') });
  assert.equal(result.code, 1);
  assert.match(result.output, /Node runtime unavailable/);
});
test('setup refuses noninteractive use and never invokes Keychain', async t => {
  const f = await fixture(t, false);
  await copyFile(join(root, 'setup-watchbible-token.zsh'), join(f.dir, 'start-watchbible.zsh'));
  const result = await run(f);
  assert.equal(result.code, 1);
  assert.match(result.output, /interactive Terminal/);
  for (const name of ['start-watchbible.zsh', 'setup-watchbible-token.zsh']) {
    const text = await readFile(join(root, name), 'utf8');
    assert.ok(!text.includes('/usr/bin/security'));
    assert.ok(!text.includes('read -r -s'));
  }
});