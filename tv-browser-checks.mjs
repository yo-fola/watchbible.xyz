// Synthetic fixtures only. Run checkTVBrowser() on an owned 8767/8768 origin.
export async function checkTVBrowser() {
  if (!['127.0.0.1', 'localhost'].includes(location.hostname) || !['8767', '8768'].includes(location.port)) throw new Error('Use an owned loopback fixture server on 8767/8768.');
  const { mountSeries } = await import('./series.mjs');
  const { createAppStore, STORAGE_KEY } = await import('./app-state.mjs');
  const checks = [];
  const check = (name, passed) => checks.push({ name, passed: Boolean(passed) });
  const before = localStorage.getItem(STORAGE_KEY);
  const host = document.createElement('section'); document.body.append(host);
  let instance;
  // The real store with isolated memory storage; never seeds the user's library.
  const memory = new Map();
  let failWrites = false;
  const store = createAppStore({ getItem: key => memory.get(key) ?? null, setItem: (key, value) => { if (failWrites) throw new Error('Synthetic quota exceeded'); memory.set(key, value); } });
  const title = { provider: 'TMDB', sourceUrl: 'https://www.themoviedb.org/tv/990001', catalogueId: 'tmdb:series:990001', tmdbId: 990001, title: 'Synthetic episode browser', format: 'series', posterUrl: null, overview: 'Synthetic catalogue fixture.', seasonList: [{ seasonNumber: 0, name: 'Specials', episodeCount: 1 }, { seasonNumber: 1, name: 'Season 1', episodeCount: 4 }, { seasonNumber: 2, name: 'Season 2', episodeCount: 0 }] };
  const episode = (number, extra = {}) => ({ episodeId: 990100 + number, episodeNumber: number, seasonNumber: 1, name: `Synthetic episode ${number}`, overview: 'Actual fixture summary, not user history.', stillUrl: null, runtimeMinutes: 42, airDate: '2000-01-01', ...extra });
  const season = { catalogueId: title.catalogueId, seriesId: 990001, seasonNumber: 1, name: 'Season 1', episodes: [episode(1), episode(2, { name: '<img onerror=alert(1)>', overview: '', stillUrl: 'javascript:alert(1)' }), episode(3, { airDate: '2999-01-01' }), episode(4, { airDate: null })] };
  const requests = []; let fail = false;
  const fetchImpl = async (path, options) => { requests.push({ path, options }); if (fail) throw new Error('Synthetic offline'); const number = Number(new URL(path, location.origin).searchParams.get('season')); return { ok: true, json: async () => path.startsWith('/api/title?') ? title : { ...season, seasonNumber: number, episodes: number === 1 ? season.episodes : [] } }; };
  try {
    instance = mountSeries(host, { store, fetchImpl, url: new URL('/series.html?id=990001', location.origin) });
    await instance.ready;
    check('Catalogue GET includes saved region', requests[0]?.path === '/api/title?format=series&id=990001&region=NG' && requests[0]?.options.method === 'GET');
    check('Regular season default, Specials separately selectable', host.querySelector('#series-seasons')?.value === '1' && host.querySelector('option[value="0"]')?.textContent.includes('Specials'));
    check('Episode articles display real titles, summaries and runtime', host.querySelectorAll('#episode-list article[data-episode-id]').length === 4 && host.textContent.includes('Synthetic episode 1') && host.textContent.includes('42 min') && host.textContent.includes('Actual fixture summary'));
    check('Text and image URLs are safe with honest fallback', !host.querySelector('[onerror]') && !host.querySelector('img[src^="javascript:"]') && host.textContent.includes('No description available'));
    check('Upcoming and unknown-air-date actions are disabled', [...host.querySelectorAll('[data-episode-id="990103"] button, [data-episode-id="990104"] button')].every(button => button.disabled));
    check('Browsing never writes local state', memory.size === 0);
    const watched = host.querySelector('[data-episode-id="990101"] [data-episode-status="watched"]');
    watched.focus(); watched.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    check('Explicit watched click persists exact episode', store.getState().episodeProgress?.some(record => record.episodeId === 990101 && record.status === 'watched'));
    check('Focus survives state render', document.activeElement?.dataset.episodeStatus === 'watched' && document.activeElement.closest('article')?.dataset.episodeId === '990101');
    host.querySelector('[data-episode-id="990101"] [data-episode-status="watching"]').click();
    check('Currently watching corrects watched', store.getState().episodeProgress?.some(record => record.episodeId === 990101 && record.status === 'watching'));
    host.querySelector('[data-episode-id="990101"] [data-episode-status="clear"]').click();
    check('Not watched clears the exact record', !store.getState().episodeProgress?.some(record => record.episodeId === 990101));
    check('No TV XP is awarded', store.getState().gamification.credits.length === 0);
    const beforeQuota = store.exportJSON(); const persistedBeforeQuota = memory.get(STORAGE_KEY);
    failWrites = true;
    host.querySelector('[data-episode-id="990101"] [data-episode-status="watched"]').click();
    check('Quota failure preserves committed and visible progress with honest error', store.exportJSON() === beforeQuota && memory.get(STORAGE_KEY) === persistedBeforeQuota && host.textContent.includes('Could not save episode progress') && host.querySelector('[data-episode-id="990101"] [data-episode-status="watched"]').getAttribute('aria-pressed') === 'false');
    failWrites = false;
    await instance.selectSeason(2);
    check('Empty season cannot show complete', host.querySelector('#episode-list')?.textContent.includes('No episodes') && !host.querySelector('#season-progress')?.textContent.includes('Season complete'));
    fail = true; await instance.selectSeason(1);
    check('Failed season has Retry', Boolean(host.querySelector('[data-series-retry]')));
    fail = false; host.querySelector('[data-series-retry]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    check('Retry loads episodes', host.querySelectorAll('article[data-episode-id]').length === 4);
    // Reuse this host only after unmounting to avoid duplicate IDs/subscribers.
    instance.destroy();
    const deferred = [];
    instance = mountSeries(host, { store, url: new URL('/series.html?id=990001&season=0', location.origin), fetchImpl: async path => {
      if (path.startsWith('/api/title?')) return { ok: true, json: async () => title };
      return new Promise(resolve => deferred.push({ path, resolve }));
    } });
    while (!deferred.length) await new Promise(resolve => setTimeout(resolve, 0));
    check('Explicit Specials URL is selected', host.querySelector('#series-seasons').value === '0');
    const later = instance.selectSeason(2);
    deferred[1].resolve({ ok: true, json: async () => ({ ...season, seasonNumber: 2, episodes: [] }) });
    await later;
    deferred[0].resolve({ ok: true, json: async () => ({ ...season, seasonNumber: 0, episodes: [episode(9, { seasonNumber: 0, name: 'Stale episode must not render' })] }) });
    await instance.ready;
    check('Stale async season cannot replace latest selection', host.querySelector('#series-seasons').value === '2' && !host.textContent.includes('Stale episode must not render'));
    check('Synthetic checks do not alter browser history', localStorage.getItem(STORAGE_KEY) === before);
  } finally {
    instance?.destroy(); host.remove();
    // Restore exact raw text only if an accidental change occurred on this fixture origin.
    if (localStorage.getItem(STORAGE_KEY) !== before) { if (before === null) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, before); }
  }
  return { passed: checks.every(check => check.passed), checks };
}

// Pure checks can run without a browser or server; browser checks remain separate.
if (typeof document === 'undefined') {
  const assert = await import('node:assert/strict');
  const { safeSeriesImage, episodeAvailability } = await import('./series.mjs');
  assert.equal(safeSeriesImage('javascript:alert(1)'), null);
  assert.equal(safeSeriesImage('https://evil.example/still.jpg'), null);
  assert.equal(safeSeriesImage('https://image.tmdb.org/t/p/w500/real.jpg'), 'https://image.tmdb.org/t/p/w500/real.jpg');
  assert.equal(episodeAvailability({ airDate: null }, '2026-01-01'), 'unknown');
  assert.equal(episodeAvailability({ airDate: '2999-01-01' }, '2026-01-01'), 'upcoming');
  assert.equal(episodeAvailability({ airDate: '2000-01-01' }, '2026-01-01'), 'released');
  console.log('TV pure checks passed (6 assertions); browser checks require checkTVBrowser().');
}
