import test from 'node:test';
import assert from 'node:assert/strict';

// Explicit synthetic catalogue fixtures, never Fola's history.
const film = { catalogueId: 'tmdb:movie:101', tmdbId: 101, provider: 'TMDB', title: 'Test film', format: 'movie', year: '2001', posterUrl: null, sourceUrl: 'https://www.themoviedb.org/movie/101', genres: [{ id: 18, name: 'Drama' }], genreIds: [18], overview: 'A synthetic story about a drummer.' };
const state = () => ({ version: 1, onboarded: false, preferences: { region: 'NG', formats: ['movie', 'series'], genres: { movie: [], series: [] } }, library: [], dismissed: [], importDraft: null });

test('explicit Watch later choice adds the confirmed identity without inferring a like', async () => {
  const { applyTitleChoice } = await import('./library-actions.mjs');
  const draft = state();
  applyTitleChoice(draft, film, 'watch_later');
  assert.equal(draft.library.length, 1);
  assert.equal(draft.library[0].catalogueId, film.catalogueId);
  assert.equal(draft.library[0].status, 'plan_to_watch');
  assert.equal(draft.library[0].liked, false);
  assert.deepEqual(draft.library[0].genres, film.genres);
  assert.equal(draft.library[0].anime, null);
});

test('Watched updates one identity but preserves a separate like and metadata', async () => {
  const { applyTitleChoice } = await import('./library-actions.mjs');
  const draft = state();
  applyTitleChoice(draft, film, 'watch_later');
  draft.library[0].liked = true;
  applyTitleChoice(draft, film, 'watched');
  assert.equal(draft.library.length, 1);
  assert.equal(draft.library[0].status, 'watched');
  assert.equal(draft.library[0].liked, true);
});

test('Not for me hides once without creating or deleting library history', async () => {
  const { applyTitleChoice } = await import('./library-actions.mjs');
  const draft = state();
  applyTitleChoice(draft, film, 'not_for_me');
  applyTitleChoice(draft, film, 'not_for_me');
  assert.deepEqual(draft.dismissed, [film.catalogueId]);
  assert.equal(draft.library.length, 0);
  applyTitleChoice(draft, film, 'watched');
  assert.deepEqual(draft.dismissed, []);
  assert.throws(() => applyTitleChoice(draft, film, 'not_for_me'), /library/i);
  assert.equal(draft.library.length, 1);
  assert.throws(() => applyTitleChoice(draft, film, 'unknown'), /choice/i);
});

test('recommendation annotations never become user metadata; refresh preserves manual tags', async () => {
  const { applyTitleChoice, toLibraryEntry } = await import('./library-actions.mjs');
  const draft = state();
  applyTitleChoice(draft, { ...film, score: 99, relatedTo: ['tmdb:movie:9'], recommendationReason: 'Test reason' }, 'watched');
  assert.ok(!('score' in draft.library[0]));
  assert.ok(!('relatedTo' in draft.library[0]));
  draft.library[0].anime = true;
  draft.library[0].liked = true;
  const refreshed = toLibraryEntry({ ...film, anime: null }, draft.library[0]);
  assert.equal(refreshed.anime, true);
  assert.equal(refreshed.liked, true);
  assert.equal(refreshed.status, 'watched');
  assert.deepEqual(toLibraryEntry({ ...film, genreIds: undefined }, { ...draft.library[0], genreIds: [] }).genreIds, [18]);
});

test('starter candidates interleave formats without silently duplicating identities', async () => {
  const { interleaveResults } = await import('./catalogue-browser.mjs');
  const tv = { ...film, catalogueId: 'tmdb:series:101', format: 'series' };
  assert.deepEqual(interleaveResults([[film, film], [tv]], 10).map(item => item.catalogueId), [film.catalogueId, tv.catalogueId]);
});

test('default document is For you, with Library preserved as a separate route', async () => {
  const { readFile } = await import('node:fs/promises');
  const home = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(home, /src="home\.mjs"/);
  const library = await readFile(new URL('./library.html', import.meta.url), 'utf8');
  assert.match(library, /src="library\.mjs"/);
  assert.match(home, /href="library\.html"/);
});

test('recommendation requests use likes and Watch later, not merely watched seeds', async () => {
  const { positiveSeeds, enrichGenres, fetchJSON } = await import('./catalogue-browser.mjs');
  const draft = state();
  draft.library = [{ ...film, status: 'watched', liked: false }, { ...film, catalogueId: 'tmdb:movie:102', tmdbId: 102, status: 'plan_to_watch', liked: false }, { ...film, catalogueId: 'tmdb:movie:103', tmdbId: 103, status: 'watched', liked: true }];
  assert.deepEqual(positiveSeeds(draft).map(seed => seed.tmdbId), [103, 102]);
  assert.deepEqual(enrichGenres({ ...film, genres: undefined }, { movie: film.genres, series: [] }).genres, film.genres);
  await assert.rejects(fetchJSON('/api/genres', {}, async () => Response.json({ error: 'Synthetic offline error' }, { status: 503 })), /Synthetic offline error/);
});
