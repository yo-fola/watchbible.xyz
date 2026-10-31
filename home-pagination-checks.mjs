// Run only on an explicitly owned synthetic fixture origin, never live history.
export async function checkHomePagination() {
  if (!['http://127.0.0.1:8767', 'http://127.0.0.1:8768'].includes(location.origin)) throw new Error('Owned synthetic fixture origin required.');
  const checks = [];
  const assert = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
  const $ = id => document.getElementById(id);
  const wait = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 15)); } throw new Error('Pagination timed out'); };
  const { appStore } = await import('./app.mjs');
  const { STORAGE_KEY } = await import('./app-state.mjs');
  const raw = localStorage.getItem(STORAGE_KEY), snapshot = appStore.exportJSON();
  const originalFetch = globalThis.fetch;
  const ids = () => [...document.querySelectorAll('#home-grid article')].map(card => card.dataset.catalogueId);
  const current = () => Number(document.querySelector('#home-page-numbers [aria-current="page"]')?.textContent);
  let calls = [], mode = 'normal';
  try {
    assert($('home-pagination') && $('home-refresh') && !$('home-more'), 'numbered pagination replaces More picks');
    globalThis.fetch = async (path, options) => {
      if (String(path).startsWith('/api/discover')) {
        calls.push(String(path));
        if (mode === 'failure' || (mode === 'partial' && String(path).includes('format=series'))) return Response.json({ error: 'Synthetic outage' }, { status: 503 });
        const response = await originalFetch(path, options);
        if (mode === 'empty') return Response.json({ ...(await response.json()), results: [] });
        return response;
      }
      return originalFetch(path, options);
    };
    await wait(() => !$('home-refresh').disabled && ids().length);
    assert([...$('home-page-numbers').querySelectorAll('button')].map(button => button.textContent).join(',') === '1,2,3,4,5', 'five real provider page numbers rendered');
    const first = ids();
    $('home-search').value = 'drummer'; $('home-search').dispatchEvent(new Event('input'));
    $('home-format').value = 'movie'; $('home-format').dispatchEvent(new Event('change'));
    window.scrollTo(0, document.body.scrollHeight);
    $('home-next').click(); await wait(() => current() === 2 && !$('home-next').disabled);
    await wait(() => window.scrollY === 0);
    assert(document.activeElement === $('home-heading'), 'page change focuses heading and scrolls to top');
    assert($('home-search').value === 'drummer' && $('home-format').value === 'movie', 'page navigation preserves query and format');
    assert(ids().length <= 20 && ids().every(id => !first.includes(id)), 'new page replaces cards, never appends');
    const second = ids(), count = calls.length;
    $('home-prev').click(); await wait(() => current() === 1);
    $('home-next').click(); await wait(() => current() === 2);
    assert(calls.length === count && JSON.stringify(ids()) === JSON.stringify(second), 'bounded cached Previous and Next stay stable without requests');
    $('home-refresh').focus(); $('home-refresh').click(); await wait(() => !$('home-refresh').disabled);
    assert(calls.length > count && calls.slice(count).every(path => path.includes('page=2')), 'Refresh re-fetches current real source page');
    assert(document.activeElement === $('home-refresh'), 'Refresh does not focus heading');
    mode = 'empty'; $('home-refresh').click(); await wait(() => !$('home-refresh').disabled);
    assert(current() === 2 && ids().length === 0, 'Refresh replaces the current cache rather than merging old results');
    $('home-prev').click(); await wait(() => current() === 1);
    $('home-next').click(); await wait(() => current() === 2);
    assert(ids().length === 0, 'cached navigation retains refreshed empty page');
    mode = 'normal'; $('home-refresh').click(); await wait(() => !$('home-refresh').disabled && ids().length);
    mode = 'failure'; $('home-next').click(); await wait(() => !$('home-retry').hidden && !$('home-refresh').disabled);
    assert(current() === 2 && JSON.stringify(ids()) === JSON.stringify(second), 'failed target retains last good page and cards');
    mode = 'normal'; $('home-retry').click(); await wait(() => current() === 3 && !$('home-refresh').disabled);
    assert(calls.at(-1).includes('page=3'), 'Retry remembers failed target');
    mode = 'partial'; $('home-next').click(); await wait(() => current() === 4 && !$('home-refresh').disabled);
    assert(!$('home-retry').hidden && ids().length > 0, 'partial API errors keep successful source results and Retry');
    mode = 'empty'; $('home-next').click(); await wait(() => current() === 5 && !$('home-refresh').disabled);
    assert(ids().length === 0 && $('home-next').disabled, 'valid empty final page moves without inventing more pages');
    mode = 'normal'; $('home-refresh').click(); await wait(() => !$('home-refresh').disabled && ids().length);
    const hidden = ids()[0];
    document.querySelector('#home-grid [data-choice="not_for_me"]').click();
    assert(!ids().includes(hidden) && appStore.getState().dismissed.includes(hidden), 'dismissal excluded immediately on render');
    const saved = ids()[0]; document.querySelector('#home-grid [data-choice="watch_later"]').click();
    assert(!ids().includes(saved) && appStore.getState().library.some(item => item.catalogueId === saved), 'Library save excluded immediately');
    $('home-refresh').click(); await wait(() => !$('home-refresh').disabled);
    assert(current() === 5, 'Refresh retains the current page after a new positive seed is saved');
    assert(!ids().includes(saved) && !ids().includes(hidden), 'refresh reapplies Library and dismissal exclusions');
    const { createAppStore } = await import('./app-state.mjs');
    const reloaded = createAppStore(localStorage).getState();
    assert(reloaded.library.some(item => item.catalogueId === saved) && reloaded.dismissed.includes(hidden), 'saved exclusions survive store recreation');
    const beforeStale = ids();
    const deferred = [];
    globalThis.fetch = (path, options) => String(path).startsWith('/api/discover') ? new Promise(resolve => deferred.push(resolve)) : originalFetch(path, options);
    $('home-refresh').click();
    assert($('home-prev').disabled && $('home-next').disabled && $('home-refresh').disabled && $('home-retry').disabled, 'all request controls disabled while busy');
    window.dispatchEvent(new Event('pagehide'));
    for (const resolve of deferred) resolve(Response.json({ results: [], page: 5, totalPages: 5 }));
    await new Promise(resolve => setTimeout(resolve, 60));
    assert(JSON.stringify(ids()) === JSON.stringify(beforeStale), 'cancelled late response cannot replace the rendered page');
    return { checks: checks.length, passed: checks, synthetic: true };
  } finally {
    globalThis.fetch = originalFetch;
    appStore.restoreJSON(snapshot);
    if (raw === null) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, raw);
  }
}

export async function checkHomeRenderWork() {
  if (!['http://127.0.0.1:8767', 'http://127.0.0.1:8768'].includes(location.origin)) throw new Error('Owned synthetic fixture origin required.');
  const { appStore } = await import('./app.mjs');
  const grid = document.querySelector('#home-grid');
  for (let i = 0; i < 200 && (!grid?.querySelector('article') || document.querySelector('#home-refresh').disabled); i++) await new Promise(resolve => setTimeout(resolve, 20));
  const button = grid?.querySelector('[data-choice="watch_later"]');
  if (!button) throw new Error('Loaded synthetic recommendation page required.');
  const before = appStore.exportJSON();
  const observer = new MutationObserver(() => {}); observer.observe(grid, { childList: true });
  try {
    const id = button.closest('article').dataset.catalogueId;
    button.focus(); button.click();
    const rebuilds = observer.takeRecords().length;
    const checks = [
      { name: 'One saved choice rebuilds the recommendation grid once', passed: rebuilds === 1 },
      { name: 'Optimized save still commits the exact library identity', passed: appStore.getState().library.some(item => item.catalogueId === id) },
      { name: 'Optimized save excludes the card and preserves keyboard focus', passed: ![...grid.children].some(card => card.dataset.catalogueId === id) && document.activeElement.id === 'home-search' },
    ];
    return { passed: checks.every(item => item.passed), gridRebuilds: rebuilds, checks, synthetic: true };
  } finally { observer.disconnect(); appStore.restoreJSON(before); }
}
