import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, createAppStore } from './app-state.mjs';

function memoryStorage(raw = null) {
  let value = raw;
  return { getItem: () => value, setItem(key, text) { assert.equal(key, STORAGE_KEY); value = text; }, raw: () => value };
}
function entry(id = 1, format = 'movie', extra = {}) {
  return { provider: 'TMDB', catalogueId: `tmdb:${format}:${id}`, tmdbId: id, title: 'A title', format,
    year: '2020', posterUrl: null, sourceUrl: `https://www.themoviedb.org/${format === 'series' ? 'tv' : 'movie'}/${id}`,
    overview: '', genreIds: [], genres: [], anime: null, liked: false, status: 'watched', ...extra };
}
test('transactions persist preferences and independent movie/series identities across recreation', () => {
  const storage = memoryStorage();
  const store = createAppStore(storage);
  let retainedDraft;
  store.transact(draft => {
    retainedDraft = draft;
    draft.onboarded = true;
    draft.preferences = { region: 'GB', formats: ['series'], genres: { movie: [28], series: [18] } };
    draft.library.push(entry(1), entry(1, 'series'));
  });
  retainedDraft.library.length = 0;
  const recreated = createAppStore(storage);
  assert.equal(recreated.getState().onboarded, true);
  assert.equal(recreated.getState().preferences.region, 'GB');
  assert.equal(recreated.getState().library.length, 2);
  assert.deepEqual(recreated.getState(), store.getState());
});

test('transactions validate complete root/preferences/draft data before any write', () => {
  const invalid = [
    d => { d.version = 999; }, d => { delete d.library; }, d => { d.onboarded = 1; },
    d => { d.preferences.region = 'ng'; }, d => { d.preferences.region = 'NGA'; },
    d => { d.preferences.formats = []; }, d => { d.preferences.formats = ['anime']; },
    d => { d.preferences.genres.movie = [0]; }, d => { d.preferences.genres.series = ['18']; },
    d => { d.importDraft = { text: 'raw', entries: [{ originalLine: 'raw', title: 'edit', status: 'bad' }] }; },
    d => { d.importDraft = { text: 1, entries: [] }; },
    d => { d.dismissed = ['tmdb:movie:0']; }, d => { d.dismissed = ['movie:1']; },
    d => { d.password = 'not allowed'; }, d => { d.preferences.token = 'not allowed'; },
    d => { d.importDraft = { text: '', entries: [{ originalLine: 'raw', title: 'edit' }] }; },
  ];
  for (const change of invalid) {
    const storage = memoryStorage(); const store = createAppStore(storage);
    assert.throws(() => store.transact(change), Error, change.toString());
    assert.equal(storage.raw(), null);
    assert.deepEqual(store.getState(), defaults());
  }
});

test('library validation rejects inconsistent identities, duplicates, unsafe URLs and unsupported metadata atomically', () => {
  const invalid = [
    e => { e.tmdbId = 0; }, e => { e.catalogueId = 'tmdb:series:1'; }, e => { e.provider = 'IMDb'; },
    e => { e.tmdbId = 2; }, e => { e.format = 'anime'; }, e => { e.title = ''; },
    e => { delete e.overview; }, e => { e.status = 'liked'; }, e => { e.anime = 'yes'; },
    e => { e.liked = 1; }, e => { e.year = 2020; }, e => { e.genreIds = [1.5]; },
    e => { e.genres = [{ id: -1, name: 'bad' }]; }, e => { e.posterUrl = 'javascript:alert(1)'; },
    e => { e.sourceUrl = 'https://user:secret@example.com/a'; }, e => { e.posterUrl = 'data:text/html,x'; },
    e => { e.sourceUrl = 'file:///private'; }, e => { e.apiKey = 'secret'; },
    e => { e.personalRating = 11; }, e => { e.runtimeMinutes = -1; }, e => { e.seasons = 1.2; },
    e => { e.episodes = '3'; }, e => { e.imdbId = 'fake'; }, e => { e.fetchedAt = 'yesterday'; },
    e => { e.backdropUrl = 'javascript:bad'; },
  ];
  for (const change of invalid) {
    const storage = memoryStorage(); const store = createAppStore(storage);
    assert.throws(() => store.transact(d => { const item = entry(); change(item); d.library.push(item); }), Error, change.toString());
    assert.equal(storage.raw(), null);
  }
  const store = createAppStore(memoryStorage());
  assert.throws(() => store.transact(d => d.library.push(entry(), entry())), Error);
  store.transact(d => d.library.push(entry(1), entry(2)));
  assert.equal(store.getState().library.length, 2, 'same-title remakes remain distinct');
});

test('subscriptions observe only committed writes and can unsubscribe', () => {
  const storage = memoryStorage(); const store = createAppStore(storage);
  const observed = [];
  const unsubscribe = store.subscribe(() => observed.push(JSON.parse(storage.raw()).onboarded));
  store.transact(d => { d.onboarded = true; });
  assert.deepEqual(observed, [true]);
  assert.throws(() => store.transact(d => { d.onboarded = 'wrong'; }));
  assert.throws(() => store.transact(() => { throw new Error('cancel'); }));
  const previous = storage.raw();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => store.transact(d => { d.onboarded = false; }), /Quota/);
  assert.equal(storage.raw(), previous);
  assert.equal(store.getState().onboarded, true);
  assert.deepEqual(observed, [true]);
  storage.setItem = (key, value) => { assert.equal(key, STORAGE_KEY); assert.equal(typeof value, 'string'); };
  unsubscribe();
  store.transact(d => { d.onboarded = false; });
  assert.deepEqual(observed, [true]);
});

test('corrupt or unsupported stored data stays recoverable and blocks transactions', () => {
  for (const raw of ['{broken', 'null', '[]', JSON.stringify({ ...defaults(), version: 999 }), JSON.stringify({ ...defaults(), library: [entry(), entry()] })]) {
    const storage = memoryStorage(raw); const store = createAppStore(storage);
    assert.ok(store.loadError instanceof Error);
    assert.deepEqual(store.getState(), defaults());
    assert.equal(store.exportJSON(), raw);
    assert.throws(() => store.transact(d => { d.onboarded = true; }));
    assert.equal(storage.raw(), raw);
  }
});

test('inaccessible storage exposes defaults plus loadError without a write', () => {
  let writes = 0;
  const store = createAppStore({ getItem() { throw new Error('SecurityError'); }, setItem() { writes++; } });
  assert.ok(store.loadError instanceof Error);
  assert.deepEqual(store.getState(), defaults());
  assert.throws(() => store.transact(d => { d.onboarded = true; }));
  assert.equal(writes, 0);
});

test('full export/restore preserves optional metadata and original-line edits with no invented rating', () => {
  const source = createAppStore(memoryStorage());
  source.transact(d => {
    d.onboarded = true;
    d.preferences.region = 'US';
    d.library = [entry(1, 'series', { anime: true, liked: true, status: 'watching', personalRating: 8.5,
      genres: [{ id: 16, name: 'Animation' }], genreIds: [16], fetchedAt: '2026-10-29T10:00:00.000Z',
      runtimeMinutes: 24, seasons: 2, episodes: 12, imdbId: 'tt1234567', backdropUrl: 'https://image.tmdb.org/t/p/original/test.jpg' }), entry(2, 'movie', { personalRating: null }), entry(3)];
    d.dismissed = ['tmdb:movie:9'];
    d.importDraft = { text: '  Original [watched]\r\nNext', entries: [
      { originalLine: '  Original [watched]', title: 'Edited title', status: 'plan_to_watch' },
      { originalLine: 'Next', title: 'Next edit', status: null },
    ] };
  });
  const storage = memoryStorage('{broken'); const target = createAppStore(storage);
  let notifications = 0; target.subscribe(() => notifications++);
  target.restoreJSON(source.exportJSON());
  assert.equal(target.loadError, null);
  assert.deepEqual(target.getState(), source.getState());
  assert.deepEqual(createAppStore(storage).getState(), source.getState());
  assert.equal(notifications, 1);
  assert.equal('personalRating' in target.getState().library[2], false);
  target.transact(d => { d.preferences.region = 'NG'; });
});

test('restore rejects any invalid entry/version/type without partial replacement or writes', () => {
  const storage = memoryStorage(); const store = createAppStore(storage);
  store.transact(d => { d.onboarded = true; });
  const before = store.exportJSON(); const rawBefore = storage.raw();
  for (const invalid of ['', 'null', '[]', '1', '{}', JSON.stringify({ ...defaults(), version: 999 }),
    JSON.stringify({ ...defaults(), library: [entry(), { ...entry(2), liked: 'yes' }] }),
    JSON.stringify({ ...defaults(), preferences: { ...defaults().preferences, region: 'bad' } })]) {
    assert.throws(() => store.restoreJSON(invalid));
    assert.equal(store.exportJSON(), before);
    assert.equal(storage.raw(), rawBefore);
  }
  assert.throws(() => store.restoreJSON(defaults()));
});

test('failed recovery write preserves the original unreadable data and loadError', () => {
  const storage = memoryStorage('original broken'); const store = createAppStore(storage);
  const error = store.loadError;
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => store.restoreJSON(JSON.stringify(defaults())), /quota/);
  assert.equal(store.loadError, error);
  assert.equal(store.exportJSON(), 'original broken');
  assert.equal(storage.raw(), 'original broken');
  assert.deepEqual(store.getState(), defaults());
});

test('dismissals dedupe independently without adding negative choices to the library', () => {
  const store = createAppStore(memoryStorage());
  store.transact(d => { d.dismissed = ['tmdb:movie:1', 'tmdb:movie:1', 'tmdb:series:1']; });
  assert.deepEqual(store.getState().dismissed, ['tmdb:movie:1', 'tmdb:series:1']);
  assert.deepEqual(store.getState().library, []);
});

test('only plain non-executable whitelisted data can enter state', () => {
  const store = createAppStore(memoryStorage());
  let executed = false;
  const changes = [
    d => { d.preferences = Object.create({ region: 'NG' }); },
    d => { Object.defineProperty(d, 'onboarded', { enumerable: true, get() { executed = true; return true; } }); },
    d => { d[Symbol('secret')] = 'hidden'; },
    d => { d.library = Array(1); },
    d => { d.preferences.genres.movie = Array(1); },
    d => { d.preferences.toJSON = () => { executed = true; return {}; }; },
  ];
  for (const change of changes) assert.throws(() => store.transact(change));
  assert.equal(executed, false);
  const polluted = JSON.stringify(defaults()).replace('"version":4', '"version":4,"__proto__":{"polluted":true}');
  assert.throws(() => store.restoreJSON(polluted));
  assert.equal({}.polluted, undefined);
});

test('default browser storage denial is caught inside store initialization', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    const store = createAppStore();
    assert.match(store.loadError.message, /SecurityError/);
    assert.deepEqual(store.getState(), defaults());
    assert.throws(() => store.transact(() => {}), /SecurityError/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('ISO metadata requires a real calendar timestamp and accepts explicit timezone offsets', () => {
  const store = createAppStore(memoryStorage());
  for (const fetchedAt of ['2026-02-30T10:00:00.000Z', '2026-10-29T25:00:00Z', '2026-10-29T10:00:00+25:00']) {
    assert.throws(() => store.transact(d => d.library.push(entry(1, 'movie', { fetchedAt }))));
  }
  store.transact(d => d.library.push(entry(1, 'movie', { fetchedAt: '2026-10-29T10:00:00+01:00' })));
  assert.equal(store.getState().library[0].fetchedAt, '2026-10-29T10:00:00+01:00');
});

test('URLs cannot smuggle credential query parameters into local storage', () => {
  const store = createAppStore(memoryStorage());
  for (const [field, url] of [
    ['sourceUrl', 'https://example.com/title?api_key=secret'],
    ['posterUrl', 'https://example.com/poster?access_token=secret'],
    ['backdropUrl', 'https://example.com/image?password=secret'],
  ]) assert.throws(() => store.transact(d => d.library.push(entry(1, 'movie', { [field]: url }))));
});

const defaults = () => ({ version: 4, onboarded: false, preferences: { region: 'NG', formats: ['movie', 'series'], genres: { movie: [], series: [] } }, library: [], dismissed: [], importDraft: null, episodeProgress: [],
  gamification: { profile: { displayName: '' }, followed: [], credits: [], awards: [] } });

test('defaults are readable defensive copies without writing storage', () => {
  const storage = memoryStorage();
  const store = createAppStore(storage);
  assert.equal(STORAGE_KEY, 'watchbible:data:v1');
  assert.deepEqual(store.getState(), defaults());
  store.getState().preferences.formats.pop();
  assert.deepEqual(store.getState(), defaults());
  assert.equal(store.loadError, null);
  assert.equal(storage.raw(), null);
});

test('validated v1 migrates in memory without writing or inventing XP, then commits v4', () => {
  const legacy = defaults(); delete legacy.gamification; delete legacy.episodeProgress; legacy.version = 1;
  legacy.library = [entry(1726)]; legacy.importDraft = { text: 'pending', entries: [] };
  const raw = JSON.stringify(legacy); const storage = memoryStorage(raw); const store = createAppStore(storage);
  assert.equal(store.loadError, null);
  assert.equal(store.getState().version, 4);
  assert.deepEqual(store.getState().gamification, defaults().gamification);
  assert.equal(storage.raw(), raw);
  store.transact(d => { d.gamification.profile.displayName = 'Viewer'; d.gamification.followed = ['mcu-phase-one']; });
  assert.equal(JSON.parse(storage.raw()).version, 4);
  assert.deepEqual(store.getState().gamification.credits, []);
  assert.equal(createAppStore(storage).getState().gamification.profile.displayName, 'Viewer');
});

test('movie credits and awards commit atomically, survive restore, and recalculate on corrections', async () => {
  const { getProgress, recognizeHistory } = await import('./gamification-model.mjs');
  const storage = memoryStorage(); const store = createAppStore(storage);
  store.transact(d => d.library.push(entry(1726), entry(1, 'series', { episodes: 999 })));
  assert.equal(getProgress(store.getState()).xp, 100);
  assert.equal(store.getState().gamification.awards.length, 1);
  const backup = store.exportJSON(); const target = createAppStore(memoryStorage());
  target.restoreJSON(backup); target.restoreJSON(backup);
  assert.equal(getProgress(target.getState()).xp, 100);
  const before = store.getState(); const raw = storage.raw();
  storage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => store.transact(d => { d.library[0].status = 'watching'; }), /quota/);
  assert.deepEqual(store.getState(), before); assert.equal(storage.raw(), raw);
  target.transact(d => { d.library[0].status = 'watching'; });
  assert.equal(getProgress(target.getState()).xp, 0); assert.deepEqual(target.getState().gamification.awards, []);
  target.transact(d => { d.library[0].status = 'watched'; });
  target.transact(d => recognizeHistory(d, ['tmdb:movie:1726']));
  assert.equal(getProgress(target.getState()).xp, 100);
});

test('strict gamification validation rejects names, references, duplicate credits, dates and award evidence before writes', () => {
  const source = createAppStore(memoryStorage()); source.transact(d => d.library.push(entry(1726)));
  const good = source.getState();
  const invalid = [
    d => { d.gamification.profile.displayName = 'x'.repeat(61); },
    d => { d.gamification.profile.displayName = ' name '; },
    d => { d.gamification.followed = ['unknown']; },
    d => { d.gamification.followed = ['mcu-phase-one', 'mcu-phase-one']; },
    d => { d.gamification.credits = [{ catalogueId: 'tmdb:series:1', recognizedAt: '2026-10-29T12:00:00Z' }]; },
    d => { d.gamification.credits.push({ ...d.gamification.credits[0] }); },
    d => { d.gamification.credits[0].recognizedAt = '2026-02-30T10:00:00Z'; },
    d => { d.gamification.credits[0].extra = true; },
    d => { d.gamification.awards[0].id = 'unknown'; },
    d => { d.gamification.awards[0].definitionVersion = 999; },
    d => { d.gamification.awards[0].earnedAt = 'yesterday'; },
    d => { d.gamification.awards[0].evidence = ['tmdb:movie:999']; },
    d => { d.gamification.awards[0].eligibleIds = ['tmdb:movie:999']; },
    d => { d.gamification.awards.push({ ...d.gamification.awards[0] }); },
  ];
  for (const change of invalid) {
    const storage = memoryStorage(JSON.stringify(good)); const store = createAppStore(storage); const before = storage.raw();
    assert.throws(() => store.transact(change), Error, change.toString()); assert.equal(storage.raw(), before);
    const broken = structuredClone(good); change(broken);
    assert.throws(() => store.restoreJSON(JSON.stringify(broken)), Error, change.toString());
    assert.deepEqual(store.getState(), good);
  }
});

test('v1 restore migrates without credits and malformed legacy data remains recoverable', async () => {
  const { getProgress, recognizeHistory } = await import('./gamification-model.mjs');
  const legacy = defaults(); delete legacy.gamification; delete legacy.episodeProgress; legacy.version = 1; legacy.library = [entry(1726)];
  const store = createAppStore(memoryStorage()); store.restoreJSON(JSON.stringify(legacy));
  assert.equal(getProgress(store.getState()).xp, 0);
  store.transact(d => recognizeHistory(d, ['tmdb:movie:1726'], '2026-10-29T12:00:00Z'));
  assert.equal(getProgress(store.getState()).xp, 100);
  assert.equal(store.getState().gamification.credits[0].recognizedAt, '2026-10-29T12:00:00Z');
  legacy.library[0].liked = 'invalid'; const raw = JSON.stringify(legacy); const broken = createAppStore(memoryStorage(raw));
  assert.ok(broken.loadError); assert.equal(broken.exportJSON(), raw);
});

test('transaction version accessors never execute before full validation', () => {
  const store = createAppStore(memoryStorage()); let executed = false;
  assert.throws(() => store.transact(d => {
    Object.defineProperty(d, 'version', { enumerable: true, get() { executed = true; return 2; } });
  }));
  assert.equal(executed, false);
});

test('v4 episode state defaults and v2 migration preserve history without writes or invented episodes', () => {
  assert.equal(createAppStore(memoryStorage()).getState().version, 4);
  for (const version of [1, 2]) {
    const legacy = defaults(); legacy.version = version; delete legacy.episodeProgress;
    if (version === 1) delete legacy.gamification;
    legacy.library = [entry(1, 'series')];
    const raw = JSON.stringify(legacy); const storage = memoryStorage(raw); const store = createAppStore(storage);
    assert.equal(store.loadError, null);
    assert.equal(store.getState().version, 4);
    assert.deepEqual(store.getState().episodeProgress, []);
    assert.deepEqual(store.getState().gamification, defaults().gamification);
    assert.equal(storage.raw(), raw);
  }
});

test('episode evidence is strictly validated, uniquely identified, and independent of library presence', () => {
  const record = { seriesId: 1, seasonNumber: 0, episodeNumber: 1, episodeId: 101, status: 'watched' };
  const invalid = [
    d => { delete d.episodeProgress; }, d => { d.episodeProgress = {}; },
    ...['seriesId', 'episodeId', 'episodeNumber'].flatMap(key => [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1].map(value =>
      d => { d.episodeProgress[0][key] = value; })),
    ...[-1, 0.5, '0'].map(value => d => { d.episodeProgress[0].seasonNumber = value; }),
    d => { d.episodeProgress[0].status = 'plan_to_watch'; },
    d => { d.episodeProgress[0].extra = true; },
    d => { d.episodeProgress.push({ ...record, seriesId: 2 }); },
    d => { d.episodeProgress.push({ ...record, episodeId: 102 }); },
    d => { d.episodeProgress[0] = new Date(); },
  ];
  for (const change of invalid) {
    const storage = memoryStorage(); const store = createAppStore(storage);
    assert.throws(() => store.transact(d => { d.episodeProgress = [{ ...record }]; change(d); }));
    assert.equal(storage.raw(), null);
    const broken = defaults(); broken.episodeProgress = [{ ...record }]; change(broken);
    assert.throws(() => store.restoreJSON(JSON.stringify(broken)));
  }
  const storage = memoryStorage(); const store = createAppStore(storage);
  store.transact(d => { d.episodeProgress = [record]; d.library = [entry(1, 'series')]; });
  store.transact(d => { d.library = [entry(2, 'series')]; });
  assert.deepEqual(createAppStore(storage).getState().episodeProgress, [record]);
  const restored = createAppStore(memoryStorage()); restored.restoreJSON(store.exportJSON());
  assert.deepEqual(restored.getState().episodeProgress, [record]);
});

test('v2 migration preserves existing movie recognition and rejects episode data on legacy schemas', () => {
  const source = createAppStore(memoryStorage()); source.transact(d => d.library.push(entry(1726)));
  const legacy = source.getState(); legacy.version = 2; delete legacy.episodeProgress;
  const disk = memoryStorage(JSON.stringify(legacy)); const store = createAppStore(disk);
  assert.equal(store.loadError, null);
  assert.deepEqual(store.getState().gamification, source.getState().gamification);
  assert.equal(disk.raw(), JSON.stringify(legacy));
  store.transact(d => { d.preferences.region = 'US'; });
  assert.equal(JSON.parse(disk.raw()).version, 4);
  legacy.episodeProgress = [];
  assert.ok(createAppStore(memoryStorage(JSON.stringify(legacy))).loadError);
});

test('shared stores reject stale region, library and episode edits without overwriting persistence', () => {
  for (const change of [
    d => { d.preferences.region = 'US'; },
    d => { d.library.push(entry(1726)); },
    d => { d.episodeProgress.push({ seriesId: 1, seasonNumber: 1, episodeNumber: 1, episodeId: 101, status: 'watched' }); },
  ]) {
    const storage = memoryStorage();
    const first = createAppStore(storage); const stale = createAppStore(storage);
    first.transact(change);
    const raw = storage.raw(); const before = stale.getState();
    assert.throws(() => stale.transact(d => { d.gamification.profile.displayName = 'Viewer'; }), /stale.*refresh|changed.*reload/i);
    assert.equal(storage.raw(), raw);
    assert.deepEqual(stale.getState(), before);
    first.transact(d => { d.onboarded = true; });
    assert.equal(first.getState().onboarded, true, 'own last committed raw is current');
  }
});

test('restore rejects external changes, including replacement of corrupt recovery data', () => {
  for (const original of [null, '{original broken']) {
    const storage = memoryStorage(original); const store = createAppStore(storage);
    const before = store.getState(); const error = store.loadError;
    storage.setItem(STORAGE_KEY, '{external private text');
    assert.throws(() => store.restoreJSON(JSON.stringify(defaults())), error =>
      /Stale.*Refresh/i.test(error.message) && !error.message.includes('private'));
    assert.equal(storage.raw(), '{external private text');
    assert.deepEqual(store.getState(), before);
    assert.equal(store.loadError, error);
  }
  const storage = memoryStorage('{broken'); const store = createAppStore(storage);
  store.restoreJSON(JSON.stringify(defaults()));
  store.transact(d => { d.preferences.region = 'US'; });
  assert.equal(createAppStore(storage).getState().preferences.region, 'US');
});

test('refresh synchronously reloads shared history without writes or invented recognition', () => {
  const storage = memoryStorage(); const first = createAppStore(storage); const second = createAppStore(storage);
  let notifications = 0; second.subscribe(() => notifications++);
  assert.equal(second.refresh(), false);
  first.transact(d => {
    d.preferences.region = 'US'; d.library.push(entry(1, 'series'));
    d.episodeProgress.push({ seriesId: 1, seasonNumber: 1, episodeNumber: 1, episodeId: 101, status: 'watched' });
  });
  const raw = storage.raw(); storage.setItem = () => { assert.fail('refresh must not write'); };
  assert.equal(second.refresh(), true);
  assert.deepEqual(second.getState(), first.getState());
  assert.equal(storage.raw(), raw); assert.equal(notifications, 1);
  assert.equal(second.refresh(), false); assert.equal(notifications, 1);
  for (const version of [1, 2]) {
    const legacy = defaults(); legacy.version = version; delete legacy.episodeProgress;
    if (version === 1) delete legacy.gamification;
    legacy.library = [entry(1726)];
    const text = JSON.stringify(legacy);
    const disk = memoryStorage(); const store = createAppStore(disk);
    disk.setItem(STORAGE_KEY, text); disk.setItem = () => { assert.fail('migration must not write'); };
    assert.equal(store.refresh(), true);
    assert.equal(store.getState().version, 4);
    assert.deepEqual(store.getState().gamification, defaults().gamification);
    assert.deepEqual(store.getState().episodeProgress, []); assert.equal(disk.raw(), text);
  }
});

test('refresh preserves invalid external raw for recovery and updates loadError without writing', () => {
  const storage = memoryStorage(); const store = createAppStore(storage);
  let notifications = 0; store.subscribe(() => notifications++);
  for (const raw of ['{private broken', JSON.stringify({ ...defaults(), version: 999 })]) {
    storage.setItem(STORAGE_KEY, raw);
    assert.equal(store.refresh(), true);
    assert.ok(store.loadError instanceof Error);
    assert.equal(store.exportJSON(), raw); assert.equal(storage.raw(), raw);
    assert.equal(store.refresh(), false);
    assert.throws(() => store.transact(d => { d.onboarded = true; }));
  }
  store.restoreJSON(JSON.stringify(defaults()));
  assert.equal(store.loadError, null);
  const read = storage.getItem; const denied = new Error('SecurityError');
  storage.getItem = () => { throw denied; };
  assert.equal(store.refresh(), true); assert.equal(store.loadError, denied);
  assert.equal(store.refresh(), false);
  storage.getItem = read;
  assert.equal(store.refresh(), true); assert.equal(store.loadError, null);
  storage.setItem(STORAGE_KEY, null);
  assert.equal(store.refresh(), true); assert.deepEqual(store.getState(), defaults());
  assert.equal(notifications, 6);
});

test('throwing subscribers never report false commit failure and later listeners still run', () => {
  for (const method of ['transact', 'restoreJSON', 'refresh']) {
    const storage = memoryStorage(); const store = createAppStore(storage);
    const unsubscribe = store.subscribe(() => { throw new Error('private subscriber detail'); });
    let observed = 0; store.subscribe(() => { observed++; assert.equal(store.getState().onboarded, true); });
    assert.equal(store.notificationError, null);
    const next = defaults(); next.onboarded = true;
    const run = () => method === 'transact' ? store.transact(d => { d.onboarded = true; }) :
      method === 'restoreJSON' ? store.restoreJSON(JSON.stringify(next)) : store.refresh();
    if (method === 'refresh') storage.setItem(STORAGE_KEY, JSON.stringify(next));
    assert.doesNotThrow(run);
    assert.equal(observed, 1); assert.equal(createAppStore(storage).getState().onboarded, true);
    assert.ok(store.notificationError instanceof Error);
    assert.doesNotMatch(store.notificationError.message, /private subscriber detail/);
    unsubscribe(); store.transact(d => { d.onboarded = true; });
    assert.equal(observed, 2); assert.equal(store.notificationError, null);
  }
});

test('refresh after own commits is unchanged and stale callers can explicitly refresh then retry', () => {
  const storage = memoryStorage(); const first = createAppStore(storage); const second = createAppStore(storage);
  let notifications = 0; first.subscribe(() => notifications++);
  first.transact(d => { d.preferences.region = 'US'; });
  assert.equal(first.refresh(), false); assert.equal(notifications, 1);
  assert.throws(() => second.transact(d => { d.library.push(entry()); }), /Stale/);
  assert.equal(second.refresh(), true);
  second.transact(d => { d.library.push(entry()); });
  assert.equal(second.refresh(), false);
  assert.equal(second.getState().preferences.region, 'US');
  assert.equal(first.refresh(), true);
  assert.deepEqual(first.getState(), second.getState());
  first.restoreJSON(JSON.stringify(defaults()));
  assert.equal(first.refresh(), false);
});

test('failed persistence after refresh preserves state, notifications and conflict baseline for retry', () => {
  for (const method of ['transact', 'restoreJSON']) {
    const storage = memoryStorage(); const store = createAppStore(storage); const other = createAppStore(storage);
    other.transact(d => { d.preferences.region = 'US'; });
    assert.equal(store.refresh(), true);
    const before = store.getState(); const raw = storage.raw(); const write = storage.setItem;
    let notifications = 0; store.subscribe(() => notifications++);
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    const next = store.getState(); next.onboarded = true;
    const run = () => method === 'transact' ? store.transact(d => { d.onboarded = true; }) : store.restoreJSON(JSON.stringify(next));
    assert.throws(run, /Quota/);
    assert.deepEqual(store.getState(), before); assert.equal(storage.raw(), raw);
    assert.equal(notifications, 0); assert.equal(store.notificationError, null);
    storage.setItem = write;
    assert.doesNotThrow(run); assert.equal(notifications, 1);
    assert.equal(store.refresh(), false);
    assert.deepEqual(createAppStore(storage).getState(), next);
  }
});
