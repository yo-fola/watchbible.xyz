import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { pageBounds, pageWindow } from './pagination-model.mjs';
import { rankRecommendations } from './recommendation-model.mjs';
import { filterLibrary } from './library-model.mjs';
import * as libraryActions from './library-actions.mjs';
const { applyTitleChoice } = libraryActions;
import { positiveSeeds, enrichGenres, interleaveResults } from './catalogue-browser.mjs';

const candidate = id => ({ catalogueId: `tmdb:movie:${id}`, tmdbId: id, provider: 'TMDB', title: `Title ${id}`, format: 'movie', genreIds: [] });
const tick = () => new Promise(resolve => setImmediate(resolve));
function element() {
  return { value: '', hidden: false, disabled: false, children: [], attributes: {}, listeners: {}, textContent: '',
    addEventListener(type, fn) { this.listeners[type] = fn; },
    setAttribute(key, value) { this.attributes[key] = value; },
    replaceChildren(...items) { this.children = items; }, append(item) { this.children.push(item); },
    focus() {}, contains() { return false; },
    fire(type) { this.listeners[type]?.({ preventDefault() {} }); },
  };
}
async function harness(file, { failure = false, storageFailure = false, deferMetadata = false } = {}) {
  const nodes = new Map(), events = new Map(), requests = [], navigations = [], metadata = [];
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  get('home-format').value = ''; get('starter-stage').hidden = true;
  const formats = [Object.assign(element(), { value: 'movie', checked: true })];
  let state = { onboarded: true, preferences: { region: 'NG', formats: ['movie'], genres: { movie: [], series: [] } }, library: [], dismissed: [] };
  let disk = structuredClone(state); const subscribers = [];
  const store = {
    loadError: failure ? new Error('invalid storage') : null,
    getState: () => structuredClone(state), subscribe(fn) { subscribers.push(fn); },
    refresh() {
      if (storageFailure) { this.loadError = new Error('storage unavailable'); throw this.loadError; }
      const changed = JSON.stringify(state) !== JSON.stringify(disk); state = structuredClone(disk);
      if (changed) for (const fn of subscribers) fn(); return changed;
    },
    transact(fn) { if (this.loadError) throw this.loadError; fn(state); disk = structuredClone(state); for (const cb of subscribers) cb(); },
  };
  const context = vm.createContext({ structuredClone, AbortController, URLSearchParams, Map, Set, console,
    createAppStore: () => store, appStore: store, pageBounds, pageWindow, rankRecommendations, filterLibrary,
    positiveSeeds, enrichGenres, interleaveResults, applyTitleChoice, setTitleLike: libraryActions.setTitleLike,
    createFilmCard: (item, options) => ({ ...item, options }),
    fetchJSON: (path, options) => deferMetadata ? new Promise(resolve => metadata.push({ path, options, resolve })) : Promise.resolve(path.includes('regions') ? { regions: [] } : { movie: [], series: [] }),
    loadCandidateBatch: (preferences, options) => new Promise(resolve => requests.push({ options, preferences: structuredClone(preferences), resolve })),
    document: { getElementById: get, createElement: element, querySelectorAll: selector => selector.includes('format') ? formats.filter(x => !selector.includes(':checked') || x.checked) : [], activeElement: null },
    window: { addEventListener(type, fn) { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); }, scrollTo() {} },
    location: { replace(url) { navigations.push(url); }, assign(url) { navigations.push(url); } },
  });
  const app = (await readFile(new URL('./app.mjs', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace('export const appStore', 'const appStore').replace('export async function', 'async function');
  // App's DOM navigation mounting is unrelated to lifecycle; exercise its actual window hook without a document.
  const document = context.document; context.document = undefined;
  context.loadCandidateBatchStub = context.loadCandidateBatch;
  vm.runInContext(app, context); context.document = document;
  // Keep the real app lifecycle hook but inject deferred catalogue requests for deterministic races.
  vm.runInContext('loadCandidateBatch = loadCandidateBatchStub;', context);
  vm.runInContext((await readFile(new URL(`./${file}.mjs`, import.meta.url), 'utf8')).replace(/^import .*;\n/gm, ''), context);
  return { get, requests, store, navigations, metadata, disk: fn => { fn(disk); },
    event(type, persisted) { for (const fn of events.get(type) || []) fn(persisted === undefined ? { type } : { type, persisted }); },
    async resolve(index, ids = [index + 1], errors = []) { requests[index].options.totals.set('movie', 5); requests[index].resolve({ candidates: ids.map(candidate), errors, hasMore: true }); await tick(); },
  };
}

test('Home Like explicitly adds taste without pretending a title was watched or queued', async () => {
  const h = await harness('home'); await h.resolve(0,[1,2]);
  const card=h.get('home-grid').children[0];assert.equal(typeof card.options.onLike,'function');
  card.options.onLike(candidate(1));
  const saved=h.store.getState().library[0];assert.equal(saved.liked,true);assert.equal(saved.status,null);
  assert.equal(saved.personalRating,undefined);
  assert.deepEqual(h.get('home-grid').children.map(item=>item.catalogueId),['tmdb:movie:2']);
});

test('Home resumes interrupted Next after persisted Back and unlocks controls', async () => {
  const h = await harness('home'); await h.resolve(0);
  h.get('home-next').fire('click'); assert.equal(h.requests[1].options.page, 2);
  h.event('pagehide', true); assert.equal(h.requests[1].options.signal.aborted, true);
  h.event('pageshow', true);
  assert.equal(h.requests.length, 3, 'interrupted latest page must restart');
  await h.resolve(2, [3]);
  assert.equal(h.get('home-next').disabled, false);
  assert.equal(h.get('home-grid').attributes['aria-busy'], 'false');
  assert.equal(h.get('home-grid').children[0].catalogueId, 'tmdb:movie:3');
  await h.resolve(1, [99]);
  assert.equal(h.get('home-grid').children[0].catalogueId, 'tmdb:movie:3', 'old response stays ignored');
});

test('persisted Home refreshes title-page exclusions before rendering without reloading unchanged recommendations', async () => {
  const h = await harness('home'); await h.resolve(0, [1, 2]);
  h.event('pagehide', true);
  h.disk(state => { state.library.push({ ...candidate(1), status: 'watched', liked: false }); });
  h.event('pageshow', true);
  assert.equal(h.store.getState().library.length, 1);
  assert.deepEqual(h.get('home-grid').children.map(x => x.catalogueId), ['tmdb:movie:2']);
  assert.equal(h.requests.length, 1);
});

test('Home invalidates recommendation pages for fresh preferences and positive seeds', async () => {
  for (const change of [state => { state.preferences.genres.movie = [12]; }, state => { state.library.push({ ...candidate(8), status: 'plan_to_watch', liked: false }); }]) {
    const h = await harness('home'); await h.resolve(0);
    h.get('home-next').fire('click'); await h.resolve(1);
    h.event('pagehide', true); h.disk(change); h.event('pageshow', true);
    assert.equal(h.requests.length, 3, 'recommendations must reload after changed inputs');
    assert.equal(h.requests[2].options.page, 1);
    await h.resolve(2, [5]); h.get('home-next').fire('click');
    assert.equal(h.requests.length, 4, 'old page two cache must be invalidated');
  }
});

test('explicit Home Refresh retains its page after a positive seed changes while invalidating old caches', async () => {
  const h = await harness('home'); await h.resolve(0, [1, 2]);
  h.get('home-next').fire('click'); await h.resolve(1, [20, 21]);
  h.get('home-grid').children[0].options.onChoice('watch_later', candidate(20));
  h.get('home-refresh').fire('click');
  assert.equal(h.requests[2].options.page, 2, 'explicit Refresh must not jump to page one');
  assert.equal(h.requests[2].options.seeds[0].catalogueId, 'tmdb:movie:20', 'refresh uses the newly saved positive seed');
  await h.resolve(2, [20, 22]);
  assert.deepEqual(h.get('home-grid').children.map(item => item.catalogueId), ['tmdb:movie:22'], 'saved title remains excluded');
  h.get('home-prev').fire('click');
  assert.equal(h.requests.length, 4, 'old page-one cache was invalidated');
  assert.equal(h.requests[3].options.page, 1);
});

test('Onboarding persisted Back unlocks Finish while preserving staged choices and fresh title history', async () => {
  const h = await harness('onboarding'); await tick();
  h.get('preferences-form').fire('submit'); await h.resolve(0, [1, 2]);
  const cards = h.get('starter-grid').children;
  cards[0].options.onChoice('watch_later', candidate(1));
  cards[1].options.onChoice('watched', candidate(2));
  h.event('pagehide', true);
  h.disk(state => { state.library.push({ ...candidate(1), status: 'watched', liked: true, personalRating: 9 }); });
  h.event('pageshow', true);
  assert.match(h.get('starter-count').textContent, /2 pending choices/);
  h.get('onboarding-finish').fire('click');
  assert.equal(h.navigations.at(-1), 'index.html', 'Finish must not stay locked after Back');
  const saved = h.store.getState().library;
  assert.equal(saved.length, 2);
  assert.equal(saved.find(x => x.tmdbId === 1).status, 'watched');
  assert.equal(saved.find(x => x.tmdbId === 1).personalRating, 9);
});

test('Onboarding resumes only interrupted starter target and ignores old completion', async () => {
  const h = await harness('onboarding'); await tick();
  h.get('preferences-form').fire('submit'); await h.resolve(0);
  h.get('starter-more').fire('click');
  h.event('pagehide', true); h.event('pageshow', true);
  assert.equal(h.requests.length, 3);
  assert.equal(h.requests[2].options.page, 2);
  await h.resolve(2, [3]); await h.resolve(1, [99]);
  assert.equal(h.get('starter-more').disabled, false);
  assert.equal(h.get('starter-grid').children[0].tmdbId, 3);
  h.event('pagehide', true); h.event('pageshow', true);
  assert.equal(h.requests.length, 3, 'completed batch does not reload');
});

test('generic and nonpersisted pageshow do not refresh storage or restart aborted loads', async () => {
  const h = await harness('home'); h.event('pagehide');
  h.disk(state => { state.dismissed.push('tmdb:movie:1'); });
  h.event('pageshow'); h.event('pageshow', false);
  assert.equal(h.store.getState().dismissed.length, 0);
  assert.equal(h.requests.length, 1);
  await h.resolve(0, [99]);
  assert.equal(h.get('home-grid').children.length, 0);
});

test('initial invalid storage stays protected without starting catalogue or replacing history', async () => {
  for (const file of ['home', 'onboarding']) {
    const h = await harness(file, { failure: true });
    h.event('pageshow');
    assert.equal(h.requests.length, 0);
    assert.equal(h.navigations.length, 0);
    assert.match(h.get(file === 'home' ? 'home-feedback' : 'onboarding-feedback').textContent, /not been overwritten/);
  }
});

test('persisted storage read failures show recovery and never resume requests', async () => {
  for (const file of ['home', 'onboarding']) {
    const h = await harness(file, { storageFailure: true });
    if (file === 'onboarding') { await tick(); h.get('preferences-form').fire('submit'); }
    h.event('pagehide', true);
    assert.doesNotThrow(() => h.event('pageshow', true));
    assert.equal(h.get(file === 'home' ? 'home-recovery' : 'onboarding-recovery').hidden, false);
    assert.match(h.get(file === 'home' ? 'home-feedback' : 'onboarding-feedback').textContent, /storage|Saved data/);
    assert.equal(h.requests.length, 1);
  }
});

test('Onboarding aborts and resumes interrupted metadata without accepting stale responses', async () => {
  const h = await harness('onboarding', { deferMetadata: true });
  h.event('pagehide', true);
  assert.equal(h.metadata[0].options?.signal.aborted, true);
  h.event('pageshow', true);
  assert.equal(h.metadata.length, 4);
  h.metadata[2].resolve({ movie: [{ id: 1, name: 'Fresh' }], series: [] });
  h.metadata[3].resolve({ regions: [] }); await tick();
  h.metadata[0].resolve({ movie: [{ id: 2, name: 'Stale' }], series: [] });
  h.metadata[1].resolve({ regions: [] }); await tick();
  assert.equal(h.get('genre-chips').children[0].textContent, 'Fresh');
  h.event('pagehide', true); h.event('pageshow', true);
  assert.equal(h.metadata.length, 4, 'completed metadata does not reload');
});

test('ordinary catalogue failures retain Home Retry and preferences-only Finish', async () => {
  const home = await harness('home'); await home.resolve(0, [], [new Error('unavailable')]);
  assert.equal(home.get('home-retry').hidden, false);
  assert.equal(home.get('home-retry').disabled, false);
  home.get('home-retry').fire('click'); assert.equal(home.requests.length, 2);
  const onboarding = await harness('onboarding'); await tick();
  onboarding.get('preferences-form').fire('submit'); await onboarding.resolve(0, [], [new Error('unavailable')]);
  assert.equal(onboarding.get('starter-retry').hidden, false);
  onboarding.get('onboarding-finish').fire('click');
  assert.equal(onboarding.navigations.at(-1), 'index.html');
  assert.equal(onboarding.store.getState().library.length, 0);
});
