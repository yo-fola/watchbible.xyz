import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The child runs only inside a fresh synthetic fixture, never the real token directory.
test('actual server entry loads the private local token without serving or printing it', async t => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  await mkdir(join(root, 'artifacts'), { recursive: true });
  const directory = await mkdtemp(join(root, 'artifacts', 'credential-startup-'));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    await rm(directory, { recursive: true, force: true });
  });
  for (const name of ['server.mjs', 'tmdb.mjs', 'local-credentials.mjs']) await copyFile(join(root, name), join(directory, name));
  await mkdir(join(directory, '.watchbible'), { mode: 0o700 });
  const synthetic = 'synthetic-local-startup-token';
  await writeFile(join(directory, '.watchbible', 'tmdb-read-access-token'), synthetic + '\n', { mode: 0o600 });
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  child = spawn(process.execPath, ['server.mjs'], { cwd: directory, env: { ...process.env, PORT: String(port), TMDB_READ_ACCESS_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const base = `http://127.0.0.1:${port}`;
  let status;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { status = await (await fetch(base + '/api/status')).json(); break; } catch { await new Promise(resolve => setTimeout(resolve, 25)); }
  }
  assert.ok(status, 'fixture server started');
  assert.equal(status.configured, true, 'server loaded the local file without an environment token');
  assert.equal(status.state, 'untested', 'configured does not falsely mean authenticated');
  for (const path of ['/local-credentials.mjs', '/.watchbible/tmdb-read-access-token', '/setup_local_token.py']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.ok(!output.includes(synthetic), 'credential never enters startup output');
});
