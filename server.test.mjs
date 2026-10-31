import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';

async function running(t, options) {
  const { createWatchbibleServer } = await import('./server.mjs');
  const server = createWatchbibleServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('local server serves the site but not credentials or server source', async t => {
  const base = await running(t, { token: '' });
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(status.configured, false);
  assert.equal(status.state, 'missing');
  const home = await fetch(base);
  assert.match(await home.text(), /watchbible/);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const path of ['/server.mjs', '/tmdb.mjs', '/.env', '/backups/before-tmdb/index.html', '/plans/catalogue.test.mjs.pending']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  assert.equal((await fetch(`${base}/api/tmdb/test`, { method: 'POST' })).status, 503);
  assert.equal((await fetch(`${base}/api/tmdb/test`, { method: 'POST', headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
  // Node fetch rewrites Host; use the raw HTTP client to exercise this boundary.
  const hostStatus = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/status`, { headers: { Host: 'untrusted.invalid' } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(hostStatus, 403);
});

test('configured is distinct from verified and connection results never reveal credentials', async t => {
  let accepted = true;
  const base = await running(t, {
    token: 'synthetic-test-token',
    fetchImpl: async () => accepted
      ? Response.json({ images: { secure_base_url: 'https://image.tmdb.org/t/p/', poster_sizes: ['w500'] } })
      : new Response('private upstream body', { status: 401 }),
  });
  const before = await (await fetch(`${base}/api/status`)).json();
  assert.equal(before.configured, true);
  assert.equal(before.state, 'untested');
  const result = await fetch(`${base}/api/tmdb/test`, { method: 'POST' });
  assert.equal(result.status, 200);
  const text = await result.text();
  assert.ok(!text.includes('synthetic-test-token'));
  assert.equal(JSON.parse(text).status, 'connected');
  const after = await (await fetch(`${base}/api/status`)).json();
  assert.equal(after.state, 'connected');
  assert.ok(after.checkedAt);
  const script = await fetch(`${base}/settings.mjs`);
  assert.equal(script.status, 200);
  const source = await script.text();
  assert.ok(!source.includes('synthetic-test-token'));
  accepted = false;
  const failure = await fetch(`${base}/api/tmdb/test`, { method: 'POST' });
  assert.equal(failure.status, 401);
  assert.ok(!(await failure.text()).includes('private upstream body'));
  assert.equal((await (await fetch(`${base}/api/status`)).json()).state, 'failed');
  assert.equal((await fetch(`${base}/api/tmdb/test`, { method: 'POST', body: 'do-not-send-credentials' })).status, 400);
});

test('search endpoint returns movie and series candidates without exposing the credential', async t => {
  const base = await running(t, {
    token: 'synthetic-test-token',
    fetchImpl: async (url, options) => {
      const target = new URL(url);
      assert.equal(target.pathname, '/3/search/multi');
      assert.equal(target.searchParams.get('query'), 'Fixture');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-test-token');
      return Response.json({ results: [
        { id: 1, media_type: 'movie', title: 'Fixture film', release_date: '2001-01-01', poster_path: null },
        { id: 1, media_type: 'tv', name: 'Fixture series', first_air_date: '2002-01-01', poster_path: '/fixture.jpg' },
        { id: 2, media_type: 'person', name: 'Not a title' },
      ] });
    },
  });
  const response = await fetch(`${base}/api/search?q=Fixture`);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.ok(!body.includes('synthetic-test-token'));
  const data = JSON.parse(body);
  assert.deepEqual(data.results.map(item => item.format), ['movie', 'series']);
  assert.notEqual(data.results[0].catalogueId, data.results[1].catalogueId);
  assert.equal((await (await fetch(`${base}/api/status`)).json()).state, 'connected');
  assert.equal((await fetch(`${base}/api/search?q=%20`)).status, 400);
  assert.equal((await fetch(`${base}/api/search?q=Fixture`, { method: 'POST' })).status, 405);
});

test('unconfigured search refuses external requests', async t => {
  const base = await running(t, { token: '', fetchImpl: async () => { throw new Error('Must not contact TMDB'); } });
  assert.equal((await fetch(`${base}/api/search?q=Fixture`)).status, 503);
});

test('search rejects unexpected parameters, duplicates and bodies before upstream work', async t => {
  let calls = 0;
  const base = await running(t, { token: 'synthetic-test-token', fetchImpl: async () => { calls++; return Response.json({ results: [] }); } });
  for (const path of ['/api/search?q=Fixture&q=Other', '/api/search?q=Fixture&token=synthetic-query', '/api/search?q=Fixture&page=2', '/api/search?query=Fixture', '/api/search']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 400, path);
    assert.ok(!(await response.text()).includes('synthetic-query'));
  }
  const status = await new Promise((resolve, reject) => {
    const req = request(base + '/api/search?q=Fixture', { method: 'GET', headers: { 'Content-Length': '1' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject); req.end('x');
  });
  assert.equal(status, 400);
  assert.equal(calls, 0);
  assert.equal((await fetch(base + '/api/search?q=Fixture')).status, 200);
  assert.equal(calls, 1);
});

test('discovery and details refuse missing credentials without contacting the catalogue', async t => {
  let calls = 0;
  const base = await running(t, { token: '', fetchImpl: async () => { calls += 1; throw new Error('Must not contact TMDB'); } });
  for (const path of ['/api/title?format=movie&id=101&region=NG', '/api/genres', '/api/discover?format=movie&genres=18', '/api/recommendations?format=series&id=101']) {
    assert.equal((await fetch(base + path)).status, 503, path);
    assert.equal((await fetch(base + path, { method: 'POST' })).status, 405);
  }
  assert.equal(calls, 0);
});

test('metadata, genres and discovery routes expose normalised public data, not server internals', async t => {
  let calls = 0;
  const base = await running(t, { token: 'synthetic-test-token', fetchImpl: async url => {
    calls += 1;
    const path = new URL(url).pathname;
    if (path.includes('/genre/')) return Response.json({ genres: [{ id: 18, name: 'Test drama' }] });
    if (path.endsWith('/watch/providers')) return Response.json({ id: 101, results: { NG: { link: 'https://www.themoviedb.org/movie/101/watch?locale=NG', flatrate: [{ provider_id: 1, provider_name: 'Test service', logo_path: null }] } } });
    if (path.endsWith('/movie/101')) return Response.json({ id: 101, title: 'Test film', release_date: '2001-01-01', overview: 'Synthetic synopsis.', genres: [{ id: 18, name: 'Test drama' }], runtime: 90, keywords: { keywords: [] } });
    if (path.includes('/discover/movie')) return Response.json({ page: 1, total_pages: 1, results: [{ id: 101, title: 'Test film', release_date: '2001-01-01', genre_ids: [18], overview: 'Synthetic synopsis.' }] });
    if (path.endsWith('/tv/101/recommendations')) return Response.json({ page: 1, total_pages: 1, results: [{ id: 102, name: 'Test series', first_air_date: '2002-01-01', genre_ids: [18] }] });
    throw new Error('Unexpected fixture URL');
  } });
  const response = await fetch(`${base}/api/title?format=movie&id=101&region=NG`);
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.equal(metadata.catalogueId, 'tmdb:movie:101');
  assert.equal(metadata.genres[0].name, 'Test drama');
  assert.equal(metadata.watch.attribution, 'JustWatch');
  assert.equal(metadata.watch.offers[0].name, 'Test service');
  const before = calls;
  assert.equal((await fetch(`${base}/api/title?format=movie&id=101&region=NG`)).status, 200);
  assert.equal(calls, before, 'public metadata is briefly cached, not refetched per rerender');
  const genres = await (await fetch(`${base}/api/genres`)).json();
  assert.ok(genres.movie.length && genres.series.length);
  const discovered = await (await fetch(`${base}/api/discover?format=movie&genres=18`)).json();
  assert.equal(discovered.results[0].format, 'movie');
  const related = await (await fetch(`${base}/api/recommendations?format=series&id=101`)).json();
  assert.equal(related.results[0].format, 'series');
  for (const path of ['/api/title?format=movie&id=001', '/api/title?format=anime&id=101', '/api/title?format=movie&id=101&region=99', '/api/discover?format=movie&genres=oops', '/api/genres?token=ignored', '/api/title?format=movie&id=101&id=102']) {
    assert.equal((await fetch(base + path)).status, 400, path);
  }
  assert.equal((await fetch(`${base}/catalogue-service.mjs`)).status, 404);
});

test('availability failure is not cached as success, so Retry can recover immediately', async t => {
  let available = false;
  const base = await running(t, { token: 'synthetic-test-token', fetchImpl: async url => {
    if (new URL(url).pathname.endsWith('/watch/providers')) {
      return available ? Response.json({ id: 101, results: {} }) : new Response('Synthetic failure', { status: 502 });
    }
    return Response.json({ id: 101, title: 'Test film', genres: [], keywords: { keywords: [] } });
  } });
  const path = `${base}/api/title?format=movie&id=101&region=NG`;
  assert.equal((await (await fetch(path)).json()).watch.status, 'error');
  available = true;
  assert.equal((await (await fetch(path)).json()).watch.status, 'unlisted');
});
