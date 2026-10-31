import { COLLECTIONS } from './collection-definitions.mjs';
import { syncGamification, awardHasEvidence } from './gamification-model.mjs';
export const STORAGE_KEY = 'watchbible:data:v1';
const emptyGamification = () => ({ profile: { displayName: '' }, followed: [], credits: [], awards: [] });
const defaults = () => ({ version: 4, onboarded: false, preferences: { region: 'NG', formats: ['movie', 'series'], genres: { movie: [], series: [] } }, library: [], dismissed: [], importDraft: null, gamification: emptyGamification(), episodeProgress: [] });
const statuses = ['watched', 'watching', 'plan_to_watch'];
const formats = ['movie', 'series'];
function requireValid(condition, label) {
  if (!condition) throw new TypeError(`Invalid watchbible data: ${label}`);
}
function object(value, keys, label) {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), label);
  requireValid(Object.keys(value).every(key => keys.includes(key)), `${label} has unsupported fields`);
}
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const canonicalId = value => typeof value === 'string' && /^tmdb:(movie|series):[1-9]\d*$/.test(value) && positiveId(Number(value.split(':')[2]));
function ids(value, label) {
  requireValid(Array.isArray(value) && value.every(positiveId), label);
}
function safeUrl(value, nullable = false) {
  if (value === null && nullable) return;
  requireValid(typeof value === 'string', 'URL');
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError('Invalid watchbible URL'); }
  requireValid(['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password, 'unsafe URL');
  requireValid([...parsed.searchParams.keys()].every(key =>
    !/^(api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret|authorization)$/i.test(key)), 'credential URL');
}
function isoTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.test(value)) return false;
  const calendarDate = value.slice(0, 10);
  const parsedDate = new Date(`${calendarDate}T00:00:00Z`);
  return Number.isFinite(Date.parse(value)) && Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === calendarDate;
}
function validateEntry(e, version) {
  object(e, ['provider', 'catalogueId', 'tmdbId', 'title', 'format', 'year', 'posterUrl', 'sourceUrl', 'overview',
    'genreIds', 'genres', 'anime', 'liked', 'status', 'fetchedAt', 'runtimeMinutes', 'seasons', 'episodes', 'imdbId',
    'backdropUrl', 'personalRating', ...(version >= 4 ? ['personalRatingScale'] : [])], 'library entry');
  requireValid(e.provider === 'TMDB' && formats.includes(e.format) && positiveId(e.tmdbId) &&
    e.catalogueId === `tmdb:${e.format}:${e.tmdbId}`, 'entry identity');
  requireValid(typeof e.title === 'string' && e.title.trim().length > 0 && typeof e.overview === 'string', 'entry text');
  requireValid(e.year === null || (typeof e.year === 'string' && /^\d{4}$/.test(e.year)), 'year');
  requireValid((statuses.includes(e.status) || (version >= 4 && e.status === null)) && (e.anime === null || typeof e.anime === 'boolean') && typeof e.liked === 'boolean', 'user metadata');
  ids(e.genreIds, 'entry genre IDs');
  requireValid(Array.isArray(e.genres), 'genres');
  for (const genre of e.genres) {
    object(genre, ['id', 'name'], 'genre');
    requireValid(positiveId(genre.id) && typeof genre.name === 'string', 'genre');
  }
  safeUrl(e.sourceUrl); safeUrl(e.posterUrl, true);
  if ('backdropUrl' in e) safeUrl(e.backdropUrl, true);
  for (const key of ['runtimeMinutes', 'seasons', 'episodes']) {
    if (key in e) requireValid(e[key] === null || (Number.isSafeInteger(e[key]) && e[key] >= 0), key);
  }
  if ('personalRatingScale' in e) {
    requireValid(e.personalRatingScale === 5, 'personal rating scale');
    requireValid(e.personalRating === null || (Number.isInteger(e.personalRating) && e.personalRating >= 1 && e.personalRating <= 5), 'personal rating');
  } else if ('personalRating' in e) requireValid(e.personalRating === null ||
    (typeof e.personalRating === 'number' && Number.isFinite(e.personalRating) && e.personalRating >= 0 && e.personalRating <= 10), 'personal rating');
  if ('imdbId' in e) requireValid(e.imdbId === null || (typeof e.imdbId === 'string' && /^tt\d{7,}$/.test(e.imdbId)), 'IMDb ID');
  if ('fetchedAt' in e) requireValid(isoTimestamp(e.fetchedAt), 'fetchedAt');
}
// Inspect descriptors before reading values: no accessors, prototypes, hidden fields,
// sparse arrays, cycles, or JSON serialization hooks can execute or disappear.
function plainData(value, ancestors = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { requireValid(Number.isFinite(value), 'finite number'); return; }
  requireValid(typeof value === 'object' && !ancestors.has(value), 'plain data');
  const array = Array.isArray(value);
  requireValid(array ? Object.getPrototypeOf(value) === Array.prototype :
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'plain data prototype');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (array) requireValid(keys.length === value.length + 1, 'dense array');
  ancestors.add(value);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = descriptors[key];
    requireValid(typeof key === 'string' && descriptor.enumerable && 'value' in descriptor &&
      !['__proto__', 'constructor', 'prototype'].includes(key), 'plain data property');
    if (array) requireValid(/^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length, 'array index');
    plainData(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}
function validateState(state, previous = null) {
  plainData(state);
  object(state, ['version', 'onboarded', 'preferences', 'library', 'dismissed', 'importDraft', ...(state.version >= 2 ? ['gamification'] : []), ...(state.version >= 3 ? ['episodeProgress'] : [])], 'state');
  requireValid([1, 2, 3, 4].includes(state.version), 'unsupported version');
  requireValid(typeof state.onboarded === 'boolean', 'onboarded');
  const p = state.preferences;
  object(p, ['region', 'formats', 'genres'], 'preferences');
  requireValid(typeof p.region === 'string' && /^[A-Z]{2}$/.test(p.region), 'region');
  requireValid(Array.isArray(p.formats) && p.formats.length > 0 && p.formats.every(f => formats.includes(f)), 'formats');
  object(p.genres, formats, 'preference genres');
  ids(p.genres.movie, 'movie genres'); ids(p.genres.series, 'series genres');
  requireValid(Array.isArray(state.library), 'library');
  const seen = new Set();
  for (const entry of state.library) {
    validateEntry(entry, state.version);
    requireValid(!seen.has(entry.catalogueId), 'duplicate library identity');
    seen.add(entry.catalogueId);
  }
  requireValid(Array.isArray(state.dismissed) && state.dismissed.every(canonicalId), 'dismissed');
  if (state.importDraft !== null) {
    object(state.importDraft, ['text', 'entries'], 'import draft');
    requireValid(typeof state.importDraft.text === 'string' && Array.isArray(state.importDraft.entries), 'import draft');
    for (const row of state.importDraft.entries) {
      object(row, ['originalLine', 'title', 'status'], 'draft row');
      requireValid(typeof row.originalLine === 'string' && typeof row.title === 'string' &&
        (row.status === null || statuses.includes(row.status)), 'draft row');
    }
  }
  if (state.version >= 2) {
    const g = state.gamification;
    object(g, ['profile', 'followed', 'credits', 'awards'], 'gamification');
    object(g.profile, ['displayName'], 'profile');
    requireValid(typeof g.profile.displayName === 'string' && g.profile.displayName.length <= 60 &&
      g.profile.displayName === g.profile.displayName.trim() && !/[\u0000-\u001f\u007f]/.test(g.profile.displayName), 'display name');
    requireValid(Array.isArray(g.followed) && new Set(g.followed).size === g.followed.length &&
      g.followed.every(id => COLLECTIONS.some(collection => collection.id === id)), 'followed collections');
    requireValid(Array.isArray(g.credits) && Array.isArray(g.awards), 'gamification records');
    const creditIds = new Set();
    for (const credit of g.credits) {
      object(credit, ['catalogueId', 'recognizedAt'], 'credit');
      requireValid(canonicalId(credit.catalogueId) && credit.catalogueId.startsWith('tmdb:movie:') &&
        isoTimestamp(credit.recognizedAt) && !creditIds.has(credit.catalogueId), 'credit identity/date');
      creditIds.add(credit.catalogueId);
      const unchanged = previous?.gamification.credits.some(old => JSON.stringify(old) === JSON.stringify(credit));
      requireValid(unchanged || state.library.some(e => e.catalogueId === credit.catalogueId && e.format === 'movie' && e.status === 'watched'), 'credit evidence');
    }
    const awardIds = new Set();
    for (const award of g.awards) {
      object(award, ['id', 'definitionVersion', 'eligibleIds', 'evidence', 'earnedAt'], 'award');
      requireValid(typeof award.id === 'string' && !awardIds.has(award.id) && positiveId(award.definitionVersion) && isoTimestamp(award.earnedAt), 'award identity/date/version');
      awardIds.add(award.id);
      for (const field of ['eligibleIds', 'evidence']) requireValid(Array.isArray(award[field]) && award[field].length > 0 &&
        new Set(award[field]).size === award[field].length && award[field].every(id => canonicalId(id) && id.startsWith('tmdb:movie:')), `award ${field}`);
      const unchanged = previous?.gamification.awards.some(old => JSON.stringify(old) === JSON.stringify(award));
      requireValid(unchanged || awardHasEvidence(state, award), 'award evidence/reference');
    }
  }
  if (state.version >= 3) {
    requireValid(Array.isArray(state.episodeProgress), 'episode progress');
    const episodeIds = new Set();
    const positions = new Set();
    for (const record of state.episodeProgress) {
      object(record, ['seriesId', 'seasonNumber', 'episodeNumber', 'episodeId', 'status'], 'episode record');
      requireValid(positiveId(record.seriesId) && positiveId(record.episodeId) && positiveId(record.episodeNumber) &&
        Number.isSafeInteger(record.seasonNumber) && record.seasonNumber >= 0 &&
        ['watched', 'watching'].includes(record.status), 'episode identity/status');
      const position = `${record.seriesId}:${record.seasonNumber}:${record.episodeNumber}`;
      requireValid(!episodeIds.has(record.episodeId) && !positions.has(position), 'duplicate episode identity');
      episodeIds.add(record.episodeId); positions.add(position);
    }
  }
  const result = structuredClone(state);
  if (result.version === 1) { result.version = 2; result.gamification = emptyGamification(); }
  if (result.version === 2) { result.version = 3; result.episodeProgress = []; }
  if (result.version === 3) result.version = 4;
  result.dismissed = [...new Set(result.dismissed)];
  return result;
}
// Equivalent to storage = globalThis.localStorage, evaluated inside the error
// boundary because browsers may throw even when accessing the storage property.
export function createAppStore(storage) {
  let state = defaults();
  let raw = null;
  let loadError = null;
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    raw = storage.getItem(STORAGE_KEY);
    if (raw !== null) {
      requireValid(typeof raw === 'string', 'stored text');
      state = validateState(JSON.parse(raw));
    }
  } catch (error) {
    loadError = error instanceof Error ? error : new Error(String(error));
  }
  let lastPersistedRaw = raw;
  // Best-effort stale-snapshot detection, NOT an atomic compare-and-swap:
  // localStorage read/check/write cannot serialize simultaneous tabs/processes.
  // Keep the single-editing-tab restriction; refresh/reload before retrying.
  function requireCurrentStorage() {
    if (storage.getItem(STORAGE_KEY) !== lastPersistedRaw) {
      throw new Error('Stale data: saved data changed. Refresh or reload before retrying.');
    }
  }
  const listeners = new Set();
  let notificationError = null;
  function notify() {
    notificationError = null;
    for (const fn of [...listeners]) {
      try { fn(); } catch {
        notificationError = new Error('Data updated, but a subscriber could not be notified.');
      }
    }
  }
  return {
    get loadError() { return loadError; },
    get notificationError() { return notificationError; },
    getState: () => structuredClone(state),
    // No arguments, synchronous boolean; reload only, never a migration write.
    refresh() {
      let currentRaw = lastPersistedRaw;
      let next = defaults();
      let nextError = null;
      let readSucceeded = false;
      try {
        if (storage === undefined) storage = globalThis.localStorage;
        currentRaw = storage.getItem(STORAGE_KEY);
        readSucceeded = true;
        if (currentRaw !== null) {
          requireValid(typeof currentRaw === 'string', 'stored text');
          next = validateState(JSON.parse(currentRaw));
        }
      } catch (error) {
        nextError = error instanceof Error ? error : new Error(String(error));
      }
      const changed = (readSucceeded && currentRaw !== lastPersistedRaw) || Boolean(nextError) !== Boolean(loadError) ||
        nextError?.name !== loadError?.name || nextError?.message !== loadError?.message;
      if (!changed) return false;
      if (readSucceeded) {
        state = next;
        lastPersistedRaw = currentRaw;
      }
      raw = currentRaw;
      loadError = nextError;
      notify();
      return true;
    },
    exportJSON() {
      if (loadError && typeof raw === 'string') return raw;
      return JSON.stringify(validateState(state), null, 2);
    },
    restoreJSON(text) {
      requireValid(typeof text === 'string', 'restore text');
      const next = validateState(JSON.parse(text));
      const serialized = JSON.stringify(next);
      requireCurrentStorage();
      storage.setItem(STORAGE_KEY, serialized);
      state = next;
      lastPersistedRaw = serialized;
      raw = null;
      loadError = null;
      notify();
    },
    subscribe(fn) {
      requireValid(typeof fn === 'function', 'subscriber');
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    transact(fn) {
      if (loadError) throw loadError;
      const draft = structuredClone(state);
      fn(draft);
      plainData(draft);
      requireValid(draft.version === 4, 'transaction version');
      const next = validateState(draft, state);
      syncGamification(state, next);
      const text = JSON.stringify(validateState(next));
      requireCurrentStorage();
      storage.setItem(STORAGE_KEY, text);
      state = JSON.parse(text);
      lastPersistedRaw = text;
      notify();
    },
  };
}
