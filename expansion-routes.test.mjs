import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createWatchbibleServer } from './server.mjs';

test('title, episode and pagination screens expose their public dependencies, never credential helpers', async t => {
  const server = createWatchbibleServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const file of ['series.html', 'series.mjs', 'series.css', 'episode-progress.mjs', 'tv-browser-checks.mjs',
    'home-pagination.css', 'pagination-model.mjs', 'home-pagination-checks.mjs',
    'title.html', 'title-page.mjs', 'title-page.css', 'title-page-checks.mjs', 'cover-navigation-checks.mjs']) {
    const response = await fetch(`${base}/${file}`);
    assert.equal(response.status, 200, file);
    assert.ok((await response.text()).length > 0);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  }
  for (const file of ['setup-watchbible-token.zsh', 'start-watchbible.zsh', 'token_diagnostic.py', 'token_diagnostic_test.py',
    '.watchbible/tmdb-read-access-token', 'local-credentials.mjs', 'setup_local_token.py',
    'plans/keychain-setup.md', 'catalogue-service.mjs', 'backups/before-tv-keychain-20261029-171044/app-state.mjs']) {
    assert.equal((await fetch(`${base}/${file}`)).status, 404, file);
  }
});
