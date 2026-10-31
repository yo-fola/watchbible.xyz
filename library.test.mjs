import test from 'node:test';
import assert from 'node:assert/strict';

// Synthetic test fixtures, not catalogue records or Fola's viewing history.
const fixtures = [
  { title: 'Example film', format: 'movie', anime: false, status: 'watched' },
  { title: 'Example anime film', format: 'movie', anime: true, status: 'plan_to_watch' },
  { title: 'Example anime series', format: 'series', anime: true, status: 'watching' },
];

test('search and independent library filters combine without changing entries', async () => {
  const { filterLibrary } = await import('./library-model.mjs');
  assert.deepEqual(filterLibrary(fixtures, {}), fixtures);
  assert.deepEqual(filterLibrary(fixtures, { query: ' FILM ', format: 'movie', anime: true, status: 'plan_to_watch' }), [fixtures[1]]);
  assert.deepEqual(filterLibrary(fixtures, { format: 'series', anime: true }), [fixtures[2]]);
  assert.deepEqual(filterLibrary(fixtures, { query: 'no match' }), []);
  assert.equal(fixtures.length, 3);
});

test('sorts titles without changing stored insertion order', async () => {
  const { sortLibrary } = await import('./library-model.mjs');
  const input = [{ title: 'Zulu' }, { title: 'alpha' }, { title: 'Bravo' }];
  assert.deepEqual(sortLibrary(input, 'title').map(entry => entry.title), ['alpha', 'Bravo', 'Zulu']);
  assert.deepEqual(sortLibrary(input, 'newest').map(entry => entry.title), ['Bravo', 'alpha', 'Zulu']);
  assert.deepEqual(input.map(entry => entry.title), ['Zulu', 'alpha', 'Bravo']);
});

test('library search combines real genre, year, synopsis and independent anime metadata', async () => {
  const { filterLibrary } = await import('./library-model.mjs');
  const entry = { ...fixtures[0], year: '2001', genres: [{ id: 18, name: 'Drama' }], overview: 'A synthetic story about a drummer.' };
  assert.deepEqual(filterLibrary([entry], { query: 'drama drummer 2001' }), [entry]);
  assert.deepEqual(filterLibrary([entry], { query: 'comedy 2001' }), []);
  assert.deepEqual(filterLibrary(fixtures, { query: 'anime series' }), [fixtures[2]]);
});
