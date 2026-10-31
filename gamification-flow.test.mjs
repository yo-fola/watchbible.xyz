import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createWatchbibleServer } from './server.mjs';
import { checkStaticPages } from './gamification-ui-checks.mjs';

test('Profile and Achievements contain real CSP-safe pages and recovery controls', async () => {
  const result = await checkStaticPages();
  assert.equal(result.passed, 2);
});

test('gamification routes expose every browser dependency but no private application files', async t => {
  const server = createWatchbibleServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const file of ['profile.html', 'achievements.html', 'collections.html', 'gamification.css', 'profile.mjs',
    'achievements.mjs', 'collections.mjs', 'user-menu.mjs', 'gamification-model.mjs', 'collection-definitions.mjs',
    'gamification-ui-checks.mjs', 'collection-ui-checks.mjs']) {
    const response = await fetch(`${base}/${file}`);
    assert.equal(response.status, 200, file);
    assert.match(response.headers.get('content-type'), file.endsWith('.html') ? /text\/html/ : file.endsWith('.css') ? /text\/css/ : /text\/javascript/);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    assert.ok((await response.text()).length > 0, `${file} must not be an empty stub`);
  }
  for (const path of ['/backups/before-gamification-build/app-state.mjs', '/artifacts/verification/gamification-roster-details.json', '/gamification-model.test.mjs', '/gamification-fixture-server.mjs', '/.env', '/server.mjs']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});
