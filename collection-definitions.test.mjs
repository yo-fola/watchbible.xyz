import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTIONS } from './collection-definitions.mjs';

test('pilot retains the bounded six-film Phase One roster with explicit movie identities', () => {
  assert.equal(new Set(COLLECTIONS.map(collection => collection.id)).size, COLLECTIONS.length);
  const collection = COLLECTIONS.find(collection => collection.id === 'mcu-phase-one');
  assert.equal(collection.id, 'mcu-phase-one');
  assert.equal(collection.version, 1);
  assert.deepEqual(collection.members.map(item => item.tmdbId), [1726, 1724, 10138, 10195, 1771, 24428]);
  assert.equal(new Set(collection.members.map(item => item.catalogueId)).size, 6);
  assert.deepEqual(collection.tiers, [1, 3, 5]);
  assert.ok(collection.tiers.every(value => value <= collection.members.length));
  for (const item of collection.members) {
    assert.equal(item.catalogueId, `tmdb:movie:${item.tmdbId}`);
    assert.equal(item.provider, 'TMDB');
    assert.equal(item.format, 'movie');
    assert.ok(item.title && item.year && item.overview && item.genres.length);
    assert.match(item.posterUrl, /^https:\/\/image\.tmdb\.org\/t\/p\/w500\/[\w]+\.jpg$/);
    assert.deepEqual(item.genreIds, item.genres.map(genre => genre.id));
    assert.equal('status' in item, false, 'catalogue members are not viewing history');
  }
});

test('Harry Potter collection contains exactly eight original films in release order, not Fantastic Beasts or TV', () => {
  const collection = COLLECTIONS.find(collection => collection.id === 'harry-potter');
  assert.ok(collection, 'Harry Potter collection exists');
  assert.equal(collection.version, 1);
  assert.deepEqual(collection.members.map(item => item.tmdbId), [671, 672, 673, 674, 675, 767, 12444, 12445]);
  assert.deepEqual(collection.members.map(item => item.year), ['2001', '2002', '2004', '2005', '2007', '2009', '2010', '2011']);
  assert.equal(new Set(collection.members.map(item => item.catalogueId)).size, 8);
  assert.deepEqual(collection.tiers, [2, 4, 7]);
  for (const item of collection.members) {
    assert.equal(item.catalogueId, `tmdb:movie:${item.tmdbId}`);
    assert.equal(item.format, 'movie');
    assert.equal(item.provider, 'TMDB');
    assert.ok(item.overview && item.genres.length && item.genres.every(genre => genre.name));
    assert.match(item.posterUrl, /^https:\/\/image\.tmdb\.org\/t\/p\/w500\/[A-Za-z0-9_-]+\.jpg$/);
    assert.equal('status' in item, false);
  }
});
