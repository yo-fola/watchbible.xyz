// Repeatable synthetic checks only. Never run write checks on the live app origin.
const assert = (value, message) => { if (!value) throw new Error(message); };
const fixtureOrigin = () => assert(['http://127.0.0.1:8767', 'http://127.0.0.1:8768'].includes(location.origin), 'Owned synthetic fixture origin (8767/8768) required');

export async function checkStaticPages() {
  const { readFile } = await import('node:fs/promises');
  const checks = [];
  for (const page of ['profile', 'achievements']) {
    let html = '';
    try { html = await readFile(new URL(`./${page}.html`, import.meta.url), 'utf8'); } catch {}
    assert(html.includes(`<title>watchbible — ${page === 'profile' ? 'Profile' : 'Achievements'}</title>`), `${page} page has a real document title`);
    for (const part of ['theme.css', 'gamification.css', `${page}.mjs`, 'class="app-bar"', 'id="main-content"', 'href="setup.html"']) {
      assert(html.includes(part), `${page} includes ${part}`);
    }
    assert(!/\bon\w+=/i.test(html), `${page} has no inline event handlers`);
    checks.push(`${page}: document, shared styles, module, navigation, recovery, CSP-safe controls`);
  }
  return { passed: checks.length, checks };
}

function syntheticEntry(format, id, status = 'watched') {
  return { provider: 'TMDB', catalogueId: `tmdb:${format}:${id}`, tmdbId: id,
    title: `Synthetic UI fixture ${id}`, format, status, year: null, posterUrl: null,
    sourceUrl: `https://www.themoviedb.org/${format === 'movie' ? 'movie' : 'tv'}/${id}`,
    overview: '', genreIds: [18], genres: [{ id: 18, name: 'Drama' }], anime: false, liked: false };
}

export async function checkProfile() {
  fixtureOrigin();
  const { appStore } = await import('./app.mjs');
  const { createAppStore } = await import('./app-state.mjs');
  const { getProgress } = await import('./gamification-model.mjs');
  const { mountProfile } = await import('./profile.mjs');
  const root = document.querySelector('#profile-root');
  assert(root, 'Open profile.html first');
  const before = appStore.exportJSON();
  const checks = [];
  const check = (value, label) => { assert(value, label); checks.push(label); };
  const $ = selector => root.querySelector(selector);
  try {
    // Restoring history is not a new explicit Watched action (which earns XP).
    const historical = appStore.getState();
    historical.library = [syntheticEntry('movie', 900001), syntheticEntry('series', 900001)];
    historical.gamification = { profile: { displayName: '' }, followed: [], credits: [], awards: [] };
    appStore.restoreJSON(JSON.stringify(historical));
    check($('#profile-name').textContent === 'Your profile', 'empty local name is not an invented identity');
    check($('#total-xp').textContent === '0 XP', 'history does not silently earn XP');
    $('#display-name').value = '<img src=x onerror=alert(1)>';
    $('#profile-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    check($('#profile-name').textContent === '<img src=x onerror=alert(1)>' && !$('#profile-name img'), 'display name renders literally');
    check(createAppStore(localStorage).getState().gamification.profile.displayName === $('#display-name').value, 'name survives a fresh store load');
    $('#preview-recognition').click();
    check(!$('#recognition-preview').hidden && $('#recognition-summary').textContent.includes('1 movie') && $('#recognition-summary').textContent.includes('100 XP'), 'preview counts movies only and states exact XP');
    check(root.querySelectorAll('#recognition-titles li').length === 1 && $('#recognition-titles').textContent.includes('Synthetic UI fixture 900001'), 'recognition preview identifies the exact movies before confirmation');
    $('#cancel-recognition').click();
    check(getProgress(appStore.getState()).xp === 0 && $('#recognition-preview').hidden, 'cancel leaves credits unchanged');
    $('#preview-recognition').click();
    const changedHistory = appStore.getState();
    changedHistory.library.push(syntheticEntry('movie', 900002));
    appStore.restoreJSON(JSON.stringify(changedHistory));
    $('#confirm-recognition').click();
    check(getProgress(appStore.getState()).xp === 0 && $('#recognition-summary').textContent.includes('2 movies'), 'stale preview refresh requires another explicit confirmation');
    $('#confirm-recognition').click();
    check(getProgress(appStore.getState()).xp === 200 && $('#total-xp').textContent === '200 XP', 'explicit confirmation persists actual XP');
    check($('#preview-recognition').disabled, 'same movie cannot be recognised twice');
    appStore.transact(draft => { draft.library[0].status = 'plan_to_watch'; });
    check($('#total-xp').textContent === '100 XP', 'history corrections recalculate displayed XP');
    check(root.textContent.includes('level may decrease'), 'correction impact is explained');

    // Use the real store's failing persistence boundary, not a fake successful action.
    const snapshot = appStore.exportJSON();
    const failingStore = createAppStore({ getItem: () => snapshot, setItem() { throw new Error('Synthetic quota failure'); } });
    const host = document.createElement('div'); host.innerHTML = root.innerHTML; document.body.append(host);
    const dispose = mountProfile({ root: host, store: failingStore });
    try {
      host.querySelector('#display-name').value = 'Unsaved synthetic name';
      host.querySelector('#profile-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      check(host.querySelector('#profile-feedback').textContent.includes('Could not save') && failingStore.getState().gamification.profile.displayName !== 'Unsaved synthetic name', 'failed name write reports failure without fake persistence');
      const bad = createAppStore({ getItem: () => '{invalid', setItem() { throw new Error('Must not write'); } });
      const recoveryHost = document.createElement('div'); recoveryHost.innerHTML = root.innerHTML; document.body.append(recoveryHost);
      const cleanRecovery = mountProfile({ root: recoveryHost, store: bad });
      try {
        check(!recoveryHost.querySelector('#profile-recovery').hidden && recoveryHost.querySelector('#profile-data').hidden && recoveryHost.querySelector('#save-profile').disabled, 'unreadable storage exposes recovery instead of fake zero progress');
      } finally { cleanRecovery(); recoveryHost.remove(); }
    } finally { dispose(); host.remove(); }
    return { passed: checks.length, checks };
  } finally { appStore.restoreJSON(before); }
}

export async function checkAchievements() {
  fixtureOrigin();
  const { appStore } = await import('./app.mjs');
  const { getProgress } = await import('./gamification-model.mjs');
  const { mountAchievements } = await import('./achievements.mjs');
  const { createAppStore } = await import('./app-state.mjs');
  const root = document.querySelector('#achievements-root');
  assert(root, 'Open achievements.html first');
  const before = appStore.exportJSON();
  const checks = [];
  const check = (value, label) => { assert(value, label); checks.push(label); };
  try {
    appStore.transact(draft => {
      draft.library = [];
      draft.gamification = { profile: { displayName: '' }, followed: [], credits: [], awards: [] };
    });
    check(root.querySelectorAll('.achievement-card[data-status="earned"]').length === 0, 'empty history has no fake earned badges');
    const family = root.querySelector('#achievement-family');
    check(['', 'franchise', 'genre', 'type'].every(value => [...family.options].some(option => option.value === value)), 'all family options exist in rendered control');
    for (const value of ['franchise', 'genre', 'type']) {
      family.value = value; family.dispatchEvent(new Event('change'));
      const cards = [...root.querySelectorAll('.achievement-card')];
      check(cards.length === getProgress(appStore.getState()).badges.filter(badge => badge.family === value).length && cards.every(card => card.dataset.family === value), `${value} filter matches real model badges`);
    }
    family.value = ''; family.dispatchEvent(new Event('change'));
    appStore.transact(draft => { draft.library = Array.from({ length: 5 }, (_, index) => syntheticEntry('movie', 900010 + index)); });
    const badges = getProgress(appStore.getState()).badges;
    check(root.querySelectorAll('.achievement-card').length === badges.length, 'all real badge rules render without extras');
    check([...root.querySelectorAll('.achievement-card')].every(card => card.querySelector('h3') && card.querySelector('.achievement-requirement') && card.querySelector('.achievement-state')), 'every badge has readable name, status and requirements');
    const status = root.querySelector('#achievement-status');
    for (const value of ['earned', 'in-progress', 'locked']) {
      status.value = value; status.dispatchEvent(new Event('change'));
      check([...root.querySelectorAll('.achievement-card')].every(card => card.dataset.status === value), `${value} status filter works`);
    }
    const host = document.createElement('div'); host.innerHTML = root.innerHTML; document.body.append(host);
    const bad = createAppStore({ getItem: () => '{invalid', setItem() { throw new Error('Must not write'); } });
    const dispose = mountAchievements({ root: host, store: bad });
    try { check(!host.querySelector('#achievements-recovery').hidden && host.querySelector('#achievements-data').hidden, 'recovery never shows fallback badges as live data'); }
    finally { dispose(); host.remove(); }
    return { passed: checks.length, checks };
  } finally {
    root.querySelector('#achievement-family').value = '';
    root.querySelector('#achievement-status').value = '';
    appStore.restoreJSON(before);
  }
}

if (typeof process !== 'undefined' && process.versions?.node && process.argv[1]?.endsWith('gamification-ui-checks.mjs')) {
  console.log(JSON.stringify(await checkStaticPages(), null, 2));
}
