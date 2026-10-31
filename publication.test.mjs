import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createWatchbibleServer } from './server.mjs';
import { parseTitleList } from './importer.mjs';

test('public import example is synthetic and personal notes are not served', async t => {
  const server = createWatchbibleServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/examples/sample-import.txt');
  assert.equal(response.status, 200);
  const entries = parseTitleList(await response.text());
  assert.equal(entries.length, 8);
  assert.ok(entries.every(entry => entry.title.startsWith('Example ')), 'fictional examples are not personal watch history');
  assert.ok(entries.some(entry => entry.status === 'watched'));
  assert.ok(entries.some(entry => entry.status === 'plan_to_watch'));
  assert.ok(entries.some(entry => entry.status === null));
  for (const path of ['/examples/notes-import.txt', '/HANDOFF.md', '/AGENTS.md']) assert.equal((await fetch(base + path)).status, 404, path);
});
