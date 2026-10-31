import { createPoster } from './poster.mjs';

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const knownCount = value => Number.isInteger(value) && value >= 0;

// Match the existing poster helper's local-fixture policy, with malformed URLs
// rejected before calling it. No data:, blob:, credentials, or arbitrary hosts.
function imageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, location.href);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) return null;
    if (url.origin === location.origin || (url.protocol === 'https:' && url.hostname === 'image.tmdb.org' && !url.port)) return url.href;
  } catch { /* Missing/invalid artwork has the same honest fallback. */ }
  return null;
}

function watchUrl(value, candidate, region) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const type = candidate.format === 'series' ? 'tv' : 'movie';
    const id = String(candidate.tmdbId);
    if (!/^[1-9]\d*$/.test(id)) return null;
    const path = new RegExp(`^/${type}/${id}(?:-[a-zA-Z0-9_-]+)?/watch/?$`);
    if (url.protocol === 'https:' && ['www.themoviedb.org', 'themoviedb.org'].includes(url.hostname) && !url.port && !url.username && !url.password && path.test(url.pathname) && url.searchParams.get('locale') === region && !url.hash) return url.href;
  } catch { /* A provider name is not a verified direct-service link. */ }
  return null;
}

function externalLink(text, href, className) {
  const link = node('a', className, text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

export function createTitlePanel(container, { fetchImpl = (...args) => fetch(...args), onMetadata = () => {} } = {}) {
  let metadata = null;
  let presentationOptions = null;
  let revision = 0;
  let controller = null;
  const root = node('section', 'title-panel');
  root.setAttribute('aria-label', 'Selected title details');
  container.replaceChildren(root);

  function retryButton(candidate, options, loading) {
    const button = node('button', 'title-panel__retry', 'Retry');
    button.type = 'button';
    button.disabled = loading;
    // Keep resolved primary metadata during an availability-only retry.
    button.addEventListener('click', () => { void request(candidate, options, metadata !== null); });
    return button;
  }

  function render(candidate, details, options, { loading = false, failed = false } = {}) {
    root.replaceChildren();
    root.setAttribute('aria-busy', String(loading));
    const identity = { ...candidate, title: details?.title ?? candidate.title, year: details?.year ?? candidate.year, posterUrl: imageUrl(details?.posterUrl ?? candidate.posterUrl) };
    const background = imageUrl(details?.backdropUrl) ?? identity.posterUrl;
    if (background) {
      const backdrop = node('img', 'title-panel__backdrop');
      backdrop.alt = '';
      backdrop.setAttribute('aria-hidden', 'true');
      backdrop.src = background;
      backdrop.addEventListener('error', () => backdrop.remove(), { once: true });
      root.append(backdrop);
    }
    const cover = node('div', 'title-panel__cover');
    cover.append(createPoster(identity, { loading: 'eager' }));
    const info = node('div', 'title-panel__info');
    const titleRow = node('div', 'title-panel__title-row');
    titleRow.append(node('h3', 'title-panel__title', identity.title));
    const anime = typeof options.animeOverride === 'boolean' ? options.animeOverride : details?.anime === true;
    if (anime) titleRow.append(node('span', 'title-panel__anime', 'Anime'));
    info.append(titleRow, node('p', 'title-panel__identity', `${identity.year ?? 'Year unknown'} • ${candidate.format === 'series' ? 'Series' : 'Movie'}`), node('p', 'title-panel__rating', 'IMDb — (not connected)'));
    if (candidate.format === 'series' && Number.isSafeInteger(candidate.tmdbId) && candidate.tmdbId > 0 && candidate.catalogueId === `tmdb:series:${candidate.tmdbId}`) {
      const episodesLink = node('a', 'title-panel__episodes-link', 'Seasons & episodes →');
      episodesLink.href = `series.html?id=${candidate.tmdbId}`;
      info.append(episodesLink);
    }
    if (details) {
      let facts;
      if (candidate.format === 'series') {
        const seasons = knownCount(details.seasons) ? `${details.seasons} ${details.seasons === 1 ? 'season' : 'seasons'}` : 'Seasons —';
        const episodes = knownCount(details.episodes) ? `${details.episodes} ${details.episodes === 1 ? 'episode' : 'episodes'}` : 'Episodes —';
        facts = `${seasons} • ${episodes}`;
      } else facts = knownCount(details.runtimeMinutes) ? `${details.runtimeMinutes} min` : 'Runtime —';
      info.append(node('p', 'title-panel__facts', facts));
      const genres = Array.isArray(details.genres) ? details.genres.filter(genre => typeof genre?.name === 'string').map(genre => genre.name) : [];
      info.append(node('p', 'title-panel__genres', genres.length ? genres.join(' • ') : 'Genres —'));
      info.append(node('p', 'title-panel__overview', typeof details.overview === 'string' && details.overview.trim() ? details.overview : 'Overview not listed'));
    } else {
      const status = node('div', 'title-panel__status');
      status.setAttribute('role', 'status');
      status.append(node('p', '', failed ? 'Details could not be loaded' : 'Loading details…'));
      if (failed) status.append(retryButton(candidate, options, loading));
      info.append(status);
    }

    const availability = node('div', 'title-panel__availability');
    availability.append(node('p', 'title-panel__watch-heading', `Where to watch • ${options.region}`));
    const watch = details?.watch;
    if (details && (failed || watch?.status === 'error')) {
      const status = node('div', 'title-panel__status');
      status.setAttribute('role', 'status');
      status.append(node('p', '', 'Availability could not be loaded'), retryButton(candidate, options, loading));
      availability.append(status);
    } else if (!details) {
      availability.append(node('p', 'title-panel__watch-note', failed ? 'Availability not loaded' : 'Checking availability…'));
    } else {
      const offers = Array.isArray(watch?.offers) ? watch.offers : [];
      const groups = [['stream', 'Stream'], ['free', 'Free'], ['ads', 'With ads'], ['rent', 'Rent'], ['buy', 'Buy']];
      let listed = false;
      if (watch?.status === 'ok') {
        for (const [kind, label] of groups) {
          const matching = offers.filter(offer => offer?.kind === kind && typeof offer.name === 'string');
          if (!matching.length) continue;
          listed = true;
          const group = node('div', 'title-panel__watch-group');
          group.dataset.watchKind = kind;
          group.append(node('span', 'title-panel__watch-label', label));
          const badges = node('div', 'title-panel__badges');
          for (const offer of matching) {
            const badge = node('span', 'title-panel__provider');
            const logo = imageUrl(offer.logoUrl);
            if (logo) {
              const image = node('img', 'title-panel__provider-logo');
              image.alt = '';
              image.loading = 'lazy';
              image.src = logo;
              image.addEventListener('error', () => image.remove(), { once: true });
              badge.append(image);
            }
            badge.append(node('span', '', offer.name));
            badges.append(badge);
          }
          group.append(badges);
          availability.append(group);
        }
      }
      if (!listed) availability.append(node('p', 'title-panel__watch-note', 'Availability not listed'));
      const link = watch?.status === 'ok' ? watchUrl(watch.link, candidate, options.region) : null;
      if (link) availability.append(externalLink('Watch options ↗', link, 'title-panel__watch-link'));
    }
    availability.append(externalLink('Availability by JustWatch', 'https://www.justwatch.com/', 'title-panel__attribution'));
    info.append(availability);
    root.append(cover, info);
  }

  async function request(candidate, options, retain = false) {
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    const current = ++revision;
    if (!retain) metadata = null;
    render(candidate, metadata, options, { loading: true });
    const query = new URLSearchParams({ format: candidate.format, id: String(candidate.tmdbId), region: options.region });
    let result;
    try {
      const response = await fetchImpl(`/api/title?${query}`, { method: 'GET', signal: requestController.signal });
      if (!response.ok) throw new Error('Details request failed');
      result = await response.json();
      if (current !== revision || requestController.signal.aborted) return;
      if (!result || typeof candidate.catalogueId !== 'string' || result.catalogueId !== candidate.catalogueId) throw new Error('Title identity mismatch');
      metadata = result;
      render(candidate, result, options);
    } catch {
      if (current !== revision || requestController.signal.aborted) return;
      render(candidate, metadata, options, { failed: true });
      return;
    } finally {
      if (controller === requestController) controller = null;
    }
    if (current === revision) onMetadata(result);
  }

  async function show(candidate, { region = 'NG', animeOverride = null } = {}) {
    presentationOptions = { region, animeOverride };
    return request({ ...candidate }, presentationOptions);
  }
  function updatePresentation({ animeOverride } = {}) {
    if (!presentationOptions) return;
    presentationOptions.animeOverride = animeOverride;
    const row = root.querySelector('.title-panel__title-row');
    const anime = typeof animeOverride === 'boolean' ? animeOverride : metadata?.anime === true;
    const badge = row?.querySelector('.title-panel__anime');
    if (anime && row && !badge) row.append(node('span', 'title-panel__anime', 'Anime'));
    if (!anime) badge?.remove();
  }
  function cancel() { ++revision; controller?.abort(); controller = null; root.setAttribute('aria-busy', 'false'); }
  return { show, updatePresentation, getMetadata: () => metadata, cancel };
}
