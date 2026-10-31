import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Title document loads shared tokens, detail and episode styles with dedicated mount', async () => {
  const html = await readFile(new URL('./title.html', import.meta.url), 'utf8').catch(() => '');
  assert.match(html, /id="title-page"/);
  for (const file of ['theme.css', 'title-panel.css', 'series.css', 'title-page.css', 'title-page.mjs']) assert.ok(html.includes(file), file);
  assert.match(html, /<main[^>]+id="main-content"/);
});

test('Dedicated title route accepts only canonical safe movie/series identities', async () => {
  const module = await import('./title-page.mjs').catch(() => ({}));
  assert.equal(typeof module.parseTitleRoute, 'function', 'route parser must exist');
  const parse = query => module.parseTitleRoute(new URL(`https://example.test/title.html?${query}`));
  assert.deepEqual(parse('format=movie&id=671'), { format: 'movie', tmdbId: 671, catalogueId: 'tmdb:movie:671' });
  assert.deepEqual(parse('format=series&id=95396'), { format: 'series', tmdbId: 95396, catalogueId: 'tmdb:series:95396' });
  assert.equal(parse('format=movie&id=1%0A'), null, 'trailing newline must not normalize to a valid ID');
  for (const query of ['format=tv&id=1', 'format=movie&id=01', 'format=movie&id=-1', 'format=movie&id=1.2', 'format=movie&id=9007199254740992', 'format=movie', 'id=1', 'format=movie&id=1&id=2', 'format=movie&format=series&id=1']) assert.equal(parse(query), null, query);
});
