import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createWatchbibleServer } from './server.mjs';

test('For you exposes a separate What to watch modal without replacing discovery', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /<button[^>]*id="what-to-watch"[^>]*>[^<]*What to watch/);
  assert.match(html, /<dialog[^>]*id="watch-picker"[^>]*aria-labelledby="watch-picker-heading"/);
  for (const id of ['watch-picker-heading', 'watch-picker-format', 'watch-picker-genre', 'watch-picker-result', 'watch-picker-status', 'watch-picker-next', 'watch-picker-retry', 'watch-picker-close', 'watch-picker-apply', 'home-grid', 'home-pagination']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.match(html, />Pick another</);
  assert.match(html, />Optional filters</);
  assert.match(html, /<h1[^>]*>For you<\/h1>/);
});

test('What to watch serves its browser modules without exposing credentials or tests', async t => {
  const server = createWatchbibleServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const file of ['watch-picker.mjs', 'watch-picker-checks.mjs']) {
    const response = await fetch(`${base}/${file}`);
    assert.equal(response.status, 200, file);
    assert.match(response.headers.get('content-type'), /text\/javascript/);
  }
  for (const file of ['watch-picker.test.mjs', 'local-credentials.mjs', '.watchbible/tmdb-read-access-token']) assert.equal((await fetch(`${base}/${file}`)).status, 404, file);
});

test('homepage connects the picker to the existing store and real candidate loader', async () => {
  const home = await readFile(new URL('./home.mjs', import.meta.url), 'utf8');
  assert.match(home, /import \{ mountWatchPicker \} from '\.\/watch-picker.mjs'/);
  assert.match(home, /opener: \$\('what-to-watch'\)/);
  assert.match(home, /store: appStore, loadBatch: loadCandidateBatch/);
});
