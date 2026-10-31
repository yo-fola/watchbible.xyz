import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createWatchbibleServer } from './server.mjs';
const TOKEN = 'synthetic-tv-token';
const show = { id: 123, name: 'Synthetic TV', seasons: [{ id: 91, season_number: 0, name: 'Specials', episode_count: 1 }] };
const detail = { id: 91, season_number: 0, name: 'Specials', episodes: [{ id: 801, show_id: 123, season_number: 0, episode_number: 1, name: 'Synthetic special' }] };
async function withServer(options, run) {
  const server = createWatchbibleServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const raw = (base, path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const request = httpRequest(`${base}${path}`, { method, headers }, response => {
    let text = '';
    response.on('data', chunk => { text += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
  });
  request.on('error', reject);
  request.end(body);
});

test('season series IDs reject trailing line terminators rather than normalizing them', async () => {
  let calls = 0;
  await withServer({ token: TOKEN, fetchImpl: async url => { calls++; return Response.json(url.includes('/season/') ? detail : show); } }, async base => {
    assert.equal((await fetch(`${base}/api/season?seriesId=123%0A&season=0`)).status, 400);
  });
  assert.equal(calls, 0);
});

test('season API uses normalized response, shared cache and security headers without exposing secrets', async () => {
  const calls = [];
  await withServer({ token: TOKEN, fetchImpl: async url => { calls.push(new URL(url).pathname); return Response.json(url.includes('/season/') ? detail : show); } }, async base => {
    const first = await fetch(`${base}/api/season?seriesId=123&season=0`);
    assert.equal(first.status, 200);
    const result = await first.json();
    assert.equal(result.catalogueId, 'tmdb:series:123');
    assert.equal(result.episodes[0].episodeId, 801);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
    assert.match(first.headers.get('content-security-policy'), /default-src 'self'/);
    assert.ok(!JSON.stringify(result).includes(TOKEN));
    assert.equal((await fetch(`${base}/api/season?season=0&seriesId=123`)).status, 200);
    assert.deepEqual(calls, ['/3/tv/123', '/3/tv/123/season/0']);
  });
});

test('season API rejects noncanonical query, duplicate keys, bodies, methods and cross-site traffic before upstream', async () => {
  let calls = 0;
  await withServer({ token: TOKEN, fetchImpl: () => { calls++; throw new Error('private'); } }, async base => {
    for (const query of ['', '?seriesId=123', '?seriesId=123&season=00', '?seriesId=123&season=-1', '?seriesId=0123&season=0', '?seriesId=123&season=1.5', '?seriesId=123&season=0&season=1', '?seriesId=123&seriesId=123&season=0', '?seriesId=123&season=0&format=series', '?seriesId=9007199254740992&season=0', '?seriesId=123&season=0%0A']) assert.equal((await fetch(`${base}/api/season${query}`)).status, 400, query);
    for (const method of ['POST', 'PUT', 'HEAD', 'DELETE']) assert.equal((await fetch(`${base}/api/season?seriesId=123&season=0`, { method })).status, 405);
    assert.equal((await raw(base, '/api/season?seriesId=123&season=0', { headers: { 'Content-Length': '1' }, body: 'x' })).status, 400);
    assert.equal((await raw(base, '/api/season?seriesId=123&season=0', { headers: { Host: 'evil.test' } })).status, 403);
    assert.equal((await fetch(`${base}/api/season?seriesId=123&season=0`, { headers: { Origin: 'https://evil.test' } })).status, 403);
    assert.equal((await fetch(`${base}/api/season?seriesId=123&season=0`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  });
  assert.equal(calls, 0);
});

test('season API preserves missing credential, safe provider failures and retryability', async () => {
  await withServer({}, async base => assert.equal((await fetch(`${base}/api/season?seriesId=123&season=0`)).status, 503));
  let calls = 0;
  await withServer({ token: TOKEN, fetchImpl: async () => { calls++; return new Response(`private ${TOKEN}`, { status: 401 }); } }, async base => {
    for (let index = 0; index < 2; index++) {
      const response = await fetch(`${base}/api/season?seriesId=123&season=0`);
      assert.equal(response.status, 401);
      assert.ok(!/private|synthetic-tv-token/.test(await response.text()));
    }
    assert.equal((await (await fetch(`${base}/api/status`)).json()).state, 'failed');
  });
  assert.equal(calls, 2);
});

test('season API shares the catalogue rate window and keeps server modules private', async () => {
  let calls = 0;
  await withServer({ token: TOKEN, fetchImpl: async () => { calls++; return new Response('private', { status: 404 }); } }, async base => {
    for (let index = 0; index < 80; index++) assert.equal((await fetch(`${base}/api/season?seriesId=123&season=0`)).status, 404);
    assert.equal((await fetch(`${base}/api/season?seriesId=123&season=0`)).status, 429);
    assert.equal((await fetch(`${base}/api/genres`)).status, 429);
    assert.equal((await fetch(`${base}/catalogue-service.mjs`)).status, 404);
    assert.equal((await fetch(`${base}/server.mjs`)).status, 404);
  });
  assert.equal(calls, 80);
});
