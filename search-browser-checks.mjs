// Browser-only synthetic fixtures. No real catalogue lookups or user history.
export const fixtureTitles = [
  { catalogueId: 'tmdb:movie:9101', tmdbId: 9101, provider: 'TMDB', title: 'Test film', year: '2001', format: 'movie', posterUrl: null },
  { catalogueId: 'tmdb:movie:9102', tmdbId: 9102, provider: 'TMDB', title: 'Test anime film', year: '2002', format: 'movie', posterUrl: null },
  { catalogueId: 'tmdb:series:9103', tmdbId: 9103, provider: 'TMDB', title: 'Test anime series', year: '2003', format: 'series', posterUrl: null },
  { catalogueId: 'tmdb:movie:9104', tmdbId: 9104, provider: 'TMDB', title: '<img src=x onerror="window.injected=true">', year: null, format: 'movie', posterUrl: null },
];

export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function waitFor(predicate, label = 'browser state') {
  const deadline = Date.now() + 3500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await wait(20);
  }
}

export function fixtureSearch(responder) {
  const original = window.fetch;
  const calls = [];
  window.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.pathname !== '/api/search') return original(input, options);
    const query = url.searchParams.get('q');
    calls.push(query);
    const value = await responder(query);
    return value instanceof Response ? value : Response.json({ results: value });
  };
  return { calls, restore: () => { window.fetch = original; } };
}

export async function checkAutocomplete() {
  const checks = [];
  const $ = selector => document.querySelector(selector);
  const check = (name, ok) => { if (!ok) throw new Error(name); checks.push(name); };
  const film = { ...fixtureTitles[0], posterUrl: './examples/test-cover.svg' };
  const series = { ...fixtureTitles[2], title: 'Test series' };
  let failures = 0;
  const mock = fixtureSearch(async query => {
    if (query === 'Slow') { await wait(900); return [{ ...film, title: 'Stale fixture' }]; }
    if (query === 'Newest') return [{ ...film, title: 'Newest fixture' }];
    if (query === 'Fail' && failures++ === 0) return Response.json({ error: 'Synthetic search failure' }, { status: 503 });
    if (query === 'None') return [];
    return [film, series];
  });
  const type = text => { $('#entry-title').value = text; $('#entry-title').dispatchEvent(new Event('input', { bubbles: true })); };
  const key = key => $('#entry-title').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const choose = index => document.querySelectorAll('[role="option"]')[index].click();
  try {
    $('#add-title').click();
    check('adding requires a chosen catalogue match', $('#save-title').disabled);
    check('confirmation fields stay hidden until a match is chosen', $('#title-confirmation').hidden);
    check('title input is an accessible combobox', $('#entry-title').getAttribute('role') === 'combobox');
    type('Fi'); type('Fixture');
    await waitFor(() => document.querySelectorAll('[role="option"]').length === 2, 'search suggestions');
    check('typing is debounced to the latest query', mock.calls.length === 1 && mock.calls[0] === 'Fixture');
    check('suggestions show year and format', $('#title-matches').textContent.includes('2001') && $('#title-matches').textContent.includes('Movie') && $('#title-matches').textContent.includes('Series'));
    check('suggestions do not automatically choose or import', $('#save-title').disabled && document.querySelectorAll('.library-card').length === 0);
    key('Enter');
    check('Enter does not silently choose the first match', $('#save-title').disabled && $('#title-dialog').open);
    key('ArrowDown'); key('ArrowDown'); key('Enter');
    check('keyboard selection picks the intended series', $('#entry-format').value === 'Series' && !$('#save-title').disabled);
    check('choosing a match reveals status and category controls', !$('#title-confirmation').hidden && !$('#entry-status').disabled);
    $('#title-form').requestSubmit();
    check('viewing status must be explicitly chosen', $('#title-dialog').open && document.querySelectorAll('.library-card').length === 0);
    $('#entry-status').value = 'watching'; $('#title-form').requestSubmit();
    check('final confirmation adds the selected identity', document.querySelectorAll('.library-card').length === 1 && document.querySelector('.library-card').dataset.catalogueId === series.catalogueId);
    $('#add-title').click(); type('Fixture');
    await waitFor(() => document.querySelectorAll('[role="option"]').length === 2);
    choose(1);
    check('duplicate identity is flagged before import', $('#save-title').disabled && $('#match-feedback').textContent.includes('Already'));
    $('#close-dialog').click();
    check('duplicate does not overwrite existing status', document.querySelectorAll('.library-card').length === 1 && document.querySelector('.status-tag').textContent === 'Watching');
    $('#add-title').click(); type('Fixture');
    await waitFor(() => document.querySelectorAll('[role="option"]').length === 2);
    choose(0); $('#entry-status').value = 'plan_to_watch'; $('#title-form').requestSubmit();
    await waitFor(() => document.querySelector('.library-card img')?.naturalWidth > 0, 'selected poster');
    check('selected cover is rendered on the library card', !!document.querySelector('.library-card img'));
    $('#add-title').click(); type('Slow');
    await waitFor(() => mock.calls.includes('Slow'));
    type('Newest');
    await waitFor(() => $('#title-matches').textContent.includes('Newest fixture'));
    await wait(700);
    check('late older responses cannot replace newer results', $('#title-matches').textContent.includes('Newest fixture') && !$('#title-matches').textContent.includes('Stale fixture'));
    type('');
    check('clearing the query removes choices and disables Add', $('#title-matches').hidden && $('#save-title').disabled);
    type('Fail');
    await waitFor(() => $('#match-feedback').textContent.includes('Synthetic search failure'));
    check('search failures offer retry without fabricated matches', !$('#retry-search').hidden && $('#save-title').disabled);
    $('#retry-search').click();
    await waitFor(() => document.querySelectorAll('[role="option"]').length === 2);
    check('retry fetches candidates again', mock.calls.filter(query => query === 'Fail').length === 2);
    type('None');
    await waitFor(() => $('#match-feedback').textContent === 'No matches');
    check('no-results state cannot be imported', $('#save-title').disabled && $('#title-matches').hidden);
    type('Fixture');
    await waitFor(() => document.querySelectorAll('[role="option"]').length === 2);
    key('Escape');
    check('Escape dismisses suggestions before the dialog', $('#title-matches').hidden && $('#title-dialog').open);
    $('#close-dialog').click();
    return { passed: checks.length, checks };
  } finally {
    if ($('#title-dialog').open) $('#close-dialog').click();
    mock.restore();
  }
}
