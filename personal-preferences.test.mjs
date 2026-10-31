import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppStore, STORAGE_KEY } from './app-state.mjs';
import * as actions from './library-actions.mjs';

function storage(raw = null) {
  let value = raw;
  return { getItem: () => value, setItem(key, text) { assert.equal(key, STORAGE_KEY); value = text; }, raw: () => value };
}
const candidate = (id = 1726) => ({ provider: 'TMDB', catalogueId: `tmdb:movie:${id}`, tmdbId: id,
  title: 'Synthetic title', format: 'movie', year: '2008', posterUrl: null,
  sourceUrl: `https://www.themoviedb.org/movie/${id}`, overview: '', genres: [], genreIds: [] });

test('explicit likes create no viewing history or XP and preserve saved metadata', () => {
  assert.equal(typeof actions.setTitleLike, 'function');
  const store = createAppStore(storage());
  store.transact(d => { d.dismissed = [candidate().catalogueId]; actions.setTitleLike(d, candidate(), false); });
  assert.deepEqual(store.getState().library, []);
  store.transact(d => actions.setTitleLike(d, candidate(), true));
  const saved = store.getState().library[0];
  assert.equal(saved.status, null); assert.equal(saved.liked, true);
  assert.deepEqual(store.getState().dismissed, []);
  assert.deepEqual(store.getState().gamification.credits, []);
  assert.deepEqual(store.getState().gamification.awards, []);
  store.transact(d => actions.setTitleLike(d, { ...candidate(), title: 'Do not overwrite' }, false));
  assert.deepEqual(store.getState().library[0], { ...saved, liked: false });
  for (const bad of [null, 1, 'true', undefined]) {
    const draft = store.getState(); const before = structuredClone(draft);
    assert.throws(() => actions.setTitleLike(draft, candidate(), bad));
    assert.deepEqual(draft, before);
  }
});

test('explicit personal ratings use strict five-star values without likes, status or XP inference', () => {
  assert.equal(typeof actions.setPersonalRating, 'function');
  const store = createAppStore(storage());
  store.transact(d => actions.setPersonalRating(d, candidate(), null));
  assert.deepEqual(store.getState().library, []);
  for (const value of [1, 5, null]) {
    store.transact(d => actions.setPersonalRating(d, candidate(), value));
    const saved = store.getState().library[0];
    assert.equal(saved.personalRating, value); assert.equal(saved.personalRatingScale, 5);
    assert.equal(saved.status, null); assert.equal(saved.liked, false);
    assert.deepEqual(store.getState().gamification.credits, []);
    assert.deepEqual(store.getState().gamification.awards, []);
  }
  for (const value of [0, 6, 1.5, NaN, Infinity, '5', undefined]) {
    const draft = store.getState(); const before = structuredClone(draft);
    assert.throws(() => actions.setPersonalRating(draft, candidate(), value));
    assert.deepEqual(draft, before, 'invalid input must not mutate even a plain draft');
    assert.throws(() => store.transact(d => { d.library[0].personalRating = value; }));
  }
  const draft = store.getState(); draft.library[0].status = 'watching'; draft.library[0].liked = true;
  actions.setPersonalRating(draft, { ...candidate(), title: 'Do not overwrite' }, 3);
  assert.equal(draft.library[0].status, 'watching'); assert.equal(draft.library[0].liked, true);
  assert.equal(draft.library[0].title, 'Synthetic title');
});

test('display converts legacy ratings without reinterpreting or mutating stored values', () => {
  assert.equal(typeof actions.getPersonalRating, 'function');
  for (const [value, expected] of [[0, 0], [3, 1.5], [8.5, 4.25], [9, 4.5], [10, 5], [null, null]]) {
    const entry = { personalRating: value }; const before = structuredClone(entry);
    assert.equal(actions.getPersonalRating(entry), expected);
    assert.deepEqual(entry, before);
  }
  assert.equal(actions.getPersonalRating({ personalRating: 3, personalRatingScale: 5 }), 3);
  for (const entry of [null, {}, { personalRating: NaN }, { personalRating: 11 },
    { personalRating: 0, personalRatingScale: 5 }, { personalRating: 1.5, personalRatingScale: 5 },
    { personalRating: 3, personalRatingScale: 10 }]) assert.equal(actions.getPersonalRating(entry), null);
});

test('catalogue refresh preserves explicit null status and the rating scale without changing unsaved defaults', () => {
  const existing = { ...actions.toLibraryEntry(candidate()), status: null, personalRating: 3, personalRatingScale: 5 };
  const refreshed = actions.toLibraryEntry(candidate(), existing);
  assert.equal(refreshed.status, null); assert.equal(refreshed.personalRating, 3);
  assert.equal(refreshed.personalRatingScale, 5);
  assert.equal(actions.toLibraryEntry(candidate()).status, 'plan_to_watch');
  const legacy = actions.toLibraryEntry(candidate(), { ...existing, personalRating: 9, personalRatingScale: undefined });
  assert.equal(legacy.personalRating, 9); assert.equal('personalRatingScale' in legacy, false);
});

test('v4 supports preference-only null status, backup restore and rejects malformed old null status', () => {
  const disk = storage(); const store = createAppStore(disk);
  assert.equal(store.getState().version, 4);
  store.transact(d => d.library.push({ ...candidate(), anime: null, liked: true, status: null }));
  const backup = store.exportJSON();
  const target = createAppStore(storage()); target.restoreJSON(backup);
  assert.deepEqual(target.getState(), store.getState());
  assert.deepEqual(target.getState().gamification.credits, []);
  for (const version of [1, 2, 3, 5]) {
    const bad = store.getState(); bad.version = version;
    if (version < 3) delete bad.episodeProgress;
    if (version < 2) delete bad.gamification;
    assert.throws(() => target.restoreJSON(JSON.stringify(bad)));
  }
});

test('v1 v2 v3 migration preserves legacy ratings, history and preferences without initial writes', () => {
  const source = createAppStore(storage());
  source.transact(d => {
    d.preferences.region = 'GB';
    d.library.push({ ...actions.toLibraryEntry(candidate()), status: 'watched', personalRating: 9 });
    d.episodeProgress.push({ seriesId: 1, seasonNumber: 1, episodeNumber: 1, episodeId: 10, status: 'watched' });
    d.importDraft = { text: 'pending', entries: [{ originalLine: 'pending', title: 'pending', status: null }] };
  });
  for (const version of [1, 2, 3]) {
    const old = source.getState(); old.version = version;
    if (version < 3) delete old.episodeProgress;
    if (version < 2) delete old.gamification;
    const raw = JSON.stringify(old); const disk = storage(raw);
    disk.setItem = () => assert.fail('migration must not write');
    const store = createAppStore(disk);
    assert.equal(store.loadError, null); assert.equal(store.getState().version, 4);
    assert.deepEqual(store.getState().library, old.library);
    assert.deepEqual(store.getState().preferences, old.preferences);
    assert.deepEqual(store.getState().importDraft, old.importDraft);
    if (version >= 2) assert.deepEqual(store.getState().gamification, old.gamification);
    if (version === 3) assert.deepEqual(store.getState().episodeProgress, old.episodeProgress);
    const restored = createAppStore(storage()); restored.restoreJSON(store.exportJSON());
    assert.equal(restored.getState().library[0].personalRating, 9);
    assert.equal('personalRatingScale' in restored.getState().library[0], false);
    assert.equal(actions.getPersonalRating(restored.getState().library[0]), 4.5);
    assert.equal(disk.raw(), raw);
  }
});

test('saved statuses and ratings survive likes while explicit rating changes preserve likes', () => {
  for (const status of [null, 'watching', 'watched', 'plan_to_watch']) {
    const draft = createAppStore(storage()).getState();
    const entry = { ...actions.toLibraryEntry(candidate()), status, liked: false, personalRating: 9 };
    draft.library.push(entry);
    actions.setTitleLike(draft, candidate(), true);
    assert.deepEqual(entry, { ...actions.toLibraryEntry(candidate()), status, liked: true, personalRating: 9 });
    actions.setPersonalRating(draft, candidate(), 5);
    assert.equal(entry.status, status); assert.equal(entry.liked, true);
    actions.setPersonalRating(draft, candidate(), null);
    assert.equal(entry.personalRating, null); assert.equal(entry.personalRatingScale, 5);
    assert.equal(entry.status, status); assert.equal(entry.liked, true);
  }
});

test('preference writes and v4 rating backups remain transactional on quota failure', () => {
  const disk = storage(); const store = createAppStore(disk);
  store.transact(d => { actions.setPersonalRating(d, candidate(), 5); actions.setTitleLike(d, candidate(), true); });
  const before = store.getState(); const raw = disk.raw();
  const restored = createAppStore(storage()); restored.restoreJSON(store.exportJSON());
  assert.deepEqual(restored.getState(), before);
  assert.deepEqual(createAppStore(disk).getState(), before);
  let notifications = 0; store.subscribe(() => notifications++);
  disk.setItem = () => { throw new Error('QuotaExceededError'); };
  for (const change of [d => actions.setTitleLike(d, candidate(), false),
    d => actions.setPersonalRating(d, candidate(), 1), d => actions.setPersonalRating(d, candidate(), null)]) {
    assert.throws(() => store.transact(change), /Quota/);
    assert.deepEqual(store.getState(), before); assert.equal(disk.raw(), raw);
  }
  assert.equal(notifications, 0);
});

test('invalid scale metadata and future version five are recoverable and rejected before writes', () => {
  const store = createAppStore(storage());
  for (const scale of [null, 0, 10, '5']) {
    assert.throws(() => store.transact(d => d.library.push({ ...actions.toLibraryEntry(candidate()), personalRating: 3, personalRatingScale: scale })));
  }
  assert.throws(() => store.transact(d => d.library.push({ ...actions.toLibraryEntry(candidate()), personalRatingScale: 5 })));
  const future = store.getState(); future.version = 5;
  const raw = JSON.stringify(future); const disk = storage(raw); const broken = createAppStore(disk);
  assert.ok(broken.loadError); assert.equal(broken.exportJSON(), raw); assert.equal(disk.raw(), raw);
  assert.throws(() => broken.transact(() => {}));
});
