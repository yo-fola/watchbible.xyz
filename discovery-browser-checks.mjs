// Browser-only assertions. These use explicitly synthetic catalogue fixtures.
const assert = (condition, message) => { if (!condition) throw new Error(message); };
export async function waitFor(predicate, timeout = 6000) {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeout) throw new Error('Timed out waiting for UI');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}
export async function checkFilmCard() {
  const { createFilmCard } = await import('./film-card.mjs');
  const host = document.createElement('div');
  document.body.append(host);
  const selected = [];
  const fixture = { catalogueId: 'tmdb:movie:101', title: 'Test <img src=x onerror=alert(1)> film', format: 'movie', anime: true, year: '2001', posterUrl: null, genres: [{ id: 18, name: 'Test drama' }] };
  host.append(createFilmCard(fixture, { onOpen() {}, onChoice: action => selected.push(action) }));
  try {
    assert(host.querySelectorAll('[data-choice]').length === 3, 'three explicit actions');
    assert(host.textContent.includes('Movie') && host.textContent.includes('Anime'), 'anime independent of format');
    assert(!host.querySelector('img[src="x"]'), 'title stays plain text');
    host.querySelector('[data-choice="not_for_me"]').click();
    assert(selected[0] === 'not_for_me', 'negative action distinct from adding');
    return { passed: 4, checks: ['three actions', 'independent anime', 'plain text', 'negative action'] };
  } finally { host.remove(); }
}
export async function checkHomeSurface() {
  const checks = [];
  const check = (condition, label) => { assert(condition, label); checks.push(label); };
  check(document.querySelector('h1')?.textContent === 'For you', 'default home is recommendations');
  check(Boolean(document.querySelector('nav a[href="library.html"]')), 'Library is separate');
  check(Boolean(document.querySelector('#home-grid')), 'external recommendation surface exists');
  await waitFor(() => document.querySelectorAll('#home-grid .library-card').length || !document.querySelector('#home-retry').hidden);
  check(document.querySelectorAll('#home-grid .library-card').length > 0, 'real API path supplies cards');
  const { appStore } = await import('./app.mjs');
  const state = appStore.getState();
  const excluded = new Set([...state.library.map(item => item.catalogueId), ...state.dismissed]);
  check([...document.querySelectorAll('#home-grid .library-card')].every(card => !excluded.has(card.dataset.catalogueId)), 'library and hidden identities excluded');
  return { passed: checks.length, checks };
}

export async function checkDataTools() {
  assert(Boolean(document.querySelector('#export-data')), 'Export control available');
  assert(Boolean(document.querySelector('#restore-file')), 'Restore accepts a local file');
  assert(Boolean(document.querySelector('#confirm-restore')), 'Replacement requires explicit confirmation');
  assert(document.querySelector('#restore-preview').hidden, 'No replacement preselected');
  return { passed: 4, checks: ['export', 'local restore', 'confirmation', 'no implicit replacement'] };
}

export async function checkDraftPersistence() {
  assert(Boolean(document.querySelector('#draft-state')), 'Draft storage state visible');
  const { appStore } = await import('./app.mjs');
  const before = appStore.exportJSON();
  try {
    const source = document.querySelector('#title-list');
    source.value = await (await fetch('/examples/sample-import.txt')).text();
    source.dispatchEvent(new Event('input', { bubbles: true }));
    assert(document.querySelectorAll('.review-row').length === 8, 'Public synthetic eight-title fixture');
    const title = document.querySelector('.review-row input');
    title.value = 'Edited synthetic review title';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    assert(appStore.getState().importDraft.entries[0].title === title.value, 'Edited title saved');
    assert(appStore.getState().importDraft.entries[0].originalLine.includes('Example Movie One'), 'Original source line preserved');
    assert(document.querySelector('.next-step button').disabled, 'Unmatched imports cannot become history');
    return { passed: 5, checks: ['draft notice', 'real input', 'edited title', 'original line', 'unmatched not committed'] };
  } finally { appStore.restoreJSON(before); }
}

export async function checkLibraryPreferences() {
  assert(location.origin==='http://127.0.0.1:8767','Owned synthetic fixture origin required');
  const {appStore}=await import('./app.mjs'),before=appStore.exportJSON();
  const checks=[],check=(value,label)=>{assert(value,label);checks.push(label);};
  const dialog=document.querySelector('#title-dialog');
  try {
    appStore.transact(draft=>{draft.library=[];draft.dismissed=[];});
    check(Boolean(document.querySelector('#add-liked-title')),'dedicated Add likes control exists');
    document.querySelector('#add-liked-title').click();
    check(document.querySelector('#entry-liked').checked&&document.querySelector('#entry-status').value==='untracked','Add likes drafts Like without invented watching status');
    const input=document.querySelector('#entry-title');input.value='Test';input.dispatchEvent(new Event('input',{bubbles:true}));
    await waitFor(()=>document.querySelectorAll('#title-matches [role="option"]').length===2);
    document.querySelector('#title-matches [role="option"]').click();
    await waitFor(()=>document.querySelector('#details-cover .title-panel__genres'));
    const star=document.querySelector('#entry-rating input[value="4"]');check(Boolean(star),'five-star editor is available in Add title');star.click();
    check(appStore.getState().library.length===0,'Like and stars remain unsaved until Add');
    document.querySelector('#save-title').click();
    let saved=appStore.getState().library[0];
    check(!dialog.open&&saved?.liked&&saved?.status===null&&saved?.personalRating===4&&saved?.personalRatingScale===5,'explicit Add commits Like and personal stars without fabricated history');
    check(appStore.getState().gamification.credits.length===0,'likes and ratings do not earn watched XP');
    const liked=document.querySelector('#liked-filter');liked.checked=true;liked.dispatchEvent(new Event('change'));
    check(document.querySelectorAll('#library-grid article').length===1,'Liked filter finds saved taste titles');
    check(document.querySelector('.personal-rating-summary')?.textContent.includes('4 / 5'),'Library card displays the personal score');
    document.querySelector('#library-grid [data-edit-title]').click();
    document.querySelector('#entry-rating input[value="1"]').click();dialog.close();
    check(appStore.getState().library[0].personalRating===4,'cancelled edit never saves stars');
    document.querySelector('#library-grid [data-edit-title]').click();
    document.querySelector('#entry-rating .rating-clear').click();document.querySelector('#save-title').click();
    saved=appStore.getState().library[0];check(saved.personalRating===null&&saved.liked&&saved.status===null,'saving Clear preserves Like and untracked status');
    appStore.transact(draft=>{const entry=draft.library[0];entry.liked=false;entry.status='watched';entry.anime=true;entry.personalRating=8;delete entry.personalRatingScale;});
    const credits=appStore.getState().gamification.credits.length;
    document.querySelector('#add-liked-title').click();input.value='Test';input.dispatchEvent(new Event('input',{bubbles:true}));
    await waitFor(()=>document.querySelectorAll('#title-matches [role="option"]').length===2);document.querySelector('#title-matches [role="option"]').click();
    await waitFor(()=>document.querySelector('#details-cover .title-panel__genres'));
    check(document.querySelector('#entry-anime').checked&&document.querySelector('#entry-status').value==='watched','Add likes shows existing manual tags and viewing status');
    document.querySelector('#save-title').click();saved=appStore.getState().library[0];
    check(appStore.getState().library.length===1&&saved.liked&&saved.anime&&saved.status==='watched'&&saved.personalRating===8&&saved.personalRatingScale===undefined&&appStore.getState().gamification.credits.length===credits,'adding an existing Like preserves original legacy rating, history and XP without duplication');
    return {passed:checks.length,checks};
  } finally {if(dialog.open)dialog.close();appStore.restoreJSON(before);document.querySelector('#reset-filters').click();}
}

export async function checkLibraryFlow() {
  assert(['http://127.0.0.1:8767', 'http://127.0.0.1:8768'].includes(location.origin), 'Owned synthetic fixture origin required');
  const { appStore } = await import('./app.mjs');
  const { createAppStore } = await import('./app-state.mjs');
  const before = appStore.exportJSON();
  const checks = [];
  const check = (value, label) => { assert(value, label); checks.push(label); };
  const input = document.querySelector('#entry-title');
  const dialog = document.querySelector('#title-dialog');
  const search = async () => {
    document.querySelector('#add-title').click();
    input.value = 'Test';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => document.querySelectorAll('#title-matches [role="option"]').length === 2);
  };
  try {
    appStore.transact(draft => { draft.library = []; draft.dismissed = []; });
    await search();
    check(document.querySelector('#save-title').disabled, 'search does not preselect a work');
    document.querySelector('#title-matches [role="option"]').click();
    await waitFor(() => document.querySelector('#details-cover .title-panel__genres'));
    check(document.querySelector('#details-cover').textContent.includes('Test drama'), 'real metadata path enriches selection');
    check(document.querySelector('#details-cover').textContent.includes('IMDb —'), 'IMDb is not replaced with TMDB votes');
    document.querySelector('#entry-status').value = 'plan_to_watch';
    document.querySelector('#save-title').click();
    check(!dialog.open && appStore.getState().library.length === 1, 'explicit Add persists selected identity');
    document.querySelector('#library-grid .like-button').click();
    check(appStore.getState().library[0].liked === true, 'Like is an independent saved action');
    await search();
    [...document.querySelectorAll('#title-matches [role="option"]')][1].click();
    await waitFor(() => document.querySelector('#details-cover .title-panel__facts')?.textContent.includes('16 episodes'));
    check(document.querySelector('#details-cover .title-panel__facts').textContent === '2 seasons • 16 episodes', 'TV counts use the requested bullet');
    document.querySelector('#entry-status').value = 'watched';
    document.querySelector('#save-title').click();
    check(appStore.getState().library.length === 2 && appStore.getState().library[1].liked === false, 'Watched does not infer a like');
    const reloaded = createAppStore(localStorage).getState();
    check(reloaded.library.length === 2 && reloaded.library[0].liked === true, 'fresh store reads persisted library and like');
    const query = document.querySelector('#search');
    query.value = 'drama drummer 2002'; query.dispatchEvent(new Event('input'));
    check(document.querySelectorAll('#library-grid article').length === 1, 'genre synopsis and year search combine');
    const format = document.querySelector('#format-filter');
    format.value = 'movie'; format.dispatchEvent(new Event('change'));
    check(!document.querySelector('#no-results').hidden, 'format combines with metadata search');
    document.querySelector('#reset-filters').click();
    check(document.querySelectorAll('#library-grid article').length === 2, 'reset preserves both works');
    document.querySelector('#view-list').click();
    const poster = document.querySelector('#library-grid .poster-button').getBoundingClientRect();
    const body = document.querySelector('#library-grid .card-body').getBoundingClientRect();
    check(poster.width < 100 && body.left >= poster.right, 'list view keeps cover and body in separate columns');
    await search();
    document.querySelector('#title-matches [role="option"]').click();
    check(document.querySelector('#save-title').disabled && document.querySelector('#match-feedback').textContent.includes('Already'), 'duplicate identity cannot be re-added');
    dialog.close();
    document.querySelector('[data-catalogue-id="tmdb:series:2010"] [data-edit-title]').click();
    const tag = document.querySelector('#entry-anime');
    tag.checked = true; tag.dispatchEvent(new Event('change'));
    document.querySelector('#save-title').click();
    const saved = appStore.getState().library.find(entry => entry.catalogueId === 'tmdb:series:2010');
    check(saved.anime === true && saved.format === 'series', 'manual Anime tag never replaces Series format');
    const anime = document.querySelector('#anime-filter');
    anime.checked = true; anime.dispatchEvent(new Event('change'));
    check(document.querySelectorAll('#library-grid article').length === 1, 'independent anime filter still works');
    return { passed: checks.length, checks };
  } finally {
    if (dialog.open) dialog.close();
    appStore.restoreJSON(before);
    document.querySelector('#reset-filters').click();
  }
}
