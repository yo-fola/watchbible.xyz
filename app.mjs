import { createAppStore } from './app-state.mjs';
import { fetchJSON, enrichGenres, interleaveResults } from './catalogue-browser.mjs';
export const appStore = createAppStore();

// This dependency evaluates before page modules register their recovery hooks.
if (typeof window !== 'undefined') window.addEventListener('pageshow', event => {
  if (event.persisted !== true) return;
  try { appStore.refresh(); }
  catch { /* The store exposes loadError; page recovery shows safe storage feedback. */ }
});

// Import after store initialization; pure Node consumers never load DOM UI.
if (typeof document !== 'undefined') {
  void import('./user-menu.mjs').then(({ mountUserMenu }) => {
    const mount = () => mountUserMenu(appStore);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
  }).catch(error => console.error('Could not load local profile navigation.', error));
}

// Bounded external pool; failure of one source never erases another source.
export async function loadCandidateBatch(preferences, { page = 1, seeds = [], lists = {}, signal, fetchImpl, totals = new Map(), discoveryPages, seedPages } = {}) {
  // Optional picker-only source maps: absent preserves For you's exact page policy;
  // an empty Map skips that source family. Related totals never collide with formats.
  const validPage = value => Number.isInteger(value) && value >= 1 && value <= 500;
  const sources = preferences.formats.flatMap(format => {
    const sourcePage = discoveryPages ? discoveryPages.get(format) : page;
    return validPage(sourcePage) && sourcePage <= (totals.get(format) ?? 500) ? [{
      format, discovery: true, page: sourcePage, key: format,
      path: `/api/discover?${new URLSearchParams({ format, genres: preferences.genres[format].join(','), page: String(sourcePage) })}`,
    }] : [];
  });
  for (const seed of seeds.slice(0, 3)) {
    const sourcePage = seedPages ? seedPages.get(seed.catalogueId) : page === 1 ? 1 : undefined;
    const key = `related:${seed.catalogueId}`;
    if (validPage(sourcePage) && sourcePage <= (totals.get(key) ?? 500)) sources.push({
      seed, page: sourcePage, key,
      path: `/api/recommendations?${new URLSearchParams({ format: seed.format, id: String(seed.tmdbId), page: String(sourcePage) })}`,
    });
  }
  const settled = await Promise.allSettled(sources.map(source => fetchJSON(source.path, { signal }, fetchImpl)));
  const groups = [], errors = [];
  let hasMore = false;
  settled.forEach((result, index) => {
    const source = sources[index];
    if (result.status === 'rejected') { errors.push(result.reason); if (source.discovery) hasMore = true; return; }
    const data = result.value;
    if (!Array.isArray(data.results)) { errors.push(new Error('Unexpected catalogue results.')); return; }
    const total = Math.max(1, Math.min(500, Math.floor(Number(data.totalPages) || 1)));
    if (source.discovery || seedPages) totals.set(source.key, total);
    if ((source.discovery || seedPages) && source.page < total) hasMore = true;
    groups.push(data.results.map(candidate => {
      const item = source.seed ? { ...candidate, relatedTo: [source.seed.catalogueId] } : candidate;
      // A concurrently loading genre list must not freeze an empty genres array.
      return lists[item.format] ? enrichGenres(item, lists) : item;
    }));
  });
  const merged = new Map();
  for (const item of groups.flat()) {
    const previous = merged.get(item.catalogueId);
    merged.set(item.catalogueId, previous ? { ...previous,
      relatedTo: [...new Set([...(previous.relatedTo || []), ...(item.relatedTo || [])])],
      genreIds: [...new Set([...(previous.genreIds || []), ...(item.genreIds || [])])],
    } : structuredClone(item));
  }
  return { candidates: interleaveResults(groups.map(group => group.map(item => merged.get(item.catalogueId))), 100), errors, hasMore };
}
