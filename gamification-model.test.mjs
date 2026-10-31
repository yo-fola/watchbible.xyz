import test from 'node:test';
import assert from 'node:assert/strict';

// Synthetic records only; no real viewing history or catalogue requests.
const now = '2026-10-29T12:00:00.000Z';
const movie = (id, extra = {}) => ({ catalogueId: `tmdb:movie:${id}`, format: 'movie', status: 'watched', genres: [], genreIds: [], anime: null, ...extra });
const state = (library = []) => ({ library, gamification: { profile: { displayName: '' }, followed: [], credits: [], awards: [] } });

test('movie progress is pure and historical movies await explicit XP recognition', async () => {
  const { getProgress, recognizeHistory } = await import('./gamification-model.mjs');
  const saved = state([movie(1), movie(2), { ...movie(1), catalogueId: 'tmdb:series:1', format: 'series' }]);
  const before = structuredClone(saved);
  const progress = getProgress(saved, { collections: [] });
  assert.deepEqual(saved, before);
  assert.equal(progress.xp, 0);
  assert.equal(progress.level, 1);
  assert.equal(progress.levelXP, 0);
  assert.equal(progress.nextLevelXP, 500);
  assert.equal(progress.watchedMovies, 2);
  assert.deepEqual(progress.pendingRecognition, ['tmdb:movie:1', 'tmdb:movie:2']);
  recognizeHistory(saved, ['tmdb:movie:1', 'tmdb:movie:1', 'tmdb:series:1', 'tmdb:movie:99'], now);
  assert.deepEqual(saved.gamification.credits, [{ catalogueId: 'tmdb:movie:1', recognizedAt: now }]);
  assert.equal(getProgress(saved, { collections: [] }).xp, 100);
  assert.deepEqual(getProgress(saved, { collections: [] }).pendingRecognition, ['tmdb:movie:2']);
});

test('explicit movie transitions grant one credit; corrections and rewatches recalculate levels', async () => {
  const { getProgress, syncGamification } = await import('./gamification-model.mjs');
  const previous = state([movie(99)]);
  const next = structuredClone(previous);
  next.library.push(...Array.from({ length: 5 }, (_, i) => movie(i + 1)),
    { ...movie(1), catalogueId: 'tmdb:series:1', format: 'series', episodes: 500 });
  syncGamification(previous, next, now, { collections: [] });
  assert.equal(getProgress(next).xp, 500);
  assert.equal(getProgress(next).level, 2);
  assert.equal(getProgress(next).levelXP, 0);
  assert.deepEqual(getProgress(next).pendingRecognition, ['tmdb:movie:99']);
  const repeat = structuredClone(next);
  repeat.library[1].liked = true;
  syncGamification(next, repeat, now, { collections: [] });
  assert.deepEqual(repeat.gamification.credits, next.gamification.credits);
  const corrected = structuredClone(repeat);
  corrected.library[1].status = 'plan_to_watch';
  syncGamification(repeat, corrected, now, { collections: [] });
  assert.equal(getProgress(corrected).xp, 400);
  assert.equal(getProgress(corrected).level, 1);
  assert.equal(getProgress(corrected).levelXP, 400);
  const rewatched = structuredClone(corrected);
  rewatched.library[1].status = 'watched';
  syncGamification(corrected, rewatched, now, { collections: [] });
  assert.equal(getProgress(rewatched).xp, 500);
  assert.equal(rewatched.gamification.credits.length, 5);
});

test('collection badges use distinct scoped movie identities with a separate nonempty Set Complete', async () => {
  const { getCollectionProgress, getProgress } = await import('./gamification-model.mjs');
  const collection = { id: 'synthetic-set', name: 'Synthetic set', version: 1, tiers: [1, 3, 5],
    members: Array.from({ length: 6 }, (_, i) => movie(i + 1)) };
  const saved = state([movie(1), movie(2), movie(3), movie(4), movie(5), movie(6, { status: 'watching' }),
    { ...movie(6), catalogueId: 'tmdb:series:6', format: 'series' }]);
  assert.deepEqual(getCollectionProgress(saved, { ...collection, members: [...collection.members, movie(1)] }),
    { watched: 5, total: 6, percent: 5 / 6 * 100, complete: false });
  const badges = getProgress(saved, { collections: [collection] }).badges.filter(badge => badge.family === 'franchise');
  assert.deepEqual(badges.map(badge => [badge.tier, badge.target, badge.count, badge.earned]),
    [['bronze', 1, 5, true], ['silver', 3, 5, true], ['gold', 5, 5, true], ['complete', 6, 5, false]]);
  assert.ok(badges.every(badge => badge.scope === collection.id && badge.earnedAt === null && badge.description));
  saved.library[5].status = 'watched';
  assert.equal(getCollectionProgress(saved, collection).complete, true);
  assert.deepEqual(getCollectionProgress(saved, { ...collection, members: [] }), { watched: 0, total: 0, percent: 0, complete: false });
  assert.equal(getProgress(saved, { collections: [{ ...collection, members: [] }] }).badges.some(badge => badge.tier === 'complete'), false);
  const overlap = { ...collection, id: 'overlap' };
  assert.equal(getProgress(saved, { collections: [collection, overlap] }).badges.filter(badge => badge.tier === 'complete' && badge.earned).length, 2);
  assert.equal(getProgress(saved).xp, 0);
});

test('genre and type tiers require actual movie metadata, never anime guesses or series episode totals', async () => {
  const { getProgress } = await import('./gamification-model.mjs');
  for (const count of [0, 4, 5, 14, 15, 29, 30]) {
    const saved = state(Array.from({ length: count }, (_, i) => movie(i + 1, {
      genreIds: [18, 18, 16], genres: [{ id: 18, name: 'Drama' }, { id: 16, name: 'Animation' }], anime: true,
    })));
    saved.library.push(movie(100, { status: 'plan_to_watch', anime: true }),
      { ...movie(101, { anime: true }), catalogueId: 'tmdb:series:101', format: 'series', episodes: 300 });
    const badges = getProgress(saved, { collections: [] }).badges;
    for (const scope of ['genre:18', 'genre:16', 'movie', 'anime']) {
      assert.deepEqual(badges.filter(badge => badge.scope === scope).map(badge => [badge.target, badge.count, badge.earned]),
        [5, 15, 30].map(target => [target, count, count >= target]));
    }
    assert.ok(badges.filter(badge => badge.scope === 'genre:35').every(badge => badge.count === 0));
  }
  const animation = state(Array.from({ length: 5 }, (_, i) => movie(i + 1, { genreIds: [16], anime: null, title: 'Anime-looking title' })));
  assert.ok(getProgress(animation).badges.filter(badge => badge.scope === 'anime').every(badge => !badge.earned));
});

test('awards persist recognition evidence across version growth but revoke corrected history', async () => {
  const { getProgress, syncGamification } = await import('./gamification-model.mjs');
  const collection = { id: 'synthetic-set', name: 'Synthetic', version: 1, tiers: [1, 3, 5], members: Array.from({ length: 6 }, (_, i) => movie(i + 1)) };
  const previous = state(); const next = state(collection.members);
  syncGamification(previous, next, now, { collections: [collection] });
  const award = next.gamification.awards.find(a => a.id.endsWith('complete:v1'));
  assert.equal(award.earnedAt, now); assert.equal(award.evidence.length, 6);
  assert.equal(getProgress(next, { collections: [collection] }).badges.find(b => b.id === award.id).earnedAt, now);
  const grown = { ...collection, version: 2, members: [...collection.members, movie(7)] };
  const after = structuredClone(next);
  syncGamification(next, after, '2026-10-30T12:00:00.000Z', { collections: [grown] });
  assert.deepEqual(after.gamification.awards.find(a => a.id === award.id), award);
  const badges = getProgress(after, { collections: [grown] }).badges;
  assert.equal(badges.find(b => b.id === award.id).earned, true);
  assert.equal(badges.find(b => b.id.endsWith('complete:v2')).earned, false);
  const corrected = structuredClone(after); corrected.library[0].status = 'watching';
  syncGamification(after, corrected, now, { collections: [grown] });
  assert.equal(corrected.gamification.awards.some(a => a.id === award.id), false);
  assert.equal(getProgress(corrected).xp, 500);
});
