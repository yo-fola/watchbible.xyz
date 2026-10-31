import test from 'node:test';
import assert from 'node:assert/strict';
import * as service from './catalogue-service.mjs';
import { TmdbError } from './tmdb.mjs';
const TOKEN = 'synthetic-tv-token';
const seasonRow = (extra = {}) => ({ id: 91, season_number: 1, name: ' Season One ', episode_count: 1, air_date: '2024-02-29', poster_path: '/season.jpg', ...extra });
const series = (extra = {}) => ({ id: 123, name: 'Synthetic Series', seasons: [seasonRow()], number_of_seasons: 1, number_of_episodes: 1, status: 'Returning Series', in_production: true, ...extra });
const episode = (extra = {}) => ({ id: 801, show_id: 123, season_number: 1, episode_number: 1, name: ' Pilot ', overview: 'Synthetic.', air_date: '2024-02-29', runtime: 45, still_path: '/still.webp', episode_type: 'standard', ...extra });
const season = (extra = {}) => ({ id: 91, season_number: 1, name: ' Season One ', overview: 'Synthetic season.', poster_path: '/season.jpg', air_date: '2024-02-29', episodes: [episode()], ...extra });
const safe = status => error => error instanceof TmdbError && error.status === status && !/synthetic-tv-token|private|Bearer/.test(error.message);
const fixture = (show = series(), detail = season()) => async url => Response.json(url.includes('/season/') ? detail : url.includes('/watch/providers') ? { id: 123, results: {} } : show);

test('series details add validated season metadata while preserving numeric counts and movie contract', async () => {
  const result = await service.getTitleDetails({ format: 'series', id: 123 }, TOKEN, fixture());
  assert.deepEqual(result.seasonList, [{ seasonNumber: 1, name: 'Season One', episodeCount: 1, airDate: '2024-02-29', posterUrl: 'https://image.tmdb.org/t/p/w500/season.jpg' }]);
  assert.equal(result.seriesStatus, 'Returning Series');
  assert.equal(result.inProduction, true);
  assert.equal(result.seasons, 1);
  assert.equal(result.episodes, 1);
});

test('season details verify the TV namespace first then normalize the exact season endpoint', async () => {
  assert.equal(typeof service.getSeasonDetails, 'function');
  const calls = [];
  const result = await service.getSeasonDetails({ seriesId: 123, seasonNumber: 1 }, TOKEN, async (url, options) => {
    calls.push(new URL(url));
    assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return fixture()(url);
  });
  assert.deepEqual(calls.map(url => url.pathname), ['/3/tv/123', '/3/tv/123/season/1']);
  assert.ok(calls.every(url => url.searchParams.get('language') === 'en-US'));
  assert.deepEqual(result, { catalogueId: 'tmdb:series:123', seriesId: 123, seasonId: 91, seasonNumber: 1, name: 'Season One', overview: 'Synthetic season.', posterUrl: 'https://image.tmdb.org/t/p/w500/season.jpg', airDate: '2024-02-29', episodes: [{ episodeId: 801, episodeNumber: 1, seasonNumber: 1, name: 'Pilot', overview: 'Synthetic.', stillUrl: 'https://image.tmdb.org/t/p/w500/still.webp', airDate: '2024-02-29', runtimeMinutes: 45, episodeType: 'standard' }] });
});

test('malformed episode identity, namespace, numbering and duplicate rows fail closed', async () => {
  const badRows = [null, {}, episode({ id: 0 }), episode({ id: '801' }), episode({ show_id: 124 }), episode({ season_number: 0 }), episode({ episode_number: 0 }), episode({ episode_number: 1.5 }), episode({ episode_number: 2 }), episode({ name: '' }), episode({ media_type: 'movie' })];
  for (const row of badRows) await assert.rejects(service.getSeasonDetails({ seriesId: 123, seasonNumber: 1 }, TOKEN, fixture(series(), season({ episodes: [row] }))), safe(502));
  for (const rows of [[episode(), episode({ episode_number: 2 })], [episode(), episode({ id: 802 })]]) {
    await assert.rejects(service.getSeasonDetails({ seriesId: 123, seasonNumber: 1 }, TOKEN, fixture(series({ seasons: [seasonRow({ episode_count: 2 })] }), season({ episodes: rows }))), safe(502));
  }
});

test('specials season zero is valid and untrusted optional fields are null, never inferred', async () => {
  const result = await service.getSeasonDetails({ seriesId: 123, seasonNumber: 0 }, TOKEN, fixture(series({ seasons: [seasonRow({ season_number: 0 })] }), season({ season_number: 0, air_date: '2023-02-29', poster_path: 'https://evil.test/x.jpg', episodes: [episode({ season_number: 0, episode_type: 'made-up-finale', air_date: '2024-02-30', still_path: '/x.jpg\n', runtime: -1 })] })));
  assert.equal(result.seasonNumber, 0);
  assert.equal(result.airDate, null);
  assert.equal(result.posterUrl, null);
  assert.equal(result.episodes[0].airDate, null);
  assert.equal(result.episodes[0].stillUrl, null);
  assert.equal(result.episodes[0].runtimeMinutes, null);
  assert.equal(result.episodes[0].episodeType, null);
});

test('invalid inputs and series namespace stop before season fetch; malformed rosters never lose rows', async () => {
  let calls = 0;
  for (const input of [null, {}, { seriesId: '123', seasonNumber: 1 }, { seriesId: 0, seasonNumber: 1 }, ...[-1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1].map(seasonNumber => ({ seriesId: 123, seasonNumber }))]) await assert.rejects(service.getSeasonDetails(input, TOKEN, () => { calls++; }), safe(400));
  await assert.rejects(service.getSeasonDetails({ seriesId: 123, seasonNumber: 1 }, '', () => { calls++; }), safe(503));
  assert.equal(calls, 0);
  for (const show of [series({ id: 124 }), series({ media_type: 'movie' }), series({ seasons: null }), series({ seasons: [null] }), series({ seasons: [seasonRow(), seasonRow()] }), series({ seasons: [seasonRow({ episode_count: -1 })] })]) {
    calls = 0;
    await assert.rejects(service.getSeasonDetails({ seriesId: 123, seasonNumber: 1 }, TOKEN, async () => { calls++; return Response.json(show); }), safe(502));
    assert.equal(calls, 1);
  }
  for (const detail of [season({ id: 92 }), season({ season_number: 2 }), season({ episodes: null }), season({ episodes: [] })]) await assert.rejects(service.getSeasonDetails({ seriesId: 123, seasonNumber: 1 }, TOKEN, fixture(series(), detail)), safe(502));
  await assert.rejects(service.getSeasonDetails({ seriesId: 123, seasonNumber: 2 }, TOKEN, fixture()), safe(404));
  for (const [status, expected] of [[401, 401], [403, 401], [404, 404], [429, 429], [500, 502]]) await assert.rejects(service.getSeasonDetails({ seriesId: 123, seasonNumber: 1 }, TOKEN, async () => new Response('private', { status })), safe(expected));
});

test('season envelopes cannot claim a different series or media namespace; missing rosters are not proof of absence', async () => {
  for (const detail of [season({ show_id: 124 }), season({ media_type: 'movie' })]) await assert.rejects(service.getSeasonDetails({ seriesId: 123, seasonNumber: 1 }, TOKEN, fixture(series(), detail)), safe(502));
  await assert.rejects(service.getSeasonDetails({ seriesId: 123, seasonNumber: 1 }, TOKEN, fixture(series({ seasons: undefined }))), safe(502));
});
