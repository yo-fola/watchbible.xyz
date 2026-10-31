import { fetchJSON, enrichGenres } from './catalogue-browser.mjs';
import { rankRecommendations } from './recommendation-model.mjs';
import { createFilmCard, titlePageHref } from './film-card.mjs';
const normalize = name => String(name).trim().toLocaleLowerCase();
export function pickerPreferences(saved, { format = '', genre = '' } = {}, lists = {}) {
  const preferences = structuredClone(saved);
  if (format) preferences.formats = [format];
  if (genre) preferences.genres = Object.fromEntries(['movie', 'series'].map(type => [type,
    (preferences.formats.includes(type) ? lists[type] || [] : []).filter(item => normalize(item.name) === normalize(genre)).map(item => item.id)]));
  return preferences;
}

const unitRandom = random => Math.max(0, Math.min(1 - Number.EPSILON, Number(random()) || 0));
export function pickerSeeds(state, random = Math.random) {
  const available = [...new Map(state.library.filter(item => item.liked === true).map(item => [item.catalogueId, item])).values()];
  const seeds = [];
  while (available.length && seeds.length < 3) seeds.push(...available.splice(Math.floor(unitRandom(random) * available.length), 1));
  return seeds;
}
export function selectPickerCandidate(candidates, state, shown = new Set(), filters = {}, lists = {}, random = Math.random) {
  const preferences = pickerPreferences(state.preferences, filters, lists);
  const eligible = candidates.filter(item => !shown.has(item.catalogueId) && (!filters.genre ||
    (preferences.genres[item.format] || []).some(id => (item.genreIds || []).includes(id))));
  const ranked = rankRecommendations(eligible.map(item => enrichGenres(item, lists)), { ...state, preferences });
  // Bounded 1–4 lottery weights: explicit likes > Watch later > genre > popular.
  // Ranking supplies exclusions/reasons, not a deterministic first-card choice.
  const weight = item => 1 + Math.min(3, Math.floor(item.score / 100));
  let ticket = unitRandom(random) * ranked.reduce((sum, item) => sum + weight(item), 0);
  for (const item of ranked) { ticket -= weight(item); if (ticket < 0) return item; }
  return ranked.at(-1) || null;
}

// Source pages, not arbitrary card slices. Each click searches at most five pages.
export function mountWatchPicker({ dialog, opener, store, loadBatch, fetchImpl = fetch, random = Math.random }) {
  const $ = id => dialog.querySelector(`#watch-picker-${id}`);
  const result = $('result'), status = $('status'), next = $('next'), retry = $('retry');
  let alive = true, opened = false, revision = 0, controller, busy = false;
  let lists = {}, pool = [], shown = new Set(), page = 1, hasMore = true, filters = {}, current = null;
  let warning = '', genreError = '', failedPage = null;
  const totals = new Map(), listeners = [], failedPages = new Set();
  const visited = new Map(), plans = new Map();
  let retryPlan = null;
  function available(key) {
    const seen = visited.get(key) || new Set();
    return Array.from({ length: totals.get(key) ?? 1 }, (_, n) => n + 1).filter(n => !seen.has(n));
  }
  function sourcePlan(state, preferences) {
    const draw = key => {
      const pages = available(key);
      if (!pages.length) return undefined;
      const selected = pages[Math.floor(unitRandom(random) * pages.length)];
      if (!visited.has(key)) visited.set(key, new Set());
      visited.get(key).add(selected); return selected;
    };
    const discoveryPages = new Map(preferences.formats.map(format => [format, draw(format)]).filter(([,value]) => value));
    const seeds = pickerSeeds({ library: state.library.filter(seed => available(`related:${seed.catalogueId}`).length) }, random);
    const seedPages = new Map(seeds.map(seed => [seed.catalogueId, draw(`related:${seed.catalogueId}`)]));
    return { discoveryPages, seeds, seedPages };
  }
  const remaining = (state, preferences) => preferences.formats.some(format => available(format).length) || state.library.some(seed => seed.liked === true && available(`related:${seed.catalogueId}`).length);
  const listen = (target, event, fn) => { target.addEventListener(event, fn); listeners.push(() => target.removeEventListener(event, fn)); };
  function syncFailures() {
    warning = failedPages.size ? 'Some catalogue sources failed. Results may be incomplete; Retry to try again.' : '';
    failedPage = failedPages.size ? Math.min(...failedPages) : null;
  }
  function invalidate() { revision++; controller?.abort(); busy = false; result.setAttribute('aria-busy', 'false'); }
  function controls() {
    next.disabled = busy || Boolean(store.loadError) || (!current && !hasMore && !selectPickerCandidate(pool, store.getState(), shown, filters, lists, () => 0));
    retry.disabled = busy; result.setAttribute('aria-busy', String(busy));
  }
  function recovery() {
    invalidate(); current = null; result.replaceChildren();
    const link = document.createElement('a'); link.href = 'setup.html'; link.textContent = 'Recover your data in Settings'; result.append(link);
    status.textContent = 'Your saved data could not be loaded. Recover it before getting personalized picks.'; retry.hidden = true; next.disabled = true;
  }
  function genres() {
    const selected = $('genre').value;
    const formats = $('format').value ? [$('format').value] : store.getState().preferences.formats;
    const names = new Map();
    for (const format of formats) for (const genre of lists[format] || []) names.set(normalize(genre.name), genre.name.trim());
    const option = document.createElement('option'); option.value = ''; option.textContent = 'Your genres (default)';
    $('genre').replaceChildren(option, ...[...names].sort((a,b) => a[1].localeCompare(b[1])).map(([value, label]) => {
      const node = document.createElement('option'); node.value = value; node.textContent = label; return node;
    }));
    if (names.has(selected)) $('genre').value = selected;
  }
  function render(candidate) {
    current = candidate; result.replaceChildren();
    if (candidate) {
      shown.add(candidate.catalogueId);
      const card = createFilmCard(candidate, { reason: candidate.recommendationReason });
      const body = card.querySelector('.card-body'); result.append(card);
      const summary = document.createElement('p'); summary.className = 'watch-picker-overview';
      summary.textContent = candidate.overview ? candidate.overview.slice(0, 320) + (candidate.overview.length > 320 ? '…' : '') : 'Synopsis unavailable.';
      body.append(summary);
      const href = titlePageHref(candidate);
      if (href) { const link = document.createElement('a'); link.href = href; link.dataset.pickerDetails = ''; link.textContent = 'View details →'; body.append(link); }
      status.textContent = `Suggested: ${candidate.title}.${warning || genreError ? ` ${warning || genreError}` : ''}`;
    } else {
      status.textContent = hasMore ? 'No eligible picks in these five source batches. Pick another to search further.' : shown.size ? 'No more eligible picks — this session is exhausted. Change filters to start again.' : 'No eligible picks in the available catalogue results. Try different filters.';
      if (warning || genreError) status.textContent += ` ${warning || genreError}`;
    }
    retry.hidden = !(warning || genreError); controls();
  }
  async function choose({ force = false } = {}) {
    if (!opened || !alive || busy) return;
    if (store.loadError) { recovery(); return; }
    const cached = selectPickerCandidate(pool, store.getState(), shown, filters, lists, random);
    if (cached && !force) { render(cached); return; }
    if (!hasMore && !retryPlan && !genreError) { render(null); return; }
    const token = ++revision; controller?.abort(); controller = new AbortController(); const { signal } = controller;
    busy = true; status.textContent = 'Finding a pick…'; retry.hidden = true; controls();
    let activePage = retryPlan?.id ?? page;
    try {
      // Metadata and candidate requests may race; only this request revision can commit.
      const genreRequest = Object.keys(lists).length ? Promise.resolve(lists) : fetchJSON('/api/genres', { signal }, fetchImpl);
      let candidate = null;
      for (let count = 0; count < 5 && (hasMore || retryPlan || (count === 0 && genreError)); count++) {
        const state = store.getState(), preferences = pickerPreferences(state.preferences, filters, lists);
        const sourcePage = retryPlan?.id ?? page;
        activePage = sourcePage;
        const plan = retryPlan?.plan ?? sourcePlan(state, preferences);
        retryPlan = null; plans.set(sourcePage, plan);
        const requestTotals = new Map(totals);
        const [metadata, batchResult] = await Promise.allSettled([genreRequest,
          loadBatch(preferences, { page: plan.discoveryPages.values().next().value ?? sourcePage, ...plan, lists, signal, fetchImpl, totals: requestTotals })]);
        if (!alive || !opened || token !== revision || signal.aborted) return;
        if (metadata.status === 'fulfilled') { lists = metadata.value; genreError = ''; genres(); }
        else genreError = 'Genre names unavailable. Retry to load them.';
        if (batchResult.status === 'rejected') throw batchResult.reason;
        const batch = batchResult.value;
        if (!Array.isArray(batch.candidates)) throw new Error('Unexpected catalogue results.');
        if (batch.errors?.length && !batch.candidates.length) throw batch.errors[0];
        for (const [format, total] of requestTotals) totals.set(format, total);
        if (batch.errors?.length) failedPages.add(sourcePage); else failedPages.delete(sourcePage);
        syncFailures();
        // Missing totals are not evidence for 500 pages. A failed source stays
        // attached to its page-one Retry plan until its real range is learned.
        for (const key of [...plan.discoveryPages.keys(), ...plan.seeds.map(seed => `related:${seed.catalogueId}`)]) {
          if (!totals.has(key)) totals.set(key, 1);
        }
        pool.push(...batch.candidates); page = Math.max(page, sourcePage + 1); hasMore = remaining(state, preferences);
        // Bootstrap page one learns real ranges; an opening also draws a fresh
        // source page before choosing, rather than recycling For you's first pool.
        const bootstrap = sourcePage === 1 && count === 0 && hasMore && [...requestTotals.values()].some(total => total > 1);
        if (bootstrap) {
          // Page one calibrates broad discovery ranges, not a second For you
          // grid. Retain explicit liked-related matches and sole-page formats;
          // wider discovery formats get their picks from fresh random pages.
          const likedIds = new Set(state.library.filter(item => item.liked === true).map(item => item.catalogueId));
          pool = pool.filter(item => (totals.get(item.format) ?? 1) <= 1 || (item.relatedTo || []).some(id => likedIds.has(id)));
        }
        candidate = selectPickerCandidate(pool, store.getState(), shown, filters, lists, random);
        if (candidate && !bootstrap) break;
      }
      if (token !== revision || !opened) return;
      busy = false; render(candidate);
    } catch (error) {
      if (token !== revision || !opened || signal.aborted) return;
      busy = false; failedPages.add(activePage); syncFailures(); status.textContent = `Could not load picks. ${error instanceof Error ? error.message : 'Catalogue unavailable.'}`; retry.hidden = false; controls();
    }
  }
  function reset() {
    invalidate(); pool = []; shown = new Set(); page = 1; hasMore = true; totals.clear(); failedPages.clear(); visited.clear(); plans.clear(); retryPlan = null; current = null; warning = ''; failedPage = null; result.replaceChildren();
  }
  function open() {
    if (!alive || opened) return;
    opened = true; reset(); lists = {}; genreError = ''; filters = {}; $('format').value = ''; $('genre').value = ''; genres();
    dialog.showModal(); $('heading').focus({ preventScroll: true }); void choose();
  }
  function close() {
    if (!opened) return; opened = false; invalidate(); result.replaceChildren(); current = null;
    if (dialog.open) dialog.close(); opener.focus({ preventScroll: true });
  }
  function changed() {
    invalidate(); result.replaceChildren(); current = null; status.textContent = 'Apply filters to start a new pick session.'; next.disabled = true; retry.hidden = true;
  }
  listen(opener, 'click', open); listen($('close'), 'click', close);
  listen(dialog, 'cancel', event => { event.preventDefault(); close(); });
  // A queued close event from the previous opening must not close a reopened dialog.
  listen(dialog, 'close', () => { if (!dialog.open) close(); });
  listen($('format'), 'change', () => { changed(); genres(); }); listen($('genre'), 'change', changed);
  listen($('apply'), 'click', () => { filters = { format: $('format').value, genre: $('genre').value }; reset(); void choose(); });
  listen(next, 'click', () => { void choose(); });
  listen(retry, 'click', () => {
    invalidate(); if (genreError) lists = {};
    if (failedPage !== null) { retryPlan = { id: failedPage, plan: plans.get(failedPage) }; }
    // Do not repeat the last pick when a partial source is retried.
    void choose({ force: true });
  });
  listen(window, 'pagehide', close);
  const unsubscribe = store.subscribe?.(() => {
    if (!opened) return;
    if (store.loadError) { recovery(); return; }
    if (current && !selectPickerCandidate([current], store.getState(), new Set(), filters, lists, () => 0)) {
      current = null; result.replaceChildren(); if (!busy) void choose();
    } else controls();
  });
  return { open, close, destroy() { close(); alive = false; invalidate(); listeners.forEach(remove => remove()); unsubscribe?.(); } };
}
