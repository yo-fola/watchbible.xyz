// Synthetic memory stores and transport only; never writes browser history.
export async function checkPerformance({ only = null } = {}) {
  const [{ mountTitlePage }, { createAppStore }, { createTitlePanel }, { createPoster }] = await Promise.all([
    import('./title-page.mjs'), import('./app-state.mjs'), import('./title-panel.mjs'), import('./poster.mjs'),
  ]);
  const checks = [], check = (name, passed) => checks.push({ name, passed: Boolean(passed) });
  const host = document.createElement('section'); document.body.append(host);
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const title = { catalogueId: 'tmdb:series:990001', sourceUrl: 'https://www.themoviedb.org/tv/990001', provider: 'TMDB', tmdbId: 990001, title: 'Synthetic performance series', format: 'series', genreIds: [], genres: [], anime: false, posterUrl: null, seasonList: [1, 2].map(seasonNumber => ({ seasonNumber, name: `Season ${seasonNumber}` })), watch: { status: 'error', offers: [] } };
  const requests = []; let failWrites = false;
  const memory = new Map();
  const store = createAppStore({ getItem: key => memory.get(key) ?? null, setItem(key, value) { if (failWrites) throw Error('Synthetic quota'); memory.set(key, value); } });
  let instance;
  try {
    if (!only || only === 'episodes' || only === 'retry' || only === 'title') {
      instance = mountTitlePage(host, { store, url: new URL('/title.html?format=series&id=990001', location.origin), fetchImpl: async path => {
        requests.push(path);
        if (path.startsWith('/api/title?')) return { ok: true, json: async () => ({ ...title, watch: { status: requests.filter(p => p.startsWith('/api/title?')).length === 1 ? 'error' : 'unlisted', offers: [] } }) };
        const seasonNumber = Number(new URL(path, location.origin).searchParams.get('season'));
        return { ok: true, json: async () => ({ catalogueId: title.catalogueId, seriesId: title.tmdbId, seasonNumber, episodes: [{ episodeId: 990100 + seasonNumber, episodeNumber: 1, seasonNumber, name: 'Synthetic episode', airDate: '2000-01-01', stillUrl: null }] }) };
      } });
      await instance.ready;
      if (!only || only === 'episodes') {
        const list = host.querySelector('#episode-list'); let renders = 0;
        const replace = list.replaceChildren.bind(list); list.replaceChildren = (...args) => { renders++; return replace(...args); };
        const watched = list.querySelector('[data-episode-status="watched"]'); watched.focus(); watched.click();
        check('One episode DOM replacement per synchronous commit', renders === 1);
        check('Episode status icon and focus survive commit', document.activeElement?.dataset.episodeStatus === 'watched' && document.activeElement.getAttribute('aria-pressed') === 'true' && Boolean(document.activeElement.querySelector('svg')));
        failWrites = true; const before = store.exportJSON();
        list.querySelector('[data-episode-status="watching"]').click();
        check('Failed commit does not render or change saved progress', renders === 1 && store.exportJSON() === before && host.textContent.includes('Could not save episode progress'));
        failWrites = false;
      }
      if (!only || only === 'title') {
        const button = host.querySelector('[data-title-action="like"]'); let refreshes = 0;
        const attr = button.setAttribute.bind(button); button.setAttribute = (name, value) => { if (name === 'aria-pressed') refreshes++; return attr(name, value); };
        button.focus(); button.click();
        check('One title status refresh per synchronous commit', refreshes === 1);
        check('Title icon status and focus survive commit', document.activeElement === button && button.getAttribute('aria-pressed') === 'true' && Boolean(button.querySelector('svg')));
      }
      if (!only || only === 'retry') {
        const select = host.querySelector('#series-seasons'); select.value = '2'; select.dispatchEvent(new Event('change')); await tick();
        const row = host.querySelector('#episode-list article');
        const before = requests.filter(path => path.startsWith('/api/season?')).length;
        host.querySelector('.title-panel__retry').click(); await tick(); await tick();
        check('Availability retry retains episode DOM and selected season', host.querySelector('#series-seasons') === select && select.value === '2' && host.querySelector('#episode-list article') === row);
        check('Availability retry fetches title once and no additional season', requests.filter(path => path.startsWith('/api/title?')).length === 2 && requests.filter(path => path.startsWith('/api/season?')).length === before);
      }
      instance.destroy(); instance = null;
    }
    if (!only || only === 'presentation') {
      let calls = 0, callbacks = 0, resolve;
      const panel = createTitlePanel(host, { fetchImpl: () => { calls++; return new Promise(done => { resolve = done; }); }, onMetadata() { callbacks++; } });
      const pending = panel.show(title);
      if (typeof panel.updatePresentation === 'function') panel.updatePresentation({ animeOverride: true });
      check('Local Anime badge updates while metadata is pending', Boolean(host.querySelector('.title-panel__anime')));
      resolve({ ok: true, json: async () => title }); await pending;
      check('Pending response preserves local Anime override without refetch or callback duplication', calls === 1 && callbacks === 1 && Boolean(host.querySelector('.title-panel__anime')));
      const info = host.querySelector('.title-panel__info');
      if (typeof panel.updatePresentation === 'function') panel.updatePresentation({ animeOverride: false });
      check('Local Anime override is non-fetching and preserves metadata/DOM', calls === 1 && callbacks === 1 && panel.getMetadata() === title && !host.querySelector('.title-panel__anime') && host.querySelector('.title-panel__info') === info);
      panel.cancel();
    }
    if (!only || only === 'poster') {
      const candidate = { ...title, posterUrl: new URL('./examples/test-cover.svg', import.meta.url).href };
      check('Shared card posters default to lazy loading', createPoster(candidate).querySelector('img')?.loading === 'lazy');
      const panel = createTitlePanel(host, { fetchImpl: async () => ({ ok: true, json: async () => candidate }) }); await panel.show(candidate);
      check('Prominent title panel poster remains explicitly eager', host.querySelector('.title-panel__cover img')?.loading === 'eager'); panel.cancel();
    }
  } finally { instance?.destroy(); host.remove(); }
  return { passed: checks.every(check => check.passed), checks, requests };
}
