import { decorateActionButton, createStarRating } from './film-card.mjs';

export function parseTitleRoute(url) {
  const formats = url.searchParams.getAll('format'), ids = url.searchParams.getAll('id');
  if (formats.length !== 1 || ids.length !== 1 || !['movie', 'series'].includes(formats[0]) || !/^[1-9]\d*$/.test(ids[0])) return null;
  const tmdbId = Number(ids[0]);
  return Number.isSafeInteger(tmdbId) ? { format: formats[0], tmdbId, catalogueId: `tmdb:${formats[0]}:${tmdbId}` } : null;
}

export async function loadTitlePageDependencies() {
  return Promise.all([import('./title-panel.mjs'), import('./series.mjs'), import('./library-actions.mjs')]);
}

// Browsing is read-only. Only explicit action handlers transact against the store.
export function mountTitlePage(host, { store, fetchImpl = globalThis.fetch, url = new URL(globalThis.location.href) } = {}) {
  const doc = host.ownerDocument;
  const el = (tag, text, className) => { const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  let destroyed = false, panel, episodes, preferenceActions, unsubscribe = () => {}, metadata = null, episodeReady = Promise.resolve();
  host.replaceChildren(); host.classList.add('title-page-content');
  const nav = el('nav', undefined, 'title-page-nav'); nav.setAttribute('aria-label', 'Title navigation');
  for (const [text, href] of [['← Back', 'library.html'], ['Library', 'library.html'], ['Home', 'index.html']]) { const link = el('a', text); link.href = href; nav.append(link); }
  const back = nav.firstElementChild;
  back.addEventListener('click', event => {
    try {
      // Privacy policy hides prior URLs; use navigation capability instead.
      // This is an explicit Back action, never an automatic redirect.
      const canReturn = globalThis.navigation?.canGoBack || (doc.referrer && new URL(doc.referrer).origin === url.origin && globalThis.history.length > 1);
      if (canReturn) { event.preventDefault(); globalThis.history.back(); }
    } catch { /* Library remains a safe fallback when history is unavailable. */ }
  });
  const heading = el('h1', 'Title details');
  const notice = el('p', 'Browse freely. Changes are saved only when you choose an action, in this browser only.', 'title-page-notice');
  const recovery = el('a', 'Settings & backups →'); recovery.href = 'setup.html';
  const feedback = el('p', '', 'title-page-feedback'); feedback.setAttribute('role', 'status');
  host.append(nav, heading, notice, recovery, feedback);
  const route = parseTitleRoute(url);
  if (!route) { feedback.textContent = 'A valid movie or series format and positive TMDB ID are required. Choose a title from Library or Home.'; return { ready: Promise.resolve(), destroy() { destroyed = true; } }; }
  const details = el('div'); const actions = el('div', undefined, 'title-page-actions'); actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', 'Your title status');
  const episodeHost = el('section'); episodeHost.id = 'title-episodes';
  const rating = createStarRating({ document: doc, disabled: true, onChange(value) {
    if (destroyed || !metadata || !preferenceActions || store.loadError) return false;
    try {
      store.transact(draft => preferenceActions.setPersonalRating(draft, metadata, value));
      feedback.textContent = value === null ? 'Your rating was cleared.' : `Your rating: ${value} / 5 stars. Saved in this browser.`;
      return true;
    } catch { feedback.textContent = 'Not saved. Your previous rating is unchanged. Check browser storage or open Settings & backups.'; return false; }
  } });
  const legacyRating = el('p', '', 'note legacy-rating');
  host.append(details, actions, rating.element, legacyRating, episodeHost);
  const buttons = new Map();
  for (const [action, label] of [['watched', 'Watched'], ['watching', 'Watching'], ['watch_later', 'Watch later'], ['not_for_me', 'Not for me'], ['like', 'Like']]) { const button = el('button', label, 'quiet-button'); button.type = 'button'; button.dataset.titleAction = action; button.disabled = true; decorateActionButton(button, action); actions.append(button); buttons.set(action, button); }
  function refresh() {
    if (destroyed || !store) return;
    const state = store.getState(), saved = state.library.find(item => item.catalogueId === route.catalogueId);
    const locked = Boolean(store.loadError);
    rating.update({ value: preferenceActions?.getPersonalRating(saved) ?? null, disabled: locked || !metadata });
    legacyRating.textContent = saved?.personalRating != null && saved.personalRatingScale !== 5 ? `Earlier rating: ${saved.personalRating} / 10. Shown on five stars without changing the original score.` : '';
    legacyRating.hidden = !legacyRating.textContent;
    notice.textContent = locked ? 'Saved data could not be loaded. Browsing is read-only; open Settings & backups to recover your data.' : 'Browse freely. Changes are saved only when you choose an action, in this browser only.';
    for (const [action, button] of buttons) {
      button.disabled = locked || !metadata || (action === 'not_for_me' && Boolean(saved));
      button.setAttribute('aria-pressed', String(action === 'like' ? saved?.liked === true : action === 'not_for_me' ? state.dismissed.includes(route.catalogueId) : saved?.status === ({ watched: 'watched', watching: 'watching', watch_later: 'plan_to_watch' })[action]));
    }
    buttons.get('not_for_me').title = saved ? 'Already in your library. Your saved history will not be removed.' : 'Exclude this title from recommendations';
  }
  const ready = (async () => {
    if (!store) { const { appStore } = await import('./app.mjs'); store = appStore; }
    const [{ createTitlePanel }, { mountSeries }, actionModule] = await loadTitlePageDependencies();
    const { applyTitleChoice, toLibraryEntry, setTitleLike } = actionModule; preferenceActions = actionModule;
    if (destroyed) return;
    unsubscribe = store.subscribe(refresh); refresh();
    for (const [action, button] of buttons) button.addEventListener('click', () => {
      if (destroyed || button.disabled || !metadata) return;
      try {
        store.transact(draft => {
          const saved = draft.library.find(item => item.catalogueId === route.catalogueId);
          if (action === 'like') setTitleLike(draft, metadata, saved?.liked !== true);
          else if (action === 'watching') {
            const entry = toLibraryEntry(metadata, saved);
            entry.status = 'watching';
            if (saved) draft.library[draft.library.indexOf(saved)] = entry; else draft.library.push(entry);
            draft.dismissed = draft.dismissed.filter(id => id !== route.catalogueId);
          } else applyTitleChoice(draft, metadata, action);
        });
        feedback.textContent = 'Saved in this browser.';
      } catch { feedback.textContent = 'Not saved. Your previous data is unchanged. Check browser storage or open Settings & backups.'; }
    });
    // Validate the complete identity before the shared panel can render a response.
    const guardedFetch = async (...args) => {
      const response = await fetchImpl(...args);
      if (!response.ok) return response;
      const data = await response.json();
      if (data?.catalogueId !== route.catalogueId || data?.tmdbId !== route.tmdbId || data?.format !== route.format || typeof data.title !== 'string' || !data.title.trim()) throw Error('Mismatched title response');
      return { ok: true, json: async () => data };
    };
    panel = createTitlePanel(details, { fetchImpl: guardedFetch, onMetadata(data) {
      if (destroyed) return;
      metadata = data; heading.textContent = data.title; refresh();
      // The existing panel's link now targets the episode guide on this page.
      const jump = details.querySelector('.title-panel__episodes-link'); if (jump) jump.href = '#title-episodes';
      if (route.format === 'series' && !episodes) {
        episodes = mountSeries(episodeHost, { store, fetchImpl, url, metadata: data, showHeader: false });
        episodeReady = episodes.ready;
      }
    } });
    const saved = store.getState().library.find(item => item.catalogueId === route.catalogueId);
    await panel.show({ ...route, title: saved?.title || 'Loading title…', posterUrl: saved?.posterUrl ?? null }, { region: store.getState().preferences.region, animeOverride: saved?.anime ?? null });
    if (!destroyed) await episodeReady;
  })().catch(() => { if (!destroyed) feedback.textContent = 'The title page could not start. Reload this page or return to Library. Your saved data is unchanged.'; });
  return { ready, destroy() { destroyed = true; panel?.cancel(); episodes?.destroy(); unsubscribe(); } };
}

if (typeof document !== 'undefined') {
  const start = () => { const host = document.getElementById('title-page'); if (host) mountTitlePage(host); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}
