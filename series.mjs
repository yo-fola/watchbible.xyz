import { appStore } from './app.mjs';
import { decorateActionButton } from './film-card.mjs';

export function safeSeriesImage(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'image.tmdb.org' && !url.username && !url.password && !url.port && /^\/t\/p\/(w\d+|original)\/[a-zA-Z0-9._-]+$/.test(url.pathname) && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}
export function episodeAvailability(episode, today = new Date().toISOString().slice(0, 10)) {
  const date = episode?.airDate;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'unknown';
  const time = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(time.getTime()) || time.toISOString().slice(0, 10) !== date) return 'unknown';
  return date > today ? 'upcoming' : 'released';
}
const positive = number => Number.isSafeInteger(number) && number > 0;

// Injectable transport/store/model keep synthetic verification separate from saved history.
export function mountSeries(host, { store = appStore, fetchImpl = globalThis.fetch, url = new URL(globalThis.location.href), model: injectedModel, metadata = null, showHeader = true } = {}) {
  const doc = host.ownerDocument;
  let title = null, season = null, seasons = [], selected = null, revision = 0, controller, destroyed = false, model;
  let header, select, list, progress, feedback, notice;
  const idText = url.searchParams.get('id');
  const seriesId = /^[1-9]\d*$/.test(idText || '') ? Number(idText) : NaN;
  const requested = url.searchParams.get('season');
  const desiredSeason = /^(0|[1-9]\d*)$/.test(requested || '') ? Number(requested) : null;
  const el = (tag, text, className) => { const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  function image(url, name, className, missing) {
    const frame = el('div', undefined, className); const fallback = el('span', missing, 'series-image-fallback'); frame.append(fallback);
    const source = safeSeriesImage(url);
    if (source) {
      const img = el('img'); img.alt = name; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.addEventListener('load', () => { fallback.hidden = true; });
      img.addEventListener('error', () => { img.remove(); fallback.hidden = false; }, { once: true });
      img.src = source; frame.append(img);
    }
    return frame;
  }
  function message(text, retry, error = false) {
    feedback.replaceChildren(el('span', text)); feedback.dataset.error = String(error);
    if (retry) { const button = el('button', 'Retry', 'quiet-button'); button.type = 'button'; button.dataset.seriesRetry = ''; button.addEventListener('click', retry); feedback.append(button); }
  }
  function scaffold() {
    host.replaceChildren();
    header = el('header', undefined, 'series-header');
    const toolbar = el('div', undefined, 'series-toolbar'); const label = el('label', 'Episodes'); label.htmlFor = 'series-seasons';
    select = el('select'); select.id = 'series-seasons'; select.disabled = true; label.append(select);
    progress = el('p'); progress.id = 'season-progress'; progress.setAttribute('role', 'status');
    toolbar.append(label, progress);
    notice = el('p', 'Browse freely. Progress changes only when you choose an episode status. Saved in this browser only.', 'series-notice');
    feedback = el('div', undefined, 'series-feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    list = el('div'); list.id = 'episode-list'; list.setAttribute('aria-label', 'Episodes');
    const footer = el('footer', undefined, 'series-footer');
    const credit = el('a', 'Episode metadata and artwork: TMDB ↗'); credit.href = 'https://www.themoviedb.org/'; credit.target = '_blank'; credit.rel = 'noopener noreferrer';
    footer.append(credit, el('p', 'This product uses the TMDB API but is not endorsed or certified by TMDB. TV progress does not earn movie XP.'));
    if (showHeader) host.append(header);
    host.append(toolbar, notice, feedback, list, footer);
    select.addEventListener('change', () => { void selectSeason(Number(select.value)); });
  }
  function renderTitle() {
    if (showHeader) {
      header.replaceChildren(image(title.posterUrl, `${title.title} poster`, 'series-poster', 'Poster unavailable'));
      const info = el('div'); info.append(el('p', 'Series / Episode guide', 'series-kicker'), el('h1', title.title), el('p', title.overview || 'No description available.', 'series-overview')); header.append(info);
    }
    const regular = el('optgroup'); regular.label = 'Seasons'; const specials = el('optgroup'); specials.label = 'Specials';
    for (const item of seasons) { const option = el('option', item.seasonNumber === 0 ? 'Specials' : item.name || `Season ${item.seasonNumber}`); option.value = String(item.seasonNumber); (item.seasonNumber === 0 ? specials : regular).append(option); }
    select.replaceChildren(); if (regular.children.length) select.append(regular); if (specials.children.length) select.append(specials); select.disabled = seasons.length === 0;
    if (store.loadError) notice.textContent = 'Saved data could not be loaded. Browsing is read-only; open Settings & backups to recover your data.';
  }
  function renderEpisodes() {
    if (!season || destroyed) return;
    const active = doc.activeElement; const focusId = active?.closest('article[data-episode-id]')?.dataset.episodeId; const focusStatus = active?.dataset.episodeStatus;
    const state = store.getState();
    list.replaceChildren();
    const result = model.getSeasonProgress(state, season);
    progress.textContent = `${result.watched} / ${result.total} watched${result.complete && season.episodes.length > 0 ? ' · Season complete' : result.caughtUp ? ' · Caught up with released episodes' : ''}`;
    if (!season.episodes.length) { list.append(el('p', 'No episodes listed for this season. Completion is not known.', 'series-notice')); return; }
    for (const episode of season.episodes) {
      const row = el('article', undefined, 'episode-row'); row.dataset.episodeId = String(episode.episodeId);
      const info = el('div', undefined, 'episode-info'); const heading = el('div', undefined, 'episode-heading');
      const name = el('h3'); name.id = `episode-title-${seriesId}-${episode.episodeId}`; name.append(el('span', String(episode.episodeNumber).padStart(2, '0'), 'episode-number'), doc.createTextNode(episode.name || `Episode ${episode.episodeNumber}`)); row.setAttribute('aria-labelledby', name.id);
      heading.append(name, el('span', Number.isFinite(episode.runtimeMinutes) && episode.runtimeMinutes > 0 ? `${episode.runtimeMinutes} min` : 'Runtime —', 'episode-runtime'));
      info.append(heading, el('p', episode.overview?.trim() || 'No description available.', 'episode-overview'));
      const availability = episodeAvailability(episode);
      const record = (state.episodeProgress || []).find(item => item.seriesId === seriesId && item.seasonNumber === season.seasonNumber && item.episodeNumber === episode.episodeNumber && item.episodeId === episode.episodeId);
      const actions = el('div', undefined, 'episode-actions'); actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', `Status for episode ${episode.episodeNumber}`);
      for (const [status, label] of [['watched', 'Watched'], ['watching', 'Currently watching'], ['clear', 'Not watched']]) {
        const button = el('button', label); button.type = 'button'; button.dataset.episodeStatus = status;
        button.setAttribute('aria-pressed', String(status === 'clear' ? !record : record?.status === status));
        decorateActionButton(button, status);
        button.disabled = Boolean(store.loadError) || availability !== 'released';
        button.addEventListener('click', () => {
          if (button.disabled || destroyed) return;
          try {
            store.transact(draft => model.setEpisodeStatus(draft, title, season, episode, status === 'clear' ? null : status));
            message(status === 'clear' ? 'Episode marked not watched. Saved in this browser.' : 'Episode progress saved in this browser.');
          } catch { message('Could not save episode progress. Browser storage may be full or unavailable. Your previous saved progress has not changed; try again or open Settings & backups.', null, true); }
        });
        actions.append(button);
      }
      info.append(actions);
      if (availability !== 'released') info.append(el('p', availability === 'upcoming' ? `Upcoming · ${episode.airDate}. Progress unavailable until release.` : 'Air date unknown · progress unavailable.', 'episode-availability'));
      row.append(image(episode.stillUrl, `Still from ${episode.name || `episode ${episode.episodeNumber}`}`, 'episode-still', 'Still unavailable'), info); list.append(row);
    }
    if (focusId && focusStatus) [...list.querySelectorAll('article')].find(row => row.dataset.episodeId === focusId)?.querySelector(`[data-episode-status="${focusStatus}"]`)?.focus({ preventScroll: true });
  }
  async function request(path, signal) {
    const response = await fetchImpl(path, { method: 'GET', signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Catalogue request failed');
    return response.json();
  }
  async function selectSeason(number) {
    if (!title || !seasons.some(item => item.seasonNumber === number) || destroyed) return;
    selected = number; select.value = String(number); const token = ++revision; controller?.abort(); controller = new AbortController();
    season = null; list.replaceChildren(); list.setAttribute('aria-busy', 'true'); progress.textContent = ''; message('Loading episodes…');
    try {
      const data = await request(`/api/season?seriesId=${seriesId}&season=${number}`, controller.signal);
      if (token !== revision || destroyed) return;
      if (data.catalogueId !== `tmdb:series:${seriesId}` || data.seriesId !== seriesId || data.seasonNumber !== number || !Array.isArray(data.episodes)) throw new Error('Mismatched season');
      const ids = new Set(), numbers = new Set();
      for (const episode of data.episodes) {
        if (!positive(episode.episodeId) || !positive(episode.episodeNumber) || episode.seasonNumber !== number || ids.has(episode.episodeId) || numbers.has(episode.episodeNumber)) throw new Error('Invalid episode checklist');
        ids.add(episode.episodeId); numbers.add(episode.episodeNumber);
      }
      season = { ...data, episodes: [...data.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber) };
      message(''); renderEpisodes();
    } catch { if (token === revision && !destroyed) message('Episodes could not be loaded. Your saved progress is unchanged.', () => { void selectSeason(number); }, true); }
    finally { if (token === revision && !destroyed) list.setAttribute('aria-busy', 'false'); }
  }
  async function load() {
    const token = ++revision; controller?.abort(); controller = new AbortController(); message('Loading series…');
    try {
      model = injectedModel || await import('./episode-progress.mjs');
      const region = store.getState().preferences.region;
      const data = metadata ?? await request(`/api/title?format=series&id=${seriesId}&region=${encodeURIComponent(region)}`, controller.signal);
      if (token !== revision || destroyed) return;
      if (data.catalogueId !== `tmdb:series:${seriesId}` || data.format !== 'series' || typeof data.title !== 'string' || !Array.isArray(data.seasonList)) throw new Error('Mismatched series');
      title = data; seasons = data.seasonList.filter(item => Number.isSafeInteger(item.seasonNumber) && item.seasonNumber >= 0).sort((a, b) => a.seasonNumber - b.seasonNumber);
      renderTitle();
      const first = seasons.find(item => item.seasonNumber > 0) || seasons[0];
      if (!first) { message('No seasons listed. Completion is not known.'); return; }
      await selectSeason(seasons.some(item => item.seasonNumber === desiredSeason) ? desiredSeason : first.seasonNumber);
    } catch { if (token === revision && !destroyed) message('Series details could not be loaded. Your saved progress is unchanged.', () => { void load(); }, true); }
  }
  scaffold();
  const unsubscribe = store.subscribe(renderEpisodes);
  const ready = positive(seriesId) ? load() : Promise.resolve(message('A valid TMDB series ID is required. Return to Library to choose a series.', null, true));
  return { ready, selectSeason, getMetadata: () => title, destroy() { destroyed = true; revision++; controller?.abort(); unsubscribe(); } };
}

if (typeof document !== 'undefined') {
  const start = () => { const host = document.getElementById('series-browser'); if (host) mountSeries(host); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}
