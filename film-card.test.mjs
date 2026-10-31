import test from 'node:test';
import assert from 'node:assert/strict';
import * as cards from './film-card.mjs';

test('cover destinations distinguish movies and series with the same numeric identity', () => {
  assert.equal(typeof cards.titlePageHref, 'function');
  assert.equal(cards.titlePageHref({ format: 'movie', tmdbId: 671, catalogueId: 'tmdb:movie:671' }), 'title.html?format=movie&id=671');
  assert.equal(cards.titlePageHref({ format: 'series', tmdbId: 671, catalogueId: 'tmdb:series:671' }), 'title.html?format=series&id=671');
});

test('cover destinations reject malformed and mismatched identities rather than normalizing them', () => {
  assert.equal(typeof cards.titlePageHref, 'function');
  for (const candidate of [null, {}, { format: 'anime', tmdbId: 1, catalogueId: 'tmdb:anime:1' },
    { format: 'movie', tmdbId: '671', catalogueId: 'tmdb:movie:671' },
    { format: 'movie', tmdbId: 671, catalogueId: 'tmdb:series:671' },
    { format: 'movie', tmdbId: 671, catalogueId: 'tmdb:movie:0671' },
    { format: 'movie', tmdbId: 0, catalogueId: 'tmdb:movie:0' },
    { format: 'movie', tmdbId: Number.MAX_SAFE_INTEGER + 1, catalogueId: `tmdb:movie:${Number.MAX_SAFE_INTEGER + 1}` }]) {
    assert.equal(cards.titlePageHref(candidate), null);
  }
});
