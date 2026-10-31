import test from 'node:test';
import assert from 'node:assert/strict';
import * as tmdb from './tmdb.mjs';

// Explicitly synthetic fixtures only; no real authenticated requests or credentials.
const token = 'synthetic-search-test-token';
const movie = (id, extra = {}) => ({ media_type: 'movie', id, title: `Synthetic Movie ${id}`, ...extra });
const series = (id, extra = {}) => ({ media_type: 'tv', id, name: `Synthetic Series ${id}`, ...extra });
const searchFixtures = (results, query = 'synthetic') => tmdb.searchTmdb(query, token, async () => Response.json({ results }));

test('search returns at most six valid unique candidates in upstream order without merging remakes', async () => {
  const fixtures = [
    { media_type: 'person', id: 9, name: 'Synthetic Person' },
    movie(9, { adult: true }), { ...movie(9), media_type: 'unknown' }, null, false, [], 'bad',
    ...[0, -1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1].map(id => movie(id)),
    ...[null, undefined, '', ' \t ', 12, {}].map(title => movie(1, { title })),
    series(9, { name: '' }), { media_type: 'tv', id: 9, title: 'Wrong field' },
    { media_type: 'movie', id: 9, name: 'Wrong field' },
    movie(1, { title: '  Synthetic Shared Title  ', release_date: '2001-01-01' }),
    movie(1, { title: 'Synthetic Duplicate' }),
    series(1),
    movie(2, { title: 'Synthetic Shared Title', release_date: '2001-01-01' }),
    movie(3, { title: 'Synthetic Shared Title', release_date: '2020-01-01' }),
    series(4), movie(5), movie(6),
  ];
  const { results } = await searchFixtures(fixtures);
  assert.deepEqual(results.map(item => item.catalogueId), [
    'tmdb:movie:1', 'tmdb:series:1', 'tmdb:movie:2', 'tmdb:movie:3', 'tmdb:series:4', 'tmdb:movie:5',
  ]);
  assert.equal(results[0].title, 'Synthetic Shared Title');
});

test('search accepts empty or entirely ineligible upstream results', async () => {
  assert.deepEqual(await searchFixtures([]), { results: [] });
  assert.deepEqual(await searchFixtures([{ media_type: 'person', id: 1 }, movie(2, { adult: true })]), { results: [] });
});

test('search accepts only simple safe provider poster filenames and returns null otherwise', async () => {
  for (const path of ['/synthetic.jpg', '/Synthetic_2-film.png', '/synthetic.webp']) {
    const { results } = await searchFixtures([movie(1, { poster_path: path })]);
    assert.equal(results[0].posterUrl, `https://image.tmdb.org/t/p/w500${path}`);
  }
  for (const path of [undefined, null, '', 42, {}, [], 'synthetic.jpg', '//host.jpg', '/nested/file.jpg', '/../file.jpg', '/file%2Fname.jpg', '/file\\name.jpg', '/file.jpg?secret=yes', '/file.jpg#fragment', '/file.svg', '/.jpg', '/file name.jpg', '/file.jpg\n', 'https://example.test/file.jpg']) {
    const { results } = await searchFixtures([movie(1, { poster_path: path })]);
    assert.equal(results[0].posterUrl, null, `Unsafe or absent poster: ${JSON.stringify(path)}`);
  }
});

test('search extracts years only from valid calendar dates in the correct media field', async () => {
  for (const date of [undefined, null, '', 2001, {}, [], '2001', '2001-2-03', '2001-02', '0000-01-01', '2001-00-01', '2001-13-01', '2001-01-00', '2001-04-31', '2001-02-29', '1900-02-29', '2001-01-01junk', '2001-01-01\n']) {
    const { results } = await searchFixtures([
      movie(1, { release_date: date, first_air_date: '1999-01-01' }),
      series(2, { first_air_date: date, release_date: '1999-01-01' }),
    ]);
    assert.deepEqual(results.map(item => item.year), [null, null], `Invalid date: ${JSON.stringify(date)}`);
  }
  for (const date of ['2000-02-29', '2004-02-29', '2001-12-31', '0001-01-01', '2099-01-01']) {
    const { results } = await searchFixtures([movie(1, { release_date: date }), series(2, { first_air_date: date })]);
    assert.deepEqual(results.map(item => item.year), [date.slice(0, 4), date.slice(0, 4)]);
  }
});

test('search maps unsuccessful provider statuses to safe public errors', async () => {
  for (const [upstreamStatus, expectedStatus] of [[401, 401], [403, 401], [429, 429], [400, 502], [404, 502], [500, 502], [503, 502], [302, 502]]) {
    await assert.rejects(tmdb.searchTmdb('synthetic', token, async () => new Response(`private upstream body ${token}`, { status: upstreamStatus })), error => {
      assert.ok(error instanceof tmdb.TmdbError);
      assert.equal(error.status, expectedStatus);
      assert.ok(!error.message.includes(token));
      assert.ok(!error.message.includes('private upstream body'));
      return true;
    });
  }
});

test('search sanitizes network, timeout, redirect and unreadable JSON failures', async () => {
  const privateMessage = `private exception ${token}`;
  const failures = [
    async () => { throw new Error(privateMessage); },
    async () => { throw new DOMException(privateMessage, 'TimeoutError'); },
    async () => { throw new TypeError(`redirect ${privateMessage}`); },
    async () => { throw new tmdb.TmdbError(401, privateMessage); },
    async () => new Response(privateMessage, { status: 200 }),
    async () => ({ ok: true, status: 200, json: async () => { throw new Error(privateMessage); } }),
  ];
  for (const fetchImpl of failures) {
    await assert.rejects(tmdb.searchTmdb('synthetic', token, fetchImpl), error => {
      assert.ok(error instanceof tmdb.TmdbError);
      assert.equal(error.status, 502);
      assert.ok(!String(error).includes(token));
      assert.ok(!String(error).includes('private exception'));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('search rejects malformed response envelopes with safe 502 errors', async () => {
  const malformedJson = [null, false, 42, 'synthetic malformed response', [], {}, { results: null }, { results: {} }, { results: 'bad' }, { results: 1 }];
  const fetches = [
    ...malformedJson.map(value => async () => Response.json(value)),
    ...[undefined, null, {}, 42, { status: 200, ok: true }].map(value => async () => value),
  ];
  for (const fetchImpl of fetches) {
    await assert.rejects(tmdb.searchTmdb('synthetic', token, fetchImpl), error => {
      assert.ok(error instanceof tmdb.TmdbError);
      assert.equal(error.status, 502);
      assert.ok(!String(error).includes(token));
      return true;
    });
  }
});

test('search rejects invalid queries and missing tokens before requesting', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests++; return Response.json({ results: [] }); };
  for (const query of [undefined, null, 123, {}, [], '', ' \t\n ', 'x'.repeat(201)]) {
    await assert.rejects(tmdb.searchTmdb(query, token, fetchImpl), error => error instanceof tmdb.TmdbError && error.status === 400);
  }
  for (const missingToken of [undefined, null, '', ' \t ', 123, {}]) {
    await assert.rejects(tmdb.searchTmdb('synthetic', missingToken, fetchImpl), error => error instanceof tmdb.TmdbError && error.status === 503);
  }
  assert.equal(requests, 0);
  assert.deepEqual(await tmdb.searchTmdb(`  ${'x'.repeat(200)}  `, token, fetchImpl), { results: [] });
  assert.equal(requests, 1);
});

test('search maps mixed movie and TV candidates through an authenticated bounded request', async (t) => {
  assert.equal(typeof tmdb.searchTmdb, 'function');
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  const durations = [];
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    durations.push(milliseconds);
    return timeout(milliseconds);
  });
  const result = await tmdb.searchTmdb('  Synthetic & Story  ', token, async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, 'https://api.themoviedb.org/3/search/multi');
    assert.deepEqual(Object.fromEntries(parsed.searchParams), {
      query: 'Synthetic & Story', include_adult: 'false', language: 'en-US', page: '1',
    });
    assert.deepEqual(options.headers, { Authorization: `Bearer ${token}`, accept: 'application/json' });
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ results: [
      movie(123, { release_date: '2001-02-03', poster_path: '/synthetic-film.jpg', vote_average: 8.2, vote_count: 99, token }),
      series(123, { first_air_date: '2012-03-04', poster_path: '/synthetic-show.webp', vote_average: 7.4 }),
    ] });
  });
  assert.deepEqual(durations, [10000]);
  assert.deepEqual(result, { results: [
    { catalogueId: 'tmdb:movie:123', tmdbId: 123, provider: 'TMDB', title: 'Synthetic Movie 123', year: '2001', format: 'movie', posterUrl: 'https://image.tmdb.org/t/p/w500/synthetic-film.jpg', sourceUrl: 'https://www.themoviedb.org/movie/123' },
    { catalogueId: 'tmdb:series:123', tmdbId: 123, provider: 'TMDB', title: 'Synthetic Series 123', year: '2012', format: 'series', posterUrl: 'https://image.tmdb.org/t/p/w500/synthetic-show.webp', sourceUrl: 'https://www.themoviedb.org/tv/123' },
  ] });
  const serialized = JSON.stringify(result);
  for (const forbidden of [token, 'vote_average', 'vote_count', 'imdb', 'rating', 'anime']) {
    assert.ok(!serialized.includes(forbidden));
  }
});
