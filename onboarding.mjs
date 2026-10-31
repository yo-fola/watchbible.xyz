import { appStore, loadCandidateBatch } from './app.mjs';
import { fetchJSON, enrichGenres, interleaveResults } from './catalogue-browser.mjs';
import { applyTitleChoice } from './library-actions.mjs';
import { createFilmCard } from './film-card.mjs';
const $ = id => document.getElementById(id);
const preferences = appStore.getState().preferences;
const pending = new Map();
let lists = {}, candidates = [], signature = '', page = 1, revision = 0, controller, busy = false, hasMore = true, leaving = false;
let pendingTarget = null;
let metadataController, metadataRevision = 0, metadataPending = false;
const totals = new Map();
const feedback = message => { $('onboarding-feedback').textContent = message; };
$('preference-region').value = preferences.region;
if (!$('preference-region').value) {
  const option = document.createElement('option'); option.value = preferences.region; option.textContent = `${preferences.region} (saved country)`;
  $('preference-region').append(option); $('preference-region').value = preferences.region;
}
for (const input of document.querySelectorAll('[name="format"]')) input.checked = preferences.formats.includes(input.value);
function readPreferences() {
  const formats = [...document.querySelectorAll('[name="format"]:checked')].map(input => input.value);
  if (!formats.length) { feedback('Choose at least one format.'); return false; }
  preferences.region = $('preference-region').value; preferences.formats = formats;
  return true;
}
function renderGenres() {
  const groups = new Map();
  for (const format of ['movie', 'series']) for (const genre of lists[format] || []) {
    const key = genre.name.trim().toLocaleLowerCase();
    if (!groups.has(key)) groups.set(key, { name: genre.name, movie: [], series: [] });
    groups.get(key)[format].push(genre.id);
  }
  $('genre-chips').replaceChildren(...[...groups.values()].map(group => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'genre-chip quiet-button'; button.textContent = group.name;
    const selected = ['movie', 'series'].some(format => group[format].some(id => preferences.genres[format].includes(id)));
    button.setAttribute('aria-pressed', String(selected));
    button.addEventListener('click', () => {
      const next = structuredClone(preferences.genres);
      for (const format of ['movie', 'series']) next[format] = selected ? next[format].filter(id => !group[format].includes(id)) : [...new Set([...next[format], ...group[format]])];
      if (next.movie.length > 20 || next.series.length > 20) { feedback('Choose up to 20 genres per format. Remove one first.'); return; }
      preferences.genres = next; renderGenres();
      [...$('genre-chips').children].find(item => item.textContent === group.name)?.focus();
    });
    return button;
  }));
}
async function loadPreferences() {
  metadataController?.abort(); metadataController = new AbortController();
  const signal = metadataController.signal, current = ++metadataRevision;
  metadataPending = true;
  const results = await Promise.allSettled([fetchJSON('/api/genres', { signal }), fetchJSON('/api/regions', { signal })]);
  if (leaving || signal.aborted || current !== metadataRevision) return;
  metadataPending = false;
  if (results[0].status === 'fulfilled') { lists = results[0].value; renderGenres(); $('genres-retry').hidden = true; }
  else { $('genres-retry').hidden = false; feedback('Genres could not load. Retry, or continue without changing genre interests.'); }
  if (results[1].status === 'fulfilled' && Array.isArray(results[1].value.regions)) {
    const selected = $('preference-region').value;
    const countries = new Map(results[1].value.regions.map(region => [region.code, region.name]));
    if (!countries.has(selected)) countries.set(selected, `${selected} (saved country)`);
    $('preference-region').replaceChildren(...[...countries].map(([code, name]) => { const option = document.createElement('option'); option.value = code; option.textContent = name; return option; }));
    $('preference-region').value = selected;
  } else $('region-note').textContent = 'Official country list could not load. Showing saved country and fallback country options; service availability is not guaranteed.';
}
function renderStarters() {
  const saved = appStore.getState(); const excluded = new Set([...saved.library.map(item => item.catalogueId), ...saved.dismissed]);
  // Keep staged titles visible, including picks from previous batches, so they can be undone.
  const shown = interleaveResults([candidates], 10).filter(item => !excluded.has(item.catalogueId) && item.adult !== true);
  const seen = new Set(shown.map(item => item.catalogueId));
  for (const { candidate } of pending.values()) if (!seen.has(candidate.catalogueId)) { shown.push(candidate); seen.add(candidate.catalogueId); }
  $('starter-grid').replaceChildren(...shown.map(item => {
    const candidate = enrichGenres(item, lists);
    return createFilmCard(candidate, { onChoice: stageChoice, choice: pending.get(candidate.catalogueId)?.action });
  }));
  $('starter-count').textContent = `${pending.size} pending choices · ${saved.library.length} existing library titles kept`;
  $('starter-more').disabled = busy || !hasMore;
}
function stageChoice(action, candidate) {
  if (pending.get(candidate.catalogueId)?.action === action) pending.delete(candidate.catalogueId);
  else pending.set(candidate.catalogueId, { candidate: structuredClone(candidate), action });
  renderStarters(); feedback(`${pending.size} choices pending. Nothing saved yet.`);
  return true;
}
async function loadStarters(targetPage = page) {
  if (appStore.loadError) return;
  controller?.abort(); controller = new AbortController(); const signal = controller.signal; const current = ++revision;
  pendingTarget = targetPage;
  busy = true; $('starter-retry').hidden = true; feedback('Loading starting points…'); renderStarters();
  try {
    const batch = await loadCandidateBatch(preferences, { page: targetPage, lists, signal, totals });
    if (current !== revision || signal.aborted || leaving) return;
    const saved = appStore.getState(), excluded = new Set([...saved.library.map(item => item.catalogueId), ...saved.dismissed]);
    const available = batch.candidates.filter(item => item.adult !== true && !excluded.has(item.catalogueId));
    if (available.length || batch.errors.length === 0) candidates = targetPage === page ? interleaveResults([available, candidates], 40) : available;
    page = targetPage; hasMore = batch.hasMore;
    $('starter-retry').hidden = batch.errors.length === 0;
    feedback(batch.errors.length ? (candidates.length ? 'Some sources could not load. Showing available starting points. Retry or finish with your preferences.' : 'Catalogue unavailable. Retry or finish with preferences only; no history has been invented.') : (pending.size ? 'Your staged choices are kept. Review any number, then Finish.' : 'Choose any number of titles, then Finish.'));
  } catch { if (current === revision && !signal.aborted) { feedback('Catalogue unavailable. Retry or finish with preferences only.'); $('starter-retry').hidden = false; } }
  finally { if (current === revision) { pendingTarget = null; busy = false; renderStarters(); } }
}
function next() {
  if (!readPreferences() || appStore.loadError) return;
  $('preferences-stage').hidden = true; $('starter-stage').hidden = false; $('onboarding-step').textContent = '2 of 2'; $('starter-heading').focus();
  const nextSignature = JSON.stringify(preferences);
  if (signature !== nextSignature || !candidates.length) {
    signature = nextSignature; candidates = []; page = 1; totals.clear(); hasMore = true; void loadStarters(1);
  } else { renderStarters(); feedback(`${pending.size} choices pending. Nothing saved yet.`); }
}
function finish() {
  if (!readPreferences() || appStore.loadError || leaving) return;
  try {
    appStore.transact(draft => {
      draft.preferences = structuredClone(preferences);
      // A title page may have saved newer history while this page was cached.
      for (const { action, candidate } of pending.values()) {
        if (!draft.library.some(item => item.catalogueId === candidate.catalogueId) && !draft.dismissed.includes(candidate.catalogueId)) applyTitleChoice(draft, candidate, action);
      }
      draft.onboarded = true;
    });
    leaving = true; ++revision; controller?.abort(); location.assign('index.html');
  } catch { feedback('Could not save. Your staged choices are still here. Check browser storage in Settings, then retry Finish.'); $('onboarding-recovery').hidden = false; }
}
$('preferences-form').addEventListener('submit', event => { event.preventDefault(); next(); });
$('preferences-skip').addEventListener('click', finish);
$('onboarding-finish').addEventListener('click', finish);
$('starter-back').addEventListener('click', () => {
  ++revision; controller?.abort(); busy = false; pendingTarget = null;
  $('starter-stage').hidden = true; $('preferences-stage').hidden = false; $('onboarding-step').textContent = '1 of 2'; $('preferences-next').focus();
  feedback(`${pending.size} staged choices kept. Changes to interests will load new suggestions, not discard choices.`);
  $('preferences-skip').textContent = pending.size ? `Finish with ${pending.size} staged choices` : 'Start with preferences only';
});
$('starter-more').addEventListener('click', () => { if (!busy && hasMore) void loadStarters(page + 1); });
$('starter-retry').addEventListener('click', () => void loadStarters(page));
$('genres-retry').addEventListener('click', () => void loadPreferences());
window.addEventListener('pagehide', () => { leaving = true; ++revision; controller?.abort(); ++metadataRevision; metadataController?.abort(); });
window.addEventListener('pageshow', event => {
  if (event.persisted !== true) return;
  leaving = false; busy = false;
  const target = pendingTarget; pendingTarget = null;
  if (appStore.loadError) {
    feedback('Saved data could not be loaded. It has not been overwritten. Recover it in Settings before changing preferences.');
    $('onboarding-recovery').hidden = false;
    for (const button of document.querySelectorAll('main button')) button.disabled = true;
    return;
  }
  if (metadataPending) void loadPreferences();
  if (target !== null && !$('starter-stage').hidden) { void loadStarters(target); return; }
  renderStarters();
});
if (appStore.loadError) {
  feedback('Saved data could not be loaded. It has not been overwritten. Recover it in Settings before changing preferences.');
  $('onboarding-recovery').hidden = false;
  for (const button of document.querySelectorAll('main button')) button.disabled = true;
} else void loadPreferences();
