import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppStore } from './app-state.mjs';
import { getProgress } from './gamification-model.mjs';
import { toLibraryEntry } from './library-actions.mjs';

const series = { provider: 'TMDB', catalogueId: 'tmdb:series:1', tmdbId: 1, format: 'series', title: 'Show', sourceUrl: 'https://www.themoviedb.org/tv/1', seasonList: [], seriesStatus: 'Ended' };
const episode = { episodeId: 101, episodeNumber: 1, seasonNumber: 1, airDate: '2000-01-01', runtimeMinutes: 20 };
const season = { catalogueId: 'tmdb:series:1', seriesId: 1, seasonId: 10, seasonNumber: 1, episodes: [episode] };
function storage() { let raw = null; return { getItem: () => raw, setItem(key, value) { raw = value; }, raw: () => raw }; }

test('explicit episode action persists evidence and a watching library entry without TV XP', async () => {
  const { setEpisodeStatus } = await import('./episode-progress.mjs');
  const disk = storage(); const store = createAppStore(disk);
  store.transact(d => setEpisodeStatus(d, series, season, episode, 'watched'));
  assert.deepEqual(store.getState().episodeProgress, [{ seriesId: 1, seasonNumber: 1, episodeNumber: 1, episodeId: 101, status: 'watched' }]);
  assert.equal(store.getState().library[0].status, 'watching');
  assert.equal('seasonList' in store.getState().library[0], false);
  assert.equal('seriesStatus' in store.getState().library[0], false);
  assert.equal(getProgress(store.getState()).xp, 0);
  assert.deepEqual(createAppStore(disk).getState(), store.getState());
  store.transact(d => setEpisodeStatus(d, series, season, episode, 'watching'));
  assert.equal(store.getState().episodeProgress.length, 1);
  assert.equal(store.getState().episodeProgress[0].status, 'watching');
  store.transact(d => setEpisodeStatus(d, series, season, episode, null));
  assert.deepEqual(store.getState().episodeProgress, []);
  assert.equal(store.getState().library.length, 1);
});

test('episode actions reject mismatched identities, invalid status, unaired and unknown dates atomically', async () => {
  const { setEpisodeStatus } = await import('./episode-progress.mjs');
  const cases = [
    [{ ...series, format: 'movie' }, season, episode, 'watched'],
    [{ ...series, catalogueId: 'tmdb:series:01' }, season, episode, 'watched'],
    [{ ...series, tmdbId: 2 }, season, episode, 'watched'],
    [series, { ...season, seriesId: 2 }, episode, 'watched'],
    [series, { ...season, catalogueId: 'tmdb:series:2' }, episode, 'watched'],
    [series, season, { ...episode, seasonNumber: 2 }, 'watched'],
    [series, season, { ...episode, episodeId: 0 }, 'watched'],
    [series, season, { ...episode, episodeNumber: 0 }, 'watched'],
    [series, season, { ...episode, airDate: '9999-01-01' }, 'watching'],
    ...[null, undefined, '', '2000-02-30'].map(airDate => [series, season, { ...episode, airDate }, 'watched']),
    [series, season, episode, 'plan_to_watch'],
  ];
  for (const args of cases) {
    const disk = storage(); const store = createAppStore(disk); const before = store.getState();
    assert.throws(() => store.transact(d => setEpisodeStatus(d, ...args)), Error, JSON.stringify(args));
    assert.deepEqual(store.getState(), before); assert.equal(disk.raw(), null);
  }
});

test('episode actions preserve explicit show status and user metadata; failed writes preserve evidence and XP', async () => {
  const { setEpisodeStatus } = await import('./episode-progress.mjs');
  for (const status of ['watched', 'watching', 'plan_to_watch']) {
    const disk = storage(); const store = createAppStore(disk);
    store.transact(d => d.library.push({ ...toLibraryEntry(series), status, liked: true, anime: true, personalRating: 9 }));
    store.transact(d => setEpisodeStatus(d, series, season, episode, 'watched'));
    const saved = store.getState().library[0];
    assert.equal(saved.status, status === 'plan_to_watch' ? 'watching' : status);
    assert.equal(saved.liked, true); assert.equal(saved.anime, true); assert.equal(saved.personalRating, 9);
    const before = store.getState(); const raw = disk.raw();
    disk.setItem = () => { throw new Error('quota'); };
    assert.throws(() => store.transact(d => setEpisodeStatus(d, series, season, episode, null)), /quota/);
    assert.deepEqual(store.getState(), before); assert.equal(disk.raw(), raw);
    assert.equal(getProgress(store.getState()).xp, 0);
  }
});

test('season progress counts exact identities and distinguishes complete from caught up without mutating state', async () => {
  const { getSeasonProgress } = await import('./episode-progress.mjs');
  const record = { seriesId: 1, seasonNumber: 1, episodeNumber: 1, episodeId: 101, status: 'watched' };
  const state = { episodeProgress: [record], library: [{ ...series, status: 'watched' }] };
  const before = structuredClone(state);
  assert.deepEqual(getSeasonProgress(state, season, { today: '2026-01-01' }),
    { watched: 1, total: 1, watching: 0, complete: true, caughtUp: true, unreleased: 0, unknownAirDates: 0 });
  const roster = { ...season, episodes: [episode,
    { ...episode, episodeId: 102, episodeNumber: 2, airDate: '2027-01-01' },
    { ...episode, episodeId: 103, episodeNumber: 3, airDate: null }] };
  assert.deepEqual(getSeasonProgress(state, roster, { today: '2026-01-01' }),
    { watched: 1, total: 3, watching: 0, complete: false, caughtUp: true, unreleased: 1, unknownAirDates: 1 });
  assert.equal(getSeasonProgress(state, { ...season, episodes: [{ ...episode, episodeId: 999 }] }).watched, 0);
  assert.equal(getSeasonProgress({ episodeProgress: [], library: state.library }, season).watched, 0);
  assert.equal(getSeasonProgress({ episodeProgress: [{ ...record, status: 'watching' }] }, season).watching, 1);
  for (const episodes of [[], undefined, null, [null], [episode, episode], [{ ...episode, seasonNumber: 2 }], Array(2)]) {
    const result = getSeasonProgress(state, { ...season, episodes });
    assert.equal(result.complete, false);
    assert.equal(result.caughtUp, false);
    assert.equal(result.total, Array.isArray(episodes) ? episodes.length : 0);
  }
  assert.deepEqual(state, before);
});

test('specials and exact episode clearing leave other evidence and movie XP intact', async () => {
  const { setEpisodeStatus, getSeasonProgress } = await import('./episode-progress.mjs');
  const disk = storage(); const store = createAppStore(disk);
  store.transact(d => d.library.push({ ...toLibraryEntry({ ...series, format: 'movie', catalogueId: 'tmdb:movie:1' }), status: 'watched' }));
  assert.equal(getProgress(store.getState()).xp, 100);
  const special = { ...episode, seasonNumber: 0 };
  const specials = { ...season, seasonNumber: 0, episodes: [special] };
  store.transact(d => setEpisodeStatus(d, series, specials, special, 'watched'));
  const second = { ...episode, episodeId: 102, episodeNumber: 2 };
  store.transact(d => setEpisodeStatus(d, series, season, second, 'watching'));
  store.transact(d => setEpisodeStatus(d, series, specials, { ...special, airDate: null }, null));
  assert.equal(store.getState().episodeProgress.length, 1);
  assert.equal(store.getState().episodeProgress[0].episodeId, 102);
  assert.equal(getProgress(store.getState()).xp, 100);
  assert.equal(getSeasonProgress(store.getState(), specials).complete, false);
  const empty = { episodeProgress: [] };
  const future = { ...season, episodes: [{ ...episode, airDate: '9999-01-01' }] };
  assert.equal(getSeasonProgress(empty, future).caughtUp, false);
  for (const change of [{ seriesId: 2, catalogueId: 'tmdb:series:2' }, { seasonNumber: 2 }]) {
    assert.equal(getSeasonProgress(store.getState(), { ...season, ...change, episodes: [second] }).watching, 0);
  }
  assert.throws(() => getSeasonProgress(empty, season, { today: '2026-02-30' }));
  const before = store.getState(); const raw = disk.raw();
  disk.setItem = () => { throw new Error('quota'); };
  assert.throws(() => store.transact(d => {
    d.library[0].status = 'watching';
    setEpisodeStatus(d, series, season, second, null);
  }), /quota/);
  assert.deepEqual(store.getState(), before); assert.equal(disk.raw(), raw);
  assert.equal(getProgress(store.getState()).xp, 100);
});
