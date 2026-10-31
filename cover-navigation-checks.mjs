// Synthetic DOM checks: no saved viewing history is read or changed here.
export async function checkCoverNavigation() {
  const { createFilmCard } = await import('./film-card.mjs');
  const checks = [];
  const check = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
  const host = document.createElement('div'); document.body.append(host);
  let opened = 0, chosen = 0, liked = 0;
  try {
    for (const format of ['movie', 'series']) {
      const candidate = { format, tmdbId: 671, catalogueId: `tmdb:${format}:671`, title: 'Synthetic <b>title</b>', posterUrl: null };
      host.replaceChildren(createFilmCard(candidate, { onOpen: () => opened++, onChoice: () => chosen++, onLike: () => liked++ }));
      const cover = host.querySelector('.poster-button');
      check(cover.tagName === 'A', `${format} cover is a native page link`);
      check(cover.getAttribute('href') === `title.html?format=${format}&id=671`, `${format} cover keeps the exact title namespace`);
      check(cover.getAttribute('aria-label') === `Open ${candidate.title}`, `${format} link has an accessible name`);
      cover.focus(); check(document.activeElement === cover, `${format} cover is keyboard focusable`);
      cover.addEventListener('click', event => event.preventDefault(), { once: true });
      cover.click();
      check(opened === 0 && !host.querySelector('dialog'), `${format} cover never opens the old details popup`);
      check(chosen === 0 && liked === 0, `${format} browsing does not mark watched or liked`);
      host.querySelector('[data-choice="watch_later"]').click(); host.querySelector('.like-button').click();
      check(chosen === 1 && liked === 1, `${format} separate quick actions remain usable`); chosen = 0; liked = 0;
      check(!host.querySelector('b'), `${format} title remains plain text`);
    }
    host.replaceChildren(createFilmCard({ format: 'movie', tmdbId: 671, catalogueId: 'tmdb:series:671', title: 'Invalid identity' }));
    check(host.querySelector('.poster-button').tagName === 'DIV' && !host.querySelector('a'), 'invalid identities do not invent a destination');
    return { passed: checks.length, checks, synthetic: true };
  } finally { host.remove(); }
}

export async function checkLibraryEditControl() {
  if (!['http://127.0.0.1:8767', 'http://127.0.0.1:8768'].includes(location.origin)) throw new Error('Owned synthetic origin required');
  const { appStore } = await import('./app.mjs');
  const { applyTitleChoice } = await import('./library-actions.mjs');
  const before = appStore.exportJSON();
  const checks = [];
  const check = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
  try {
    appStore.transact(draft => { draft.library = []; applyTitleChoice(draft, { provider: 'TMDB', format: 'movie', tmdbId: 671, catalogueId: 'tmdb:movie:671', title: 'Synthetic edit check', year: '2001', posterUrl: null, sourceUrl: 'https://www.themoviedb.org/movie/671' }, 'watch_later'); });
    const card = document.querySelector('#library-grid [data-catalogue-id="tmdb:movie:671"]');
    check(card?.querySelector('.poster-button').tagName === 'A', 'Library cover is a native title-page link');
    const edit = card.querySelector('[data-edit-title]');
    check(edit?.tagName === 'BUTTON', 'Library has a separate Edit button');
    const saved = appStore.exportJSON(); edit.click();
    check(document.querySelector('#title-dialog').open, 'Edit still opens the saved-entry editing form');
    check(document.querySelector('#dialog-heading').textContent === 'Title details', 'Edit targets an existing saved title');
    check(appStore.exportJSON() === saved, 'opening Edit does not save or alter history');
    document.querySelector('#title-dialog').close();
    return { passed: checks.length, checks, synthetic: true };
  } finally { document.querySelector('#title-dialog').close(); appStore.restoreJSON(before); }
}
