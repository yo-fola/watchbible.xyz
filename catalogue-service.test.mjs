import test from 'node:test';
import assert from 'node:assert/strict';
import { TmdbError } from './tmdb.mjs';

// Clearly synthetic fixtures only; no authenticated or real network requests.
const TOKEN = 'synthetic-fixture-token';
const movie = (extra = {}) => ({ id: 42, title: ' Synthetic Film ', release_date: '2024-02-29', poster_path: '/poster.jpg', backdrop_path: '/backdrop.webp', overview: 'Synthetic overview.', genres: [{ id: 18, name: 'Drama' }], runtime: 101, imdb_id: 'tt1234567', ...extra });
const fixture = (details = movie(), watch = { id: 42, results: {} }) => async url => Response.json(url.includes('/watch/providers') ? watch : details);
const service = () => import('./catalogue-service.mjs');
const safeError = status => error => error instanceof TmdbError && error.status === status && !/synthetic-fixture-token|private|Authorization|Bearer/.test(error.message);

test('explicit upstream media types cannot cross the requested title namespace', async () => {
  const { getDiscoverTitles, getRelatedTitles, getTitleDetails } = await service();
  for (const format of ['movie', 'series']) {
    const type = format === 'movie' ? 'movie' : 'tv';
    const wrong = type === 'movie' ? 'tv' : 'movie';
    for (const getPage of [getDiscoverTitles, getRelatedTitles]) {
      const result = await getPage({ format, id: 42 }, TOKEN, async () => Response.json({ page: 1, total_pages: 1, results: [movie({ media_type: wrong, name: 'Synthetic', id: 1 }), movie({ media_type: 'person', name: 'Synthetic', id: 2 }), movie({ media_type: type, name: 'Synthetic', id: 3 })] }));
      assert.deepEqual(result.results.map(item => item.tmdbId), [3]);
    }
    await assert.rejects(getTitleDetails({ format, id: 42 }, TOKEN, fixture(movie({ name: 'Synthetic', media_type: wrong }))), safeError(502));
  }
});

test('sparse genre selections are rejected rather than silently becoming empty filters', async () => {
  const { getDiscoverTitles } = await service();
  let calls = 0;
  await assert.rejects(getDiscoverTitles({ format: 'movie', genreIds: Array(1) }, TOKEN, () => { calls++; return Response.json({ results: [], page: 1, total_pages: 0 }); }), safeError(400));
  assert.equal(calls, 0);
});

test('malformed optional series runtime and identifiers normalize to null safely', async () => {
  const { getTitleDetails } = await service();
  for (const episode_run_time of [{}, '24', [null, -1, 2.5, '24'], null]) {
    const result = await getTitleDetails({ format: 'series', id: 42 }, TOKEN, fixture({ id: 42, name: 'Synthetic TV', episode_run_time, number_of_seasons: '0', number_of_episodes: -1, imdb_id: 'tt1234567\n' }));
    assert.equal(result.runtimeMinutes, null);
    assert.equal(result.seasons, null);
    assert.equal(result.episodes, null);
    assert.equal(result.imdbId, null);
  }
});

test('related titles use recommendations endpoints with bounded validated paging', async () => {
  const { getRelatedTitles } = await service();
  for (const format of ['movie', 'series']) {
    const result = await getRelatedTitles({ format, id: 42, page: 500 }, TOKEN, async url => {
      const parsed = new URL(url);
      assert.equal(parsed.pathname, `/3/${format === 'movie' ? 'movie' : 'tv'}/42/recommendations`);
      assert.equal(parsed.searchParams.get('language'), 'en-US');
      assert.equal(parsed.searchParams.get('page'), '500');
      assert.equal(parsed.searchParams.has('include_adult'), false); // Not supported by recommendations.
      return Response.json({ page: 500, total_pages: 600, results: [movie({ id: 1, name: 'Synthetic TV' }), movie({ adult: true })] });
    });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].catalogueId, `tmdb:${format}:1`);
    assert.equal(result.page, 500);
    assert.equal(result.totalPages, 500);
  }
  let calls = 0;
  for (const input of [null, {}, { format: 'tv', id: 42 }, ...[0, -1, '42', 1.5, Number.MAX_SAFE_INTEGER + 1].map(id => ({ format: 'movie', id })), ...[0, 501, '1', null].map(page => ({ format: 'movie', id: 42, page }))]) await assert.rejects(getRelatedTitles(input, TOKEN, () => { calls++; }), safeError(400));
  await assert.rejects(getRelatedTitles({ format: 'movie', id: 42 }, '', () => { calls++; }), safeError(503));
  assert.equal(calls, 0);
  await assert.rejects(getRelatedTitles({ format: 'movie', id: 42 }, TOKEN, async () => new Response('private', { status: 404 })), safeError(404));
  await assert.rejects(getRelatedTitles({ format: 'movie', id: 42 }, TOKEN, async () => Response.json({ results: [], page: 2, total_pages: 2 })), safeError(502));
  assert.deepEqual(await getRelatedTitles({ format: 'movie', id: 42 }, TOKEN, async () => Response.json({ results: [], page: 1, total_pages: 0 })), { results: [], page: 1, totalPages: 0 });
});

test('discovery validates filters before network and rejects malformed pagination', async () => {
  const { getDiscoverTitles } = await service();
  let calls = 0;
  for (const input of [null, undefined, [], {}, { format: 'tv' }, ...[0, -1, 501, 1.2, '1', NaN, null].map(page => ({ format: 'movie', page })), ...[null, {}, '18', [0], [1.1], ['18'], [Number.MAX_SAFE_INTEGER + 1], Array(21).fill(18)].map(genreIds => ({ format: 'movie', genreIds }))]) {
    await assert.rejects(getDiscoverTitles(input, TOKEN, () => { calls++; }), safeError(400));
  }
  await assert.rejects(getDiscoverTitles({ format: 'movie' }, '', () => { calls++; }), safeError(503));
  assert.equal(calls, 0);
  for (const data of [null, {}, { results: [], page: 1 }, { results: {}, page: 1, total_pages: 1 }, ...[0, 2, '1', null].map(page => ({ results: [], page, total_pages: 2 })), ...[-1, 1.2, '2', null].map(total_pages => ({ results: [], page: 1, total_pages }))]) await assert.rejects(getDiscoverTitles({ format: 'movie' }, TOKEN, async () => Response.json(data)), safeError(502));
  const empty = await getDiscoverTitles({ format: 'movie' }, TOKEN, async url => { assert.equal(new URL(url).searchParams.has('with_genres'), false); return Response.json({ results: [], page: 1, total_pages: 0 }); });
  assert.deepEqual(empty, { results: [], page: 1, totalPages: 0 });
});

test('discovery omits empty preferences and preserves a single selected interest for movies and series', async () => {
  const { getDiscoverTitles } = await service();
  for (const format of ['movie', 'series']) {
    for (const [genreIds, expected] of [[undefined, null], [[], null], [[18], '18']]) {
      let called;
      const result = await getDiscoverTitles({ format, genreIds }, TOKEN, async url => {
        called = new URL(url);
        return Response.json({ results: [], page: 1, total_pages: 0 });
      });
      assert.equal(called.searchParams.get('with_genres'), expected);
      assert.deepEqual(result, { results: [], page: 1, totalPages: 0 });
    }
  }
});

test('discovery returns bounded ordered unique extended candidates from the requested namespace', async () => {
  const { getDiscoverTitles } = await service();
  for (const format of ['movie', 'series']) {
    let called;
    const items = [null, movie({ adult: true }), movie({ id: 0 }), movie({ title: '', name: '' }), ...Array.from({ length: 22 }, (_, index) => movie({ id: index + 1, name: `Synthetic ${index + 1}`, genre_ids: [18, 18, 0, '4', 28], popularity: index ? -1 : 12.5, first_air_date: '2023-02-29' }))];
    items.splice(6, 0, items[5]);
    const result = await getDiscoverTitles({ format, genreIds: [18, 28], page: 2 }, TOKEN, async url => { called = new URL(url); return Response.json({ results: items, page: 2, total_pages: 800 }); });
    assert.equal(called.pathname, `/3/discover/${format === 'movie' ? 'movie' : 'tv'}`);
    assert.equal(called.searchParams.get('language'), 'en-US');
    assert.equal(called.searchParams.get('include_adult'), 'false');
    assert.equal(called.searchParams.get('page'), '2');
    // Preferences express different interests, not a requirement to carry every selected genre.
    // TMDB discover movie/TV document pipe as OR and comma as AND.
    assert.equal(called.searchParams.get('with_genres'), '18|28');
    assert.equal(result.page, 2);
    assert.equal(result.totalPages, 500);
    assert.deepEqual(result.results.map(item => item.tmdbId), Array.from({ length: 20 }, (_, i) => i + 1));
    assert.deepEqual(result.results[0], { catalogueId: `tmdb:${format}:1`, tmdbId: 1, provider: 'TMDB', title: format === 'movie' ? 'Synthetic Film' : 'Synthetic 1', year: format === 'movie' ? '2024' : null, format, posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg', sourceUrl: `https://www.themoviedb.org/${format === 'movie' ? 'movie' : 'tv'}/1`, overview: 'Synthetic overview.', genreIds: [18, 28], popularity: 12.5 });
    assert.equal(result.results[1].popularity, null);
  }
});

test('regions use the localized countries endpoint with the shared authenticated request policy', async () => {
  const { getRegions } = await service();
  assert.equal(typeof getRegions, 'function');
  let calls = 0;
  const result = await getRegions(TOKEN, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.themoviedb.org/3/configuration/countries?language=en-US');
    assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(options.headers.accept, 'application/json');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    return Response.json([{ iso_3166_1: 'NG', english_name: 'Nigeria', native_name: 'Not the English name' }]);
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { regions: [{ code: 'NG', name: 'Nigeria' }] });
});

test('regions reject malformed non-array envelopes with safe upstream errors', async () => {
  const { getRegions } = await service();
  for (const data of [null, {}, { regions: [] }, { results: [] }, 'private envelope', 42, true]) {
    await assert.rejects(getRegions(TOKEN, async () => Response.json(data)), safeError(502));
  }
  assert.deepEqual(await getRegions(TOKEN, async () => Response.json([])), { regions: [] });
});

test('regions retain only valid source codes and trimmed English names, deduplicated in source order', async () => {
  const { getRegions } = await service();
  const rows = [
    null, [], 'NG', 42, {}, { code: 'NG', name: 'Not source fields' },
    ...['ng', 'NGA', 'N', 'NG\n', ' NG', 'N1', '', null, 12].map(iso_3166_1 => ({ iso_3166_1, english_name: 'Invalid code' })),
    ...['', ' \n\t ', null, 12].map(english_name => ({ iso_3166_1: 'NG', english_name })),
    { iso_3166_1: 'NG', english_name: ' Nigeria ', native_name: 'Ignored' },
    { iso_3166_1: 'NG', english_name: 'Duplicate ignored' },
    { iso_3166_1: 'US', english_name: 'United States of America' },
    { iso_3166_1: 'GB', native_name: 'No English name' },
  ];
  assert.deepEqual(await getRegions(TOKEN, async () => Response.json(rows)), {
    regions: [{ code: 'NG', name: 'Nigeria' }, { code: 'US', name: 'United States of America' }],
  });
  assert.deepEqual(await getRegions(TOKEN, async () => Response.json([null, {}])), { regions: [] });
});

test('regions preserve shared safe credential, transport, status and JSON failure handling', async () => {
  const { getRegions } = await service();
  let calls = 0;
  for (const token of ['', '  ', null, undefined, 4]) {
    await assert.rejects(getRegions(token, () => { calls++; }), safeError(503));
  }
  assert.equal(calls, 0);
  const failures = [
    [async () => { throw new Error(`${TOKEN} private Authorization Bearer`); }, 502],
    [async () => { throw new DOMException('private timeout', 'TimeoutError'); }, 502],
    [async () => new Response('private malformed JSON'), 502],
    ...[[401, 401], [403, 401], [429, 429], [404, 502], [500, 502]].map(([status, expected]) => [async () => new Response('private body', { status }), expected]),
    ...[null, {}, { status: 200 }, { status: '200', ok: true }, { status: 200, ok: true, json: async () => { throw new Error(`${TOKEN} private JSON`); } }].map(response => [async () => response, 502]),
  ];
  for (const [fetchImpl, status] of failures) {
    calls = 0;
    await assert.rejects(getRegions(TOKEN, (...args) => { calls++; return fetchImpl(...args); }), safeError(status));
    assert.equal(calls, 1);
  }
});

test('genre lists use both exact localized endpoints and reject malformed envelopes', async () => {
  const { getGenreLists } = await service();
  const urls = [];
  const result = await getGenreLists(TOKEN, async url => { urls.push(new URL(url)); return Response.json({ genres: [{ id: 18, name: ' Drama ' }, { id: 18, name: 'Duplicate' }, { id: 0, name: 'Bad' }, null, { id: 28, name: '' }] }); });
  assert.deepEqual(urls.map(url => url.pathname).sort(), ['/3/genre/movie/list', '/3/genre/tv/list']);
  assert.ok(urls.every(url => url.searchParams.get('language') === 'en-US'));
  assert.deepEqual(result, { movie: [{ id: 18, name: 'Drama' }], series: [{ id: 18, name: 'Drama' }] });
  for (const data of [null, [], {}, { genres: null }, { genres: {} }]) await assert.rejects(getGenreLists(TOKEN, async () => Response.json(data)), safeError(502));
  let calls = 0;
  await assert.rejects(getGenreLists('', () => { calls++; }), safeError(503));
  assert.equal(calls, 0);
});

test('primary metadata failures map to sanitized TmdbError statuses without requesting watch', async () => {
  const { getTitleDetails } = await service();
  const cases = [[async () => { throw new Error(`${TOKEN} private headers`); }, 502], [async () => { throw new TmdbError(400, 'private exception'); }, 502], [async () => new Response('private malformed'), 502], ...[[401, 401], [403, 401], [429, 429], [404, 404], [400, 502], [500, 502]].map(([status, expected]) => [async () => new Response('private body', { status }), expected]), ...[null, {}, { status: 200 }, { status: '200', ok: true }, ...[null, [], {}, movie({ id: 43 }), movie({ id: '42' }), movie({ title: '' }), movie({ adult: true })].map(data => ({ status: 200, ok: true, json: async () => data }))].map(response => [async () => response, 502])];
  for (const [fetchImpl, status] of cases) {
    let calls = 0;
    await assert.rejects(getTitleDetails({ format: 'movie', id: 42 }, TOKEN, (...args) => { calls++; return fetchImpl(...args); }), safeError(status));
    assert.equal(calls, 1);
  }
});

test('details reject invalid input and missing credentials before any request', async () => {
  const { getTitleDetails } = await service();
  let calls = 0;
  const noRequest = () => { calls++; throw new Error('unexpected request'); };
  for (const input of [null, undefined, {}, { format: 'tv', id: 42 }, { format: 'Movie', id: 42 }, ...[0, -1, 1.5, '42', Infinity, Number.MAX_SAFE_INTEGER + 1].map(id => ({ format: 'movie', id })), ...['ng', 'NGA', 'NG\n', '', 7, null].map(region => ({ format: 'movie', id: 42, region }))]) {
    await assert.rejects(getTitleDetails(input, TOKEN, noRequest), safeError(400));
  }
  for (const token of ['', '  ', null, undefined, 4]) await assert.rejects(getTitleDetails({ format: 'movie', id: 42 }, token, noRequest), safeError(503));
  assert.equal(calls, 0);
});

test('watch failures or invalid watch identity and links preserve metadata as error, never unlisted', async () => {
  const { getTitleDetails } = await service();
  const base = 'https://www.themoviedb.org/movie/42/watch?locale=NG';
  const badLinks = [null, 'https://service.example/watch', base.replace('https:', 'http:'), base.replace('/42/', '/420/'), base.replace('/movie/', '/tv/'), base.replace('NG', 'US'), base + '&locale=US', base + '#bad', base.replace('www.themoviedb.org', 'www.themoviedb.org.evil.test'), base.replace('/watch', '/watch/extra'), base.replace('https://', 'https://user@'), base + '\n'];
  const failures = [async () => { throw new Error(`${TOKEN} private network failure`); }, async () => new Response('private upstream', { status: 429 }), async () => new Response('{'), ...[null, {}, { id: 43, results: {} }, { id: 42, results: [] }, { id: 42, results: { NG: null } }, { id: 42, results: { NG: { link: base, flatrate: {} } } }, ...badLinks.map(link => ({ id: 42, results: { NG: { link, flatrate: [{ provider_id: 1, provider_name: 'Synthetic' }] } } }))].map(data => async () => Response.json(data))];
  for (const fail of failures) {
    const result = await getTitleDetails({ format: 'movie', id: 42 }, TOKEN, url => url.includes('/watch/providers') ? fail() : Response.json(movie()));
    assert.equal(result.title, 'Synthetic Film');
    assert.deepEqual(result.watch, { region: 'NG', status: 'error', link: null, offers: [], attribution: 'JustWatch' });
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  }
});

test('regional offers retain source kinds and the upstream verified watch link', async () => {
  const { getTitleDetails } = await service();
  const provider = { provider_id: 7, provider_name: ' Synthetic Provider ', logo_path: '/logo.png' };
  for (const format of ['movie', 'series']) {
    const link = `https://www.themoviedb.org/${format === 'movie' ? 'movie' : 'tv'}/42-synthetic-title/watch?locale=US`;
    const result = await getTitleDetails({ format, id: 42, region: 'US' }, TOKEN, fixture(format === 'movie' ? movie() : { id: 42, name: 'Synthetic TV' }, { id: 42, results: { US: { link, flatrate: [provider, provider, { provider_id: -1, provider_name: 'Bad' }], rent: [provider], buy: [provider], free: [provider], ads: [{ ...provider, logo_path: 'https://bad.example/logo.png' }] }, NG: { link: 'https://bad.example/' } } }));
    assert.deepEqual(result.watch, { region: 'US', status: 'ok', link, attribution: 'JustWatch', offers: ['stream', 'rent', 'buy', 'free', 'ads'].map(kind => ({ providerId: 7, name: 'Synthetic Provider', logoUrl: kind === 'ads' ? null : 'https://image.tmdb.org/t/p/w500/logo.png', kind })) });
  }
});

test('series metadata preserves zero counts and requires an explicit exact anime keyword', async () => {
  const { getTitleDetails } = await service();
  for (const [keywords, expected] of [[{ results: [{ name: 'anime' }] }, true], [{ results: [{ name: 'Anime' }] }, null], [{ results: [{ name: 'animation' }] }, null], [null, null]]) {
    const result = await getTitleDetails({ format: 'series', id: 42 }, TOKEN, fixture({ id: 42, name: 'Synthetic Series', first_air_date: '2023-02-29', original_language: 'ja', genres: [{ id: 16, name: 'Animation' }], keywords, episode_run_time: [24], number_of_seasons: 0, number_of_episodes: 0, vote_average: 9.8 }));
    assert.equal(result.title, 'Synthetic Series');
    assert.equal(result.catalogueId, 'tmdb:series:42');
    assert.equal(result.sourceUrl, 'https://www.themoviedb.org/tv/42');
    assert.equal(result.year, null);
    assert.equal(result.anime, expected);
    assert.equal(result.runtimeMinutes, 24);
    assert.equal(result.seasons, 0);
    assert.equal(result.episodes, 0);
    assert.equal(result.imdbId, null);
    assert.equal(result.posterUrl, null);
    assert.equal(result.backdropUrl, null);
    assert.equal(result.overview, '');
    assert.ok(!('rating' in result) && !('vote_average' in result));
  }
  const normalized = await getTitleDetails({ format: 'movie', id: 42 }, TOKEN, fixture(movie({ release_date: '0000-01-01', poster_path: '/nested/file.jpg', backdrop_path: '/file.jpg?bad', overview: null, runtime: -1, imdb_id: '9.8', keywords: { keywords: [{ name: 'anime' }] }, genres: [{ id: -1, name: 'Bad' }, { id: 18, name: ' Drama ' }, { id: 18, name: 'Duplicate' }, null] })));
  assert.equal(normalized.year, null);
  assert.equal(normalized.posterUrl, null);
  assert.equal(normalized.backdropUrl, null);
  assert.equal(normalized.runtimeMinutes, null);
  assert.equal(normalized.imdbId, null);
  assert.equal(normalized.anime, true);
  assert.deepEqual(normalized.genres, [{ id: 18, name: 'Drama' }]);
});

test('movie details expose flat metadata with a separate regional availability request', async () => {
  const { getTitleDetails } = await service();
  const calls = [];
  const result = await getTitleDetails({ format: 'movie', id: 42 }, TOKEN, async (url, options) => {
    calls.push(new URL(url));
    assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(options.headers.accept, 'application/json');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return fixture()(url);
  });
  assert.deepEqual(calls.map(url => url.pathname), ['/3/movie/42', '/3/movie/42/watch/providers']);
  assert.equal(calls[0].searchParams.get('append_to_response'), 'keywords');
  assert.equal(calls[0].searchParams.get('language'), 'en-US');
  const { fetchedAt, ...rest } = result;
  assert.equal(new Date(fetchedAt).toISOString(), fetchedAt);
  assert.deepEqual(rest, { catalogueId: 'tmdb:movie:42', tmdbId: 42, provider: 'TMDB', title: 'Synthetic Film', format: 'movie', year: '2024', posterUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg', backdropUrl: 'https://image.tmdb.org/t/p/w500/backdrop.webp', sourceUrl: 'https://www.themoviedb.org/movie/42', overview: 'Synthetic overview.', genres: [{ id: 18, name: 'Drama' }], anime: null, runtimeMinutes: 101, seasons: null, episodes: null, imdbId: 'tt1234567', watch: { region: 'NG', status: 'unlisted', link: null, offers: [], attribution: 'JustWatch' } });
});
