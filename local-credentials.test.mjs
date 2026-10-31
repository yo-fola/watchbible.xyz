import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('.', import.meta.url));
async function fixture(t) {
  const directory = await mkdtemp(join(root, '.credential-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, '.watchbible'), { mode: 0o700 });
  const file = join(directory, '.watchbible', 'tmdb-read-access-token');
  await writeFile(file, 'synthetic-local-token\n', { mode: 0o600 });
  return { directory, file };
}
test('loads private local file without exporting it', async t => {
  const { loadServerToken } = await import('./local-credentials.mjs');
  const { directory } = await fixture(t);
  const env = {};
  assert.deepEqual(await loadServerToken({ directory, env }), { token: 'synthetic-local-token', source: 'local_file' });
  assert.deepEqual(env, {});
});

test('environment override wins even when local permissions are unsafe', async t => {
  const { loadServerToken } = await import('./local-credentials.mjs');
  const { directory, file } = await fixture(t);
  await chmod(file, 0o644);
  assert.deepEqual(await loadServerToken({ directory, env: { TMDB_READ_ACCESS_TOKEN: 'synthetic-override' } }),
    { token: 'synthetic-override', source: 'environment' });
});
test('rejects a different owner UID without reading a credential', async t => {
  const { loadServerToken } = await import('./local-credentials.mjs');
  const { directory } = await fixture(t);
  const getuid = process.getuid;
  process.getuid = () => -1;
  try {
    await assert.rejects(loadServerToken({ directory, env: {} }), /unsafe permissions/);
  } finally {
    process.getuid = getuid;
  }
});
test('missing and empty files return missing rather than configured', async t => {
  const { loadServerToken } = await import('./local-credentials.mjs');
  const { directory, file } = await fixture(t);
  for (const value of ['', '\n']) {
    await writeFile(file, value);
    assert.deepEqual(await loadServerToken({ directory, env: {} }), { token: '', source: 'missing' });
  }
  await rm(file);
  assert.deepEqual(await loadServerToken({ directory, env: {} }), { token: '', source: 'missing' });
});
for (const value of [' bad', 'bad ', 'bad\ntoken', 'Bearer-secret', 'a'.repeat(32), '"quoted"', 'bad\r\n', 'bad\n\n', 'a'.repeat(8193), 'bad\u0000token', 'bad☃token']) {
  test('rejects invalid token input without reflecting its value: ' + JSON.stringify(value.slice(0, 16)), async t => {
    const { loadServerToken } = await import('./local-credentials.mjs');
    const { directory, file } = await fixture(t);
    await writeFile(file, value);
    for (const env of [{}, { TMDB_READ_ACCESS_TOKEN: value }]) {
      await assert.rejects(loadServerToken({ directory, env }), error => {
        assert.match(error.message, /invalid format or unsafe permissions/);
        assert.ok(!error.message.includes(value));
        return true;
      });
    }
  });
}
for (const target of ['directory', 'file']) {
  test(`rejects unsafe ${target} permissions`, async t => {
    const { loadServerToken } = await import('./local-credentials.mjs');
    const { directory, file } = await fixture(t);
    await chmod(target === 'file' ? file : join(directory, '.watchbible'), 0o755);
    await assert.rejects(loadServerToken({ directory, env: {} }), /unsafe permissions/);
  });
  test(`rejects ${target} symlinks`, async t => {
    const { loadServerToken } = await import('./local-credentials.mjs');
    const { directory, file } = await fixture(t);
    if (target === 'file') {
      await rm(file);
      await writeFile(join(directory, 'fake-token'), 'synthetic-secret', { mode: 0o600 });
      await symlink(join(directory, 'fake-token'), file);
    } else {
      await rm(join(directory, '.watchbible'), { recursive: true });
      await mkdir(join(directory, 'fake-folder'), { mode: 0o700 });
      await symlink(join(directory, 'fake-folder'), join(directory, '.watchbible'));
    }
    await assert.rejects(loadServerToken({ directory, env: {} }), /unsafe permissions/);
  });
}
