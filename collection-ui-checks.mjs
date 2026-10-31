// Browser-only regression checks. Explicit synthetic viewing state on OWNED test origins only.
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const guard = () => assert(['http://127.0.0.1:8767', 'http://127.0.0.1:8768'].includes(location.origin), 'Owned fixture origin required');
const waitFor = async predicate => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for rendered control');
};
function reporter() {
  const checks = [];
  return { checks, check(value, label) { assert(value, label); checks.push(label); } };
}
function emptyFixture(store) {
  const state = store.getState();
  state.onboarded = true;
  state.library = []; state.dismissed = [];
  state.gamification = { profile: { displayName: '' }, followed: [], credits: [], awards: [] };
  store.restoreJSON(JSON.stringify(state));
}
export async function checkUserMenu() {
  guard();
  const { appStore } = await import('./app.mjs');
  const before = appStore.exportJSON();
  const { checks, check } = reporter();
  await waitFor(() => document.querySelector('#user-menu-button'));
  const button = document.querySelector('#user-menu-button');
  const panel = document.querySelector('#user-menu-panel');
  check(button.tagName === 'BUTTON' && button.getAttribute('aria-label') === 'User menu', 'menu is an accessible named button');
  check(button.getAttribute('aria-controls') === panel.id, 'disclosure references its controlled content');
  check(button.getBoundingClientRect().height >= 44, 'menu target is at least 44px tall');
  if (button.getAttribute('aria-expanded') === 'true') button.click();
  button.click();
  check(!panel.hidden && button.getAttribute('aria-expanded') === 'true', 'click opens the disclosure');
  check(!panel.hasAttribute('role') || panel.getAttribute('role') !== 'menu', 'normal links retain native Tab behaviour');
  for (const file of ['profile.html', 'collections.html', 'achievements.html', 'onboarding.html', 'setup.html']) {
    check([...panel.querySelectorAll('a')].some(link => new URL(link.href).pathname.endsWith('/' + file)), `${file} is reachable`);
  }
  const rect = panel.getBoundingClientRect();
  check(rect.left >= 0 && rect.right <= innerWidth, 'open menu stays within viewport');
  panel.querySelector('a').focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  check(panel.hidden && button.getAttribute('aria-expanded') === 'false', 'Escape closes the menu');
  check(document.activeElement === button, 'Escape restores button focus');
  button.click();
  const main = document.querySelector('main'); main.focus();
  main.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  check(panel.hidden && document.activeElement === main, 'outside click closes without stealing focus');
  check(appStore.exportJSON() === before, 'opening and dismissing the menu does not change saved history');
  return { passed: checks.length, checks, synthetic: true };
}
export async function checkCollectionsOverview() {
  guard();
  const { appStore } = await import('./app.mjs');
  const { createAppStore } = await import('./app-state.mjs');
  const before = appStore.exportJSON();
  const { checks, check } = reporter();
  try {
    emptyFixture(appStore);
    const card = () => document.querySelector('[data-collection-id="mcu-phase-one"]');
    check(Boolean(card()), 'verified pilot collection is browseable');
    check(appStore.getState().library.length === 0, 'browsing does not populate Library');
    card().querySelector('[data-follow]').focus();
    card().querySelector('[data-follow]').click();
    check(appStore.getState().gamification.followed.includes('mcu-phase-one'), 'Follow stores the collection identity');
    check(document.activeElement === card().querySelector('[data-follow]'), 'follow keeps keyboard focus after rendering');
    check(appStore.getState().library.length === 0, 'following never bulk-adds the six movies');
    check(createAppStore(localStorage).getState().gamification.followed.includes('mcu-phase-one'), 'followed collection survives a fresh store load');
    check([...card().querySelectorAll('a')].some(link => link.href.includes('collection=mcu-phase-one')), 'collection has a real detail destination');
    card().querySelector('[data-follow]').click();
    check(appStore.getState().gamification.followed.length === 0 && appStore.getState().library.length === 0, 'Unfollow changes no viewing history');
    const filter = document.querySelector('#collection-status');
    check(['', 'in-progress', 'complete'].every(value => [...filter.options].some(option => option.value === value)), 'all overview filter options are present');
    filter.value = 'complete'; filter.dispatchEvent(new Event('change'));
    check(!card() && !document.querySelector('#collections-empty').hidden, 'empty complete filter is not a false completed set');
    document.querySelector('#reset-collection-filters').click();
    const followed = document.querySelector('#collections-followed'); followed.checked = true; followed.dispatchEvent(new Event('change'));
    check(!card(), 'Followed filter excludes unfollowed sets');
    document.querySelector('#reset-collection-filters').click();
    check(Boolean(card()), 'reset restores browse results');
    return { passed: checks.length, checks, synthetic: true };
  } finally { appStore.restoreJSON(before); }
}
export async function checkCollectionDetail() {
  guard();
  const { appStore } = await import('./app.mjs');
  const { createAppStore } = await import('./app-state.mjs');
  const { getProgress } = await import('./gamification-model.mjs');
  const before = appStore.exportJSON();
  const { checks, check } = reporter();
  const first = () => document.querySelector('#collection-grid [data-catalogue-id="tmdb:movie:1726"]');
  try {
    emptyFixture(appStore);
    check(document.querySelectorAll('#collection-grid [data-catalogue-id]').length === 6, 'full six-film checklist includes unwatched titles');
    check(appStore.getState().library.length === 0, 'opening the checklist creates no history');
    check(getComputedStyle(first().querySelector('img')).filter.includes('grayscale'), 'unwatched artwork is desaturated');
    first().querySelector('[data-choice="watch_later"]').click();
    check(appStore.getState().library.length === 1 && appStore.getState().library[0].status === 'plan_to_watch', 'Watch later is an explicit saved choice');
    check(getProgress(appStore.getState()).xp === 0, 'Watch later earns no completion XP');
    first().querySelector('[data-choice="watched"]').click();
    check(getProgress(appStore.getState()).xp === 100, 'Watched grants one movie credit');
    check(Boolean(document.querySelector('#collections-feedback a[href="achievements.html"]')), 'new franchise badge gets quiet feedback linking to Achievements');
    check(appStore.getState().library.length === 1 && appStore.getState().library[0].liked === false, 'watched updates one identity and does not imply liked');
    check(getComputedStyle(first().querySelector('img')).filter === 'none', 'watched artwork is full colour');
    check(first().textContent.includes('Watched'), 'watched has an explicit text label');
    first().querySelector('[data-choice="watched"]').click();
    check(getProgress(appStore.getState()).xp === 100, 'repeated watched action never doubles XP');
    check(createAppStore(localStorage).getState().library[0].status === 'watched', 'collection choice survives a new store');
    const setItem = Storage.prototype.setItem;
    const snapshot = appStore.exportJSON();
    try {
      Storage.prototype.setItem = () => { throw new DOMException('Synthetic quota failure', 'QuotaExceededError'); };
      document.querySelector('#collection-grid [data-catalogue-id="tmdb:movie:1724"] [data-choice="watched"]').click();
      check(appStore.exportJSON() === snapshot, 'failed collection write leaves history and credits unchanged');
      check(document.querySelector('main').textContent.includes('Could not save'), 'failed collection choice is visibly reported');
    } finally { Storage.prototype.setItem = setItem; }
    const opened = appStore.exportJSON();
    const cover = first().querySelector('.poster-button'); cover.focus();
    check(cover.tagName === 'A' && cover.getAttribute('href') === 'title.html?format=movie&id=1726', 'watched and unwatched covers link directly to the title page');
    check(appStore.exportJSON() === opened && !document.querySelector('dialog[open]'), 'browsing opens no search popup and saves no choice');
    first().querySelector('[data-choice="watch_later"]').click();
    check(getProgress(appStore.getState()).xp === 0, 'correcting Watched removes unsupported XP');
    first().querySelector('[data-choice="watched"]').click();
    check(getProgress(appStore.getState()).xp === 100, 're-marking Watched restores only one credit');
    const filter = document.querySelector('#collection-view');
    check(['', 'watched', 'unwatched'].every(value => [...filter.options].some(option => option.value === value)), 'all checklist filter options are present');
    filter.value = 'watched'; filter.dispatchEvent(new Event('change'));
    check(document.querySelectorAll('#collection-grid article').length === 1 && Boolean(first()), 'Watched filter matches only confirmed history');
    filter.value = 'unwatched'; filter.dispatchEvent(new Event('change'));
    check(document.querySelectorAll('#collection-grid article').length === 5 && !first(), 'Unwatched filter keeps the other five titles visible');
    filter.value = ''; filter.dispatchEvent(new Event('change'));
    for (const card of [...document.querySelectorAll('#collection-grid article')]) {
      document.querySelector(`#collection-grid [data-catalogue-id="${card.dataset.catalogueId}"] [data-choice="watched"]`).click();
    }
    check(document.querySelector('#collection-progress').textContent.includes('6 / 6') && document.querySelector('#collection-progress').textContent.includes('Complete'), 'six confirmed films complete exactly the bounded set');
    check(getProgress(appStore.getState()).xp === 600 && getProgress(appStore.getState()).level === 2, 'set completion has six base credits and reaches Level 2');
    check(getProgress(appStore.getState()).badges.some(badge => badge.tier === 'complete' && badge.earned), 'Set Complete remains separate from Gold');
    return { passed: checks.length, checks, synthetic: true };
  } finally { document.querySelector('dialog[open]')?.close(); appStore.restoreJSON(before); }
}

export async function checkHarryPotter() {
  guard();
  const { appStore } = await import('./app.mjs');
  const { COLLECTIONS } = await import('./collection-definitions.mjs');
  const { applyTitleChoice } = await import('./library-actions.mjs');
  const { getProgress } = await import('./gamification-model.mjs');
  const before = appStore.exportJSON();
  const { checks, check } = reporter();
  try {
    emptyFixture(appStore);
    appStore.transact(draft => { for (const movie of COLLECTIONS.find(item => item.id === 'mcu-phase-one').members) applyTitleChoice(draft, movie, 'watched'); });
    const mcuAwards = () => JSON.stringify(appStore.getState().gamification.awards.filter(award => award.id.startsWith('franchise:mcu-phase-one:')));
    const oldAwards = mcuAwards();
    check(document.querySelectorAll('#collection-grid article').length === 8, 'Harry Potter shows the full eight-film roster');
    document.querySelector('#collection-follow').click();
    check(appStore.getState().gamification.followed.includes('harry-potter') && appStore.getState().library.length === 6, 'following Harry Potter creates no viewing history');
    const ids = [...document.querySelectorAll('#collection-grid article')].map(card => card.dataset.catalogueId);
    for (const [index, id] of ids.entries()) {
      document.querySelector(`#collection-grid [data-catalogue-id="${id}"] [data-choice="watched"]`).click();
      const tier = ({ 2: 'bronze', 4: 'silver', 7: 'gold', 8: 'complete' })[index + 1];
      if (tier) check(getProgress(appStore.getState()).badges.some(badge => badge.scope === 'harry-potter' && badge.tier === tier && badge.earned), `Harry Potter ${tier} unlocks at ${index + 1}`);
    }
    check(document.querySelector('#collection-progress').textContent.includes('8 / 8') && document.querySelector('#collection-progress').textContent.includes('Complete'), 'Harry Potter completion uses eight, not six');
    check(mcuAwards() === oldAwards, 'adding Harry Potter preserves previously earned MCU awards');
    check(getProgress(appStore.getState()).xp === (6 + 8) * 100, 'overlapping genre and franchise badges do not multiply base XP');
    const filter = document.querySelector('#collection-view'); filter.value = 'unwatched'; filter.dispatchEvent(new Event('change'));
    check(!document.querySelector('#collections-empty').hidden && document.querySelector('#collections-empty-copy').textContent.includes('8-movie'), 'empty checklist names the current eight-film collection scope');
    document.querySelector('#collection-follow').click();
    check(appStore.getState().library.length === 14 && mcuAwards() === oldAwards, 'unfollowing never erases either collection history');
    return { passed: checks.length, checks, synthetic: true };
  } finally { document.querySelector('#collection-view').value = ''; appStore.restoreJSON(before); }
}
