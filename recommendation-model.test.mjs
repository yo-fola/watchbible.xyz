import test from 'node:test';
import assert from 'node:assert/strict';
import { rankRecommendations } from './recommendation-model.mjs';
const state = (extra = {}) => ({ preferences: { region: 'NG', formats: ['movie', 'series'], genres: { movie: [], series: [] } }, library: [], dismissed: [], ...extra });
test('ranking indexes 10,000 library entries once, independent of 100 candidates', () => {
  let visits = 0, seedReads = 0, genreReads = 0;
  const library = Array.from({ length: 10000 }, (_, index) => ({
    get catalogueId() { visits++; return `tmdb:movie:${index + 1}`; },
    get liked() { seedReads++; return index === 9998; },
    get status() { seedReads++; return index === 9999 ? 'plan_to_watch' : 'watched'; }, title: `Seed ${index}`,
  }));
  const context = state({ library });
  Object.defineProperty(context.preferences.genres, 'movie', { get() { genreReads++; return [18]; } });
  const result = rankRecommendations(Array.from({ length: 100 }, (_, index) => candidate(20000 + index, 'movie', { relatedTo: ['tmdb:movie:9999', 'tmdb:movie:10000'], genreIds: [18] })), context);
  assert.equal(result.length, 100);
  assert.equal(result[0].recommendationReason, 'Because you liked Seed 9998');
  assert.equal(seedReads, 20000, `positive seed field accesses: ${seedReads}`);
  assert.equal(visits, 10000);
  assert.equal(genreReads, 1);
});

test('liked reason follows library order rather than relatedTo order', () => {
  const context = state({ library: [candidate(1, 'movie', { liked: true, title: 'First' }), candidate(2, 'movie', { liked: true, title: 'Second' })] });
  assert.equal(rankRecommendations([candidate(3, 'movie', { relatedTo: ['tmdb:movie:2', 'tmdb:movie:1'] })], context)[0].recommendationReason, 'Because you liked First');
});
test('liked related seeds outrank Watch later seeds and merely watched is not a positive signal', () => {
  const context = state({ library: [candidate(1, 'movie', { liked: true, status: 'watched', title: 'Favorite' }),
    candidate(2, 'movie', { liked: false, status: 'plan_to_watch' }),
    candidate(3, 'movie', { liked: false, status: 'watched' }), candidate(4, 'movie', { liked: false, status: 'watching' })] });
  const result = rankRecommendations([
    candidate(10, 'movie', { relatedTo: ['tmdb:movie:3'] }),
    candidate(11, 'movie', { relatedTo: ['tmdb:movie:2'] }),
    candidate(12, 'movie', { relatedTo: ['tmdb:movie:1'] }),
    candidate(13, 'movie', { relatedTo: ['tmdb:movie:4'] }),
  ], context);
  assert.deepEqual(result.map(x => x.tmdbId), [12, 11, 10, 13]);
  assert.equal(result[0].recommendationReason, 'Because you liked Favorite');
  assert.equal(result[1].recommendationReason, 'From your Watch later');
  assert.equal(result[2].recommendationReason, 'Popular picks');
  assert.equal(result[2].score, result[3].score);
});

test('explicit format-specific genre preferences rank above popularity but below positive seed relations', () => {
  const context = state({ library: [candidate(1, 'movie', { liked: true }), candidate(2, 'movie', { status: 'plan_to_watch' })] });
  context.preferences.genres = { movie: [18, 28], series: [16] };
  const result = rankRecommendations([
    candidate(10, 'movie', { popularity: 1000000 }),
    candidate(11, 'series', { genreIds: [18], popularity: 0 }),
    candidate(12, 'movie', { genreIds: [18], popularity: 0 }),
    candidate(13, 'movie', { genreIds: [18, 28], popularity: 999999 }),
    candidate(14, 'movie', { relatedTo: ['tmdb:movie:2'], popularity: 0 }),
    candidate(15, 'movie', { relatedTo: ['tmdb:movie:1'], popularity: 0 }),
  ], context);
  assert.deepEqual(result.map(x => x.tmdbId), [15, 14, 13, 12, 10, 11]);
  assert.equal(result[2].recommendationReason, 'Fits your genres');
  assert.equal(result[5].recommendationReason, 'Popular picks');
});

test('fallback popularity ordering is bounded, finite and stable for ties', () => {
  const input = [candidate(1, 'movie', { popularity: 0 }), candidate(2, 'movie', { popularity: 100 }),
    candidate(3, 'movie', { popularity: 100 }), candidate(4, 'movie', { popularity: Infinity }),
    candidate(5, 'movie', { popularity: -3 }), candidate(6, 'movie', { popularity: Number.MAX_VALUE })];
  const result = rankRecommendations(input, state());
  assert.deepEqual(result.map(x => x.tmdbId), [6, 2, 3, 1, 4, 5]);
  assert.ok(result.every(x => Number.isFinite(x.score) && x.recommendationReason === 'Popular picks'));
  assert.deepEqual(rankRecommendations(input, state()), result);
});

test('duplicate candidates merge every related seed association before ranking without mutating inputs', () => {
  const context = state({ library: [candidate(1, 'movie', { status: 'plan_to_watch' }), candidate(2, 'movie', { liked: true, title: 'Liked seed' })] });
  context.preferences.genres.movie = [18, 28];
  const input = [candidate(10, 'movie', { relatedTo: ['tmdb:movie:1'], genreIds: [18], popularity: 1 }),
    candidate(11), candidate(10, 'movie', { relatedTo: ['tmdb:movie:2', 'tmdb:movie:1'], genreIds: [28], popularity: 99 })];
  const snapshot = structuredClone({ input, context });
  const result = rankRecommendations(input, context);
  assert.equal(result.length, 2);
  assert.equal(result[0].recommendationReason, 'Because you liked Liked seed');
  assert.deepEqual(result[0].relatedTo, ['tmdb:movie:1', 'tmdb:movie:2']);
  assert.deepEqual(result[0].genreIds, [18, 28]);
  assert.equal(result[0].popularity, 99);
  assert.deepEqual({ input, context }, snapshot);
  result[0].genreIds.push(99);
  result[0].relatedTo.push('tmdb:movie:99');
  assert.deepEqual({ input, context }, snapshot);
});

test('adult results are excluded even when only a duplicate marks them adult', () => {
  const input = [candidate(1, 'movie', { adult: true }), candidate(2), candidate(2, 'movie', { adult: true }),
    candidate(3, 'movie', { adult: false }), candidate(4, 'series')];
  assert.deepEqual(rankRecommendations(input, state()).map(x => x.tmdbId), [3, 4]);
});

const candidate = (id, format = 'movie', extra = {}) => ({ catalogueId: `tmdb:${format}:${id}`, provider: 'TMDB', tmdbId: id, title: `Title ${id}`, format, genreIds: [], ...extra });

test('only unseen identities in selected formats remain, including same-name remakes and separate series IDs', () => {
  const input = [candidate(1), candidate(1, 'series'), candidate(2), candidate(3), candidate(4, 'movie', { title: 'Title 1' })];
  const actual = rankRecommendations(input, state({ library: [candidate(1)], dismissed: ['tmdb:movie:2'] }));
  assert.deepEqual(actual.map(x => x.catalogueId), ['tmdb:series:1', 'tmdb:movie:3', 'tmdb:movie:4']);
  const movieOnly = state(); movieOnly.preferences.formats = ['movie'];
  assert.deepEqual(rankRecommendations(input, movieOnly).map(x => x.format), ['movie', 'movie', 'movie', 'movie']);
  assert.ok(actual.every(x => typeof x.score === 'number' && Number.isFinite(x.score) && typeof x.recommendationReason === 'string'));
});
