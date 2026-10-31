// Repeatable checks: only the two owned synthetic fixture origins, never live 8766.
export function assertFixtureOrigin() {
  if (!['http://127.0.0.1:8767', 'http://127.0.0.1:8768'].includes(location.origin)) throw new Error('Synthetic fixture origin required.');
}
export function checkOnboardingAppearance() {
  assertFixtureOrigin();
  const checks = [];
  const check = (value, name) => checks.push({ name, passed: Boolean(value) });
  const skip = document.getElementById('preferences-skip');
  const style = getComputedStyle(skip);
  check(style.borderTopWidth === '0px' && style.backgroundColor === 'rgba(0, 0, 0, 0)', 'preferences-only action is borderless text');
  check(getComputedStyle(skip, '::after').content.includes('→'), 'preferences-only action has an arrow');
  check(document.querySelector('fieldset legend').textContent === 'What do you watch?', 'plain-language viewing question');
  const labels = [...document.querySelectorAll('[name="format"]')].map(input => input.closest('label').getBoundingClientRect());
  check(labels[1].left - labels[0].right >= 9 || labels[1].top - labels[0].bottom >= 9, 'Movies and Series have a visible gap');
  check(skip.getBoundingClientRect().height >= 44, 'text action retains a touch target');
  return { checks, passed: checks.filter(check => check.passed).length, failed: checks.filter(check => !check.passed).length, synthetic: true };
}
export function checkPageFocus() {
  assertFixtureOrigin();
  const main = document.getElementById('main-content');
  const search = document.getElementById('search');
  const original = document.activeElement;
  try {
    search.focus();
    main.focus();
    const mainStyle = getComputedStyle(main);
    const noPageOutline = mainStyle.outlineStyle === 'none' || mainStyle.outlineWidth === '0px';
    search.focus();
    const searchStyle = getComputedStyle(search);
    const visibleControlFocus = search.matches(':focus-visible') && searchStyle.outlineStyle !== 'none' && parseFloat(searchStyle.outlineWidth) >= 2;
    const checks = [
      { name: 'main stays a working skip-link destination', passed: main.tabIndex === -1 },
      { name: 'focused main does not outline the entire page', passed: noPageOutline },
      { name: 'search retains its visible keyboard focus indicator', passed: visibleControlFocus },
    ];
    return { checks, passed: checks.filter(check => check.passed).length, failed: checks.filter(check => !check.passed).length, synthetic: true };
  } finally { original?.focus(); }
}
export async function checkDialogClose() {
  assertFixtureOrigin();
  const dialog = document.querySelector('dialog[open]');
  if (!dialog) throw new Error('Open a title dialog before checking its close control.');
  const button = dialog.querySelector('.dialog-heading button');
  const rect = button.getBoundingClientRect();
  const icon = button.querySelector('svg');
  const iconRect = icon?.getBoundingClientRect();
  const style = getComputedStyle(button);
  const { appStore } = await import('./app.mjs');
  const before = appStore.exportJSON();
  const checks = [];
  const check = (value, name) => checks.push({ name, passed: Boolean(value) });
  check(button.getAttribute('aria-label') === 'Close title dialog', 'close has an accessible name');
  check(rect.width === 44 && rect.height === 44, 'close uses a compact 44px square target');
  check(style.paddingLeft === style.paddingRight, 'close padding is balanced');
  check(icon?.getAttribute('aria-hidden') === 'true' && iconRect.width === 20 && iconRect.height === 20, 'close uses a decorative 20px cross icon');
  check(iconRect && Math.abs((iconRect.left + iconRect.width / 2) - (rect.left + rect.width / 2)) < 1 && Math.abs((iconRect.top + iconRect.height / 2) - (rect.top + rect.height / 2)) < 1, 'cross is centered in its target');
  button.focus();
  check(document.activeElement === button, 'close remains keyboard focusable');
  button.click();
  await new Promise(resolve => setTimeout(resolve, 30));
  check(!dialog.open, 'close dismisses the dialog');
  check(appStore.exportJSON() === before, 'close does not save a viewing choice');
  return { checks, passed: checks.filter(check => check.passed).length, failed: checks.filter(check => !check.passed).length, synthetic: true };
}
export function checkHomeSurface() {
  assertFixtureOrigin();
  const assert = (value, message) => { if (!value) throw new Error(message); };
  assert(document.title.includes('For you'), 'Home document title');
  assert(document.querySelector('h1')?.textContent === 'For you', 'Home heading');
  for (const id of ['home-grid', 'home-search', 'home-retry', 'home-feedback']) assert(document.getElementById(id), id);
  assert(document.querySelector('a[href="library.html"]'), 'Separate library');
  return { checks: 7, synthetic: true };
}
export async function checkOnboardingSurface() {
  assertFixtureOrigin();
  const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('Timed out waiting for onboarding'); };
  if (!document.getElementById('preferences-form')) throw new Error('Preferences stage missing');
  await wait(() => document.querySelectorAll('#genre-chips button').length > 0);
  document.querySelector('#genre-chips button').click();
  document.querySelector('#preferences-next').click();
  await wait(() => document.querySelectorAll('#starter-grid article').length === 10);
  const cards = [...document.querySelectorAll('#starter-grid article')];
  const ids = cards.slice(0, 3).map(card => card.dataset.catalogueId);
  cards[0].querySelector('[data-choice="watch_later"]').click();
  document.querySelectorAll('#starter-grid article')[1].querySelector('[data-choice="watched"]').click();
  document.querySelectorAll('#starter-grid article')[2].querySelector('[data-choice="not_for_me"]').click();
  const { appStore } = await import('./app.mjs');
  if (appStore.getState().library.length !== 0 || appStore.getState().dismissed.length !== 0) throw new Error('Choices persisted before Finish');
  document.querySelector('#starter-back').click();
  document.querySelector('#preferences-next').click();
  await wait(() => !document.querySelector('#starter-stage').hidden);
  if (document.querySelectorAll('#starter-grid [aria-pressed="true"]').length !== 3) throw new Error('Back lost staged choices');
  return { checks: 5, ids, synthetic: true };
}
export async function checkHomeFlow() {
  assertFixtureOrigin();
  const checks = [];
  const assert = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
  const wait = async predicate => { for (let i = 0; i < 150; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Home flow timed out'); };
  await wait(() => document.querySelector('#home-grid article'));
  const { appStore } = await import('./app.mjs');
  const state = appStore.getState();
  assert(state.library.length === 2 && state.dismissed.length === 1, 'mixed staged choices committed atomically');
  assert(state.library.every(item => item.liked === false), 'watched is not implicitly liked');
  const excluded = [...state.library.map(item => item.catalogueId), ...state.dismissed];
  assert([...document.querySelectorAll('#home-grid article')].every(card => !excluded.includes(card.dataset.catalogueId)), 'saved and hidden identities excluded');
  const search = document.querySelector('#home-search');
  for (const [term, shouldMatch] of [['Test drama', true], ['drummer', true], ['2001', true], ['no-fixture-match', false]]) {
    search.value = term; search.dispatchEvent(new Event('input'));
    assert(Boolean(document.querySelector('#home-grid article')) === shouldMatch, `actual metadata search: ${term}`);
  }
  const format = document.querySelector('#home-format');
  search.value = '2001 movie'; format.value = 'series'; format.dispatchEvent(new Event('change'));
  assert(!document.querySelector('#home-grid article'), 'format combines with year search');
  format.value = 'movie'; format.dispatchEvent(new Event('change'));
  assert(Boolean(document.querySelector('#home-grid article')) && !document.querySelector('#home-feedback').textContent.includes('No matches'), 'format recovery clears stale empty message');
  format.value = ''; search.value = ''; search.dispatchEvent(new Event('input'));
  const before = document.querySelector('#home-grid article').dataset.catalogueId;
  document.querySelector('#home-next').click();
  await wait(() => !document.querySelector('#home-next').disabled);
  assert(document.querySelector('#home-grid article').dataset.catalogueId !== before, 'Next advances the real discovery page');
  const cover = document.querySelector('#home-grid .poster-button');
  const id = document.querySelector('#home-grid article').dataset.catalogueId;
  const [, kind, tmdbId] = id.split(':');
  const opened = appStore.exportJSON(); cover.focus();
  assert(cover.tagName === 'A', 'recommendation cover is a native page link');
  assert(cover.getAttribute('href') === `title.html?format=${kind}&id=${tmdbId}`, 'recommendation links the exact movie or TV identity');
  assert(appStore.exportJSON() === opened && !document.querySelector('dialog[open]'), 'browsing creates no viewing history or search popup');
  const choice = document.querySelector('#home-grid [data-choice="watch_later"]'); choice.focus(); choice.click();
  await wait(() => document.activeElement === document.querySelector('#home-search'));
  assert(document.activeElement.id === 'home-search', 'saving restores focus after opener card is removed');
  assert(appStore.getState().library.some(item => item.catalogueId === id), 'quick action persists via strict schema');
  assert(!document.querySelector(`#home-grid [data-catalogue-id="${id}"]`), 'quick save removes card');
  const setItem = Storage.prototype.setItem;
  const snapshot = appStore.exportJSON();
  try {
    Storage.prototype.setItem = () => { throw new DOMException('Synthetic quota failure', 'QuotaExceededError'); };
    document.querySelector('#home-grid [data-choice="watched"]').click();
    assert(appStore.exportJSON() === snapshot, 'failed storage write leaves state unchanged');
    assert(document.querySelector('#home-feedback').textContent.includes('Could not save'), 'storage error is visible');
  } finally { Storage.prototype.setItem = setItem; }
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => String(url).startsWith('/api/') ? Response.json({ error: 'Synthetic unavailable API' }, { status: 503 }) : originalFetch(url, options);
    document.querySelector('#home-next').click();
    await wait(() => !document.querySelector('#home-retry').hidden);
    assert(Boolean(document.querySelector('#home-grid article')), 'API outage retains last successful picks');
    assert(document.querySelector('#home-feedback').textContent.includes('could not load'), 'API outage honest retry message');
  } finally { globalThis.fetch = originalFetch; }
  document.querySelector('#home-retry').click();
  await wait(() => document.querySelector('#home-retry').hidden && !document.querySelector('#home-next').disabled);
  assert(Boolean(document.querySelector('#home-grid article')), 'retry recovers catalogue');
  return { checks: checks.length, passed: checks, synthetic: true };
}
if (typeof process !== 'undefined' && process.versions?.node) {
  // Node has no user browser store; avoid its experimental localStorage getter.
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {} } });
  const { test } = await import('node:test');
  const assert = (await import('node:assert/strict')).default;
  const { readFile } = await import('node:fs/promises');
  test('discovery keeps partial successes, enriches actual genres and bounds positive seeds', async () => {
    const { loadCandidateBatch } = await import('./app.mjs');
    const calls = [];
    const candidate = { catalogueId: 'tmdb:movie:8', format: 'movie', genreIds: [18] };
    const result = await loadCandidateBatch({ formats: ['movie', 'series'], genres: { movie: [18], series: [] } }, {
      lists: { movie: [{ id: 18, name: 'Drama' }], series: [] },
      seeds: Array.from({ length: 5 }, (_, index) => ({ format: 'movie', tmdbId: index + 1, catalogueId: `tmdb:movie:${index + 1}` })),
      fetchImpl: async url => { calls.push(url); return url.includes('series') ? Response.json({ error: 'Unavailable' }, { status: 503 }) : Response.json({ results: [candidate], page: 1, totalPages: 3 }); },
    });
    assert.equal(result.errors.length, 1);
    assert.equal(result.candidates[0].genres[0].name, 'Drama');
    assert.equal(calls.filter(url => url.includes('/recommendations')).length, 3);
    assert.equal(result.hasMore, true);
  });
  test('duplicate discovery and seed results retain recommendation provenance', async () => {
    const { loadCandidateBatch } = await import('./app.mjs');
    const candidate = { catalogueId: 'tmdb:movie:8', format: 'movie', genreIds: [18] };
    const result = await loadCandidateBatch({ formats: ['movie'], genres: { movie: [], series: [] } }, {
      seeds: [{ format: 'movie', tmdbId: 2, catalogueId: 'tmdb:movie:2' }],
      fetchImpl: async () => Response.json({ results: [candidate], page: 1, totalPages: 1 }),
    });
    assert.equal(result.candidates.length, 1);
    assert.deepEqual(result.candidates[0].relatedTo, ['tmdb:movie:2']);
  });
  test('recommendation home has its own module and separate Library route', async () => {
    const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
    assert.match(html, /src="home.mjs"/);
    assert.match(html, /href="library.html"/);
    for (const id of ['home-grid', 'home-search', 'home-retry', 'home-feedback']) assert.ok(html.includes(`id="${id}"`), id);
  });
}
