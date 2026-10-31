import { appStore, loadCandidateBatch } from './app.mjs';
import { fetchJSON, positiveSeeds, enrichGenres } from './catalogue-browser.mjs';
import { pageBounds, pageWindow } from './pagination-model.mjs';
import { rankRecommendations } from './recommendation-model.mjs';
import { filterLibrary } from './library-model.mjs';
import { applyTitleChoice, setTitleLike } from './library-actions.mjs';
import { createFilmCard } from './film-card.mjs';
import { mountWatchPicker } from './watch-picker.mjs';
const $ = id => document.getElementById(id);
let pool = [], lists = {}, page = 1, busy = false, revision = 0, controller, sourceError = '', failedTarget = null;
let pendingTarget = null;
const totals = new Map();
const pages = new Map(); // At most eight real source pages; exclusions are reapplied on every render.
const recommendationKey = () => {
  const state = appStore.getState();
  return JSON.stringify([state.preferences, positiveSeeds(state).map(seed => [seed.catalogueId, seed.liked, seed.status])]);
};
let cacheKey = recommendationKey();
function invalidateRecommendations() {
  const next = recommendationKey();
  if (next === cacheKey) return false;
  // Invalidate request caches, not the last usable screen. Replace the pool only
  // after a new source succeeds; current preferences/exclusions still filter it.
  cacheKey = next; pages.clear(); totals.clear(); sourceError = ''; failedTarget = null;
  return true;
}
function knownTotal() { return totals.size ? Math.max(...totals.values()) : null; }
function renderPagination() {
  const blocked = busy || Boolean(appStore.loadError);
  const bounds = pageBounds(page, knownTotal());
  $('home-prev').disabled = blocked || bounds.previous === null;
  $('home-next').disabled = blocked || bounds.next === null;
  $('home-refresh').disabled = blocked;
  $('home-retry').disabled = blocked;
  $('home-grid').setAttribute('aria-busy', String(busy));
  $('home-pagination').setAttribute('aria-busy', String(busy));
  $('home-page-numbers').replaceChildren(...pageWindow(page, knownTotal()).map(value => {
    const element = document.createElement(value === 'ellipsis' ? 'span' : 'button');
    element.textContent = value === 'ellipsis' ? '…' : String(value);
    if (value === 'ellipsis') element.setAttribute('aria-hidden', 'true');
    else {
      element.type = 'button'; element.className = 'quiet-button'; element.disabled = blocked;
      element.setAttribute('aria-label', `Recommendation page ${value}`);
      if (value === page) element.setAttribute('aria-current', 'page');
      element.addEventListener('click', () => { if (value !== page) void load(value); });
    }
    return element;
  }));
}
function render() {
  const state = appStore.getState();
  const ranked = rankRecommendations(pool.map(item => enrichGenres(item, lists)), state);
  const picks = filterLibrary(ranked, { query: $('home-search').value, format: $('home-format').value }).slice(0, 20);
  $('home-grid').replaceChildren(...picks.map(candidate => createFilmCard(candidate, {
    onChoice: cardSave, onLike: cardLike, reason: candidate.recommendationReason,
  })));
  $('home-count').textContent = `${picks.length} picks${ranked.length > 20 ? ' from this batch' : ''}`;
  $('home-saved').textContent = `${state.library.length} saved in Library`;
  renderPagination();
  if (!busy && !sourceError && !picks.length) $('home-feedback').textContent = ranked.length ? 'No matches on this page. Try another search.' : 'No unseen picks on this page. Try another page or change Preferences.';
}
function saveChoice(action, candidate) {
  try {
    appStore.transact(draft => applyTitleChoice(draft, candidate, action));
    // The synchronous store subscription already renders the committed state.
    $('home-feedback').textContent = `${action === 'not_for_me' ? 'Hidden' : 'Saved'}: ${candidate.title}.${sourceError ? ` ${sourceError}` : ''}`;
    return true;
  } catch (error) {
    $('home-feedback').textContent = 'Could not save. Nothing changed. Check browser storage in Settings and retry.';
    $('home-recovery').hidden = false;
    throw error;
  }
}
// Quick-action handlers consume errors after the visible feedback is updated.
function cardSave(action, candidate) {
  const restoreFocus = $('home-grid').contains(document.activeElement);
  try { saveChoice(action, candidate); if (restoreFocus) $('home-search').focus({ preventScroll: true }); }
  catch { /* feedback is visible */ }
}
function cardLike(candidate) {
  const restoreFocus = $('home-grid').contains(document.activeElement);
  try {
    appStore.transact(draft => setTitleLike(draft, candidate, true));
    $('home-feedback').textContent = `Liked: ${candidate.title}. Future random picks can use this as a taste signal.`;
    if (restoreFocus) $('home-search').focus({ preventScroll: true });
  } catch {
    $('home-feedback').textContent = 'Could not save your Like. Nothing changed. Check browser storage in Settings.';
    $('home-recovery').hidden = false;
  }
}
async function load(targetPage = page, { refresh = false } = {}) {
  if (appStore.loadError) return;
  // Refresh re-fetches the page the user is viewing, even with fresh seeds.
  if (invalidateRecommendations() && !refresh) targetPage = 1;
  targetPage = pageBounds(targetPage, knownTotal()).page;
  controller?.abort(); controller = new AbortController(); const signal = controller.signal; const current = ++revision;
  const previousPage = page;
  const refreshFocused = refresh && document.activeElement === $('home-refresh');
  const focusPage = () => {
    if (page !== previousPage) {
      $('home-heading').focus({ preventScroll: true });
      // Immediate navigation is also safe for reduced-motion and background tabs.
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  };
  if (!refresh && pages.has(targetPage)) {
    const cached = pages.get(targetPage);
    pool = cached.candidates; page = targetPage; sourceError = cached.error;
    failedTarget = sourceError ? targetPage : null; busy = false;
    $('home-feedback').textContent = sourceError; $('home-retry').hidden = !sourceError;
    render(); focusPage(); return;
  }
  pendingTarget = targetPage;
  busy = true; $('home-feedback').textContent = 'Loading picks…'; $('home-retry').hidden = true; render();
  const state = appStore.getState();
  const requestTotals = new Map(totals);
  let successfulSources = 0;
  try {
    const [genres, batch] = await Promise.allSettled([
      Object.keys(lists).length ? Promise.resolve(lists) : fetchJSON('/api/genres', { signal }),
      loadCandidateBatch(state.preferences, { page: targetPage, seeds: positiveSeeds(state), lists, signal, totals: requestTotals,
        fetchImpl: async (path, options) => {
          const response = await fetch(path, options);
          if (response.ok) { const data = await response.clone().json(); if (Array.isArray(data.results)) successfulSources++; }
          return response;
        },
      }),
    ]);
    if (current !== revision || signal.aborted) return;
    if (genres.status === 'fulfilled') lists = genres.value;
    const errors = genres.status === 'rejected' ? [genres.reason] : [];
    let accepted = false;
    if (batch.status === 'fulfilled') {
      errors.push(...batch.value.errors);
      accepted = successfulSources > 0 || batch.value.errors.length === 0;
      if (accepted) {
        pool = batch.value.candidates; page = targetPage;
        totals.clear(); for (const [format, total] of requestTotals) totals.set(format, total);
      }
    } else errors.push(batch.reason);
    sourceError = errors.length ? (accepted ? 'Some catalogue sources could not load. Showing available picks; Retry the missing sources.' : 'Catalogue could not load. Keeping the last successful page. Retry.') : '';
    failedTarget = errors.length ? targetPage : null;
    if (accepted) {
      pages.delete(page); pages.set(page, { candidates: pool, error: sourceError });
      while (pages.size > 8) pages.delete(pages.keys().next().value);
    }
    $('home-feedback').textContent = sourceError;
    $('home-retry').hidden = !errors.length;
  } catch { if (current === revision && !signal.aborted) { failedTarget = targetPage; sourceError = 'Catalogue could not load. Keeping the last successful page. Retry.'; $('home-feedback').textContent = sourceError; $('home-retry').hidden = false; } }
  finally { if (current === revision) { pendingTarget = null; busy = false; render(); focusPage(); if (refreshFocused && page === previousPage) $('home-refresh').focus({ preventScroll: true }); } }
}
$('home-search').addEventListener('input', () => { if (!sourceError) $('home-feedback').textContent = ''; render(); });
$('home-format').addEventListener('change', () => { if (!sourceError) $('home-feedback').textContent = ''; render(); });
$('home-prev').addEventListener('click', () => { if (!busy) void load(page - 1); });
$('home-next').addEventListener('click', () => { if (!busy) void load(page + 1); });
$('home-refresh').addEventListener('click', () => { if (!busy) void load(page, { refresh: true }); });
$('home-retry').addEventListener('click', () => { if (!busy) void load(failedTarget ?? page, { refresh: true }); });
window.addEventListener('pagehide', () => { ++revision; controller?.abort(); });
window.addEventListener('pageshow', event => {
  if (event.persisted !== true) return;
  busy = false;
  const target = pendingTarget;
  pendingTarget = null;
  if (appStore.loadError) {
    $('home-feedback').textContent = 'Saved data could not be loaded. It has not been overwritten. Open Settings to recover it.';
    $('home-recovery').hidden = false; renderPagination(); return;
  }
  if (!appStore.loadError && invalidateRecommendations()) void load(1, { refresh: true });
  else if (target !== null && !appStore.loadError) void load(target, { refresh: true });
  else render();
});
// Independent picker state never moves or replaces the For you page.
if ($('watch-picker')?.showModal) mountWatchPicker({ dialog: $('watch-picker'), opener: $('what-to-watch'), store: appStore, loadBatch: loadCandidateBatch });
if (appStore.loadError) {
  $('home-feedback').textContent = 'Saved data could not be loaded. It has not been overwritten. Open Settings to recover it.';
  $('home-recovery').hidden = false; renderPagination();
} else if (!appStore.getState().onboarded) location.replace('onboarding.html');
else { appStore.subscribe(render); void load(); }
