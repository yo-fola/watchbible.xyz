// Synthetic fixtures and memory storage only; never changes browser storage.
export async function checkTitlePage() {
  const checks = [], check = (name, value) => checks.push({ name, passed: Boolean(value) });
  const { mountTitlePage } = await import('./title-page.mjs');
  if (typeof mountTitlePage !== 'function') return { passed: false, checks: [{ name: 'Injectable dedicated page mount exists', passed: false }] };
  const { createAppStore } = await import('./app-state.mjs');
  const host = document.createElement('section'); document.body.append(host);
  const memory = new Map(); let writes = 0;
  const store = createAppStore({ getItem: key => memory.get(key) ?? null, setItem: (key, value) => { writes++; memory.set(key, value); } });
  store.transact(draft => { draft.preferences.region = 'GB'; }); writes = 0;
  const hostile = '<img src=x onerror=alert(1)>';
  const movie = { provider: 'TMDB', catalogueId: 'tmdb:movie:671', tmdbId: 671, format: 'movie', title: 'Synthetic movie', overview: hostile, genres: [], year: '2001', posterUrl: null, sourceUrl: 'https://www.themoviedb.org/movie/671', runtimeMinutes: 111, anime: null, watch: { status: 'unlisted', offers: [] } };
  const series = { ...movie, catalogueId: 'tmdb:series:95396', tmdbId: 95396, format: 'series', title: 'Synthetic series', sourceUrl: 'https://www.themoviedb.org/tv/95396', seasons: 1, episodes: 1, seasonList: [{ seasonNumber: 1, name: 'Season 1' }] };
  const season = { catalogueId: series.catalogueId, seriesId: 95396, seasonNumber: 1, episodes: [{ episodeId: 9901, episodeNumber: 1, seasonNumber: 1, name: 'Synthetic pilot', overview: hostile, runtimeMinutes: 40, stillUrl: null, airDate: '2000-01-01' }] };
  const requests = []; let fail = false, page;
  const fetchImpl = async path => { requests.push(path); if (fail) throw Error('Synthetic offline'); return { ok: true, json: async () => path.startsWith('/api/season?') ? season : path.includes('format=series') ? series : movie }; };
  const mount = query => mountTitlePage(host, { store, fetchImpl, url: new URL(`/title.html?${query}`, location.origin) });
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
  try {
    page = mount('format=movie&id=671'); await page.ready;
    check('Movie details, h1, regional watch options without seasons', host.querySelector('h1')?.textContent === movie.title && host.textContent.includes('111 min') && host.textContent.includes('Where to watch • GB') && !requests.some(path => path.startsWith('/api/season?')));
    check('Browsing never saves history', writes === 0);
    check('Metadata is literal text, not executable markup', host.textContent.includes(hostile) && !host.querySelector('[onerror]'));
    host.querySelector('[data-title-action="watching"]').click();
    check('Watching control persists title status', store.getState().library[0]?.status === 'watching');
    store.transact(draft => { Object.assign(draft.library[0], { personalRating: 8, anime: true, imdbId: 'tt1234567' }); });
    host.querySelector('[data-title-action="like"]').click();
    check('Like is independent and preserves user fields', store.getState().library[0]?.liked && store.getState().library[0]?.status === 'watching' && store.getState().library[0]?.personalRating === 8 && store.getState().library[0]?.anime === true && store.getState().library[0]?.imdbId === 'tt1234567');
    host.querySelector('[data-title-action="watched"]').click();
    check('Watched action preserves metadata', store.getState().library[0]?.status === 'watched' && store.getState().library[0]?.personalRating === 8);
    check('Not for me cannot silently discard existing history', host.querySelector('[data-title-action="not_for_me"]')?.disabled);
    page.destroy(); requests.length = 0; const before = writes;
    page = mount('format=series&id=95396'); await page.ready;
    check('TV details and real episode controls share one page, without duplicate hero/fetch', host.querySelectorAll('h1').length === 1 && host.querySelectorAll('.series-header').length === 0 && host.textContent.includes('Synthetic pilot') && requests.filter(path => path.startsWith('/api/title?')).length === 1);
    check('TV browsing does not save', writes === before);
    host.querySelector('[data-episode-status="watched"]').click();
    check('Episode control persists exact episode in memory', store.getState().episodeProgress.some(item => item.episodeId === 9901 && item.status === 'watched'));
    page.destroy();
    for (const query of ['format=tv&id=1', 'format=movie&id=01']) { const n = requests.length; page = mount(query); await page.ready; check(`Invalid route blocked: ${query}`, requests.length === n && host.textContent.includes('valid') && !host.querySelector('[data-title-action]')); page.destroy(); }
    fail = true; page = mount('format=movie&id=671'); await page.ready;
    check('Load failure offers Retry without invented details', host.textContent.includes('Details could not be loaded') && Boolean(host.querySelector('.title-panel__retry')));
    fail = false; host.querySelector('.title-panel__retry').click(); await settle();
    check('Retry restores title metadata and controls', host.querySelector('h1')?.textContent === movie.title && !host.querySelector('[data-title-action="watched"]').disabled);
    page.destroy();
    const locked = createAppStore({ getItem() { throw Error('Synthetic unreadable storage'); }, setItem() { throw Error('Must not write'); } });
    page = mountTitlePage(host, { store: locked, fetchImpl, url: new URL('/title.html?format=series&id=95396', location.origin) }); await page.ready;
    check('Recovery stays read-only with actionable Settings link', [...host.querySelectorAll('[data-title-action], [data-episode-status]')].every(button => button.disabled) && host.textContent.includes('read-only') && Boolean(host.querySelector('a[href="setup.html"]')));
  } finally { page?.destroy(); host.remove(); }
  return { passed: checks.every(item => item.passed), checks };
}

// Read-only checks against the rendered dedicated title page at each viewport.
export async function checkTitlePreferences() {
  const checks=[],check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
  const {mountTitlePage}=await import('./title-page.mjs');
  const {createAppStore}=await import('./app-state.mjs');
  const memory=new Map();let fail=false,writes=0;
  const storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>{if(fail)throw Error('Synthetic full storage');writes++;memory.set(key,value);}};
  const store=createAppStore(storage),host=document.createElement('section');document.body.append(host);
  const fixture={provider:'TMDB',catalogueId:'tmdb:movie:7001',tmdbId:7001,format:'movie',title:'Synthetic star-rating title',overview:'Synthetic metadata only.',genres:[],genreIds:[],year:'2001',posterUrl:null,sourceUrl:'https://www.themoviedb.org/movie/7001',anime:null,watch:{status:'unlisted',offers:[]}};
  const options={store,url:new URL('/title.html?format=movie&id=7001',location.origin),fetchImpl:async()=>({ok:true,json:async()=>fixture})};
  let page=mountTitlePage(host,options);
  const star=n=>host.querySelector(`.personal-rating input[value="${n}"]`);
  const saved=()=>store.getState().library[0];
  try {
    await page.ready;
    check(host.querySelectorAll('.personal-rating input[type="radio"]').length===5,'five personal stars on title page');
    check(writes===0&&host.querySelector('.rating-value').textContent==='Not rated','browsing does not create a score or history');
    star(5).click();check(saved()?.personalRating===5&&saved()?.personalRatingScale===5,'explicit five-star rating persists on five-point scale');
    check(saved()?.status===null&&!saved()?.liked&&store.getState().gamification.credits.length===0,'rating alone never invents viewing, a Like or XP');
    host.querySelector('[data-title-action="like"]').click();check(saved().liked&&saved().status===null&&saved().personalRating===5,'Like adds taste without inventing Watch later');
    host.querySelector('[data-title-action="watching"]').click();check(saved().status==='watching'&&saved().personalRating===5&&saved().liked,'watching preserves rating and independent Like');
    star(2).click();check(saved().personalRating===2&&saved().liked&&saved().status==='watching','changing rating does not overwrite Like/status');
    const fresh=createAppStore(storage);check(fresh.getState().library[0].personalRating===2,'fresh store reload preserves personal stars');
    const restored=createAppStore({getItem:()=>null,setItem(){}});restored.restoreJSON(store.exportJSON());check(restored.getState().library[0].personalRatingScale===5,'backup restore preserves scale');
    fail=true;star(4).click();check(saved().personalRating===2&&star(2).checked&&host.querySelector('.title-page-feedback').textContent.includes('Not saved'),'failed save rolls back selected stars');fail=false;
    host.querySelector('.rating-clear').click();check(saved().personalRating===null&&host.querySelector('.rating-value').textContent==='Not rated','Clear removes only personal rating');
    check(host.textContent.includes('IMDb — (not connected)'),'IMDb is separate and never substituted');
    page.destroy();
    const locked=createAppStore({getItem(){throw Error('Synthetic unreadable storage');},setItem(){throw Error('Must not write');}});
    page=mountTitlePage(host,{...options,store:locked});await page.ready;
    check([...host.querySelectorAll('.personal-rating input')].every(input=>input.disabled),'corrupt storage locks personal stars');
    return {passed:checks.length,checks};
  } finally {page.destroy();host.remove();}
}

export function checkTitleAppearance() {
  const checks = [], check = (name, value) => checks.push({ name, passed: Boolean(value) });
  const cover = document.querySelector('#title-page .title-panel__cover');
  const panel = document.querySelector('#title-page .title-panel');
  check('Dedicated title cover is substantially larger', cover?.getBoundingClientRect().width >= (innerWidth <= 600 ? 150 : innerWidth <= 900 ? 190 : 250));
  check('Cinematic panel has room for larger artwork', panel?.getBoundingClientRect().height >= (innerWidth <= 600 ? 400 : 380));
  const buttons = [...document.querySelectorAll('.title-page-actions button')];
  check('Every title action has one decorative symbol', buttons.length === 5 && buttons.every(button => button.querySelectorAll('svg.action-symbol[aria-hidden="true"]').length === 1));
  check('Symbols retain readable text labels and touch targets', buttons.length === 5 && buttons.every(button => button.textContent.trim() && button.getBoundingClientRect().height >= 44));
  const colors = ['like', 'watched', 'watching', 'watch_later'].map(action => {
    const icon = document.querySelector(`[data-title-action="${action}"] .action-symbol`); return icon ? getComputedStyle(icon).color : null;
  });
  check('Like and viewing actions have distinct meaningful colors', colors.every(Boolean) && new Set(colors).size === 4);
  check('Artwork and controls fit the viewport', document.documentElement.scrollWidth <= innerWidth);
  const episodeButtons = [...document.querySelectorAll('#episode-list button[data-episode-status]')];
  if (episodeButtons.length) check('Episode actions share the same symbols', episodeButtons.every(button => button.querySelector('svg.action-symbol[aria-hidden="true"]')));
  return { passed: checks.every(item => item.passed), checks };
}
