// Browser-only synthetic search fixtures, never live catalogue/user history.
import { fixtureTitles, fixtureSearch, waitFor } from './search-browser-checks.mjs';

export async function checkLibrary() {
  const checks = [];
  const check = (name, ok) => { if (!ok) throw new Error(name); checks.push(name); };
  const $ = selector => document.querySelector(selector);
  const cards = () => document.querySelectorAll('.library-card').length;
  const mock = fixtureSearch(query => fixtureTitles.filter(entry => entry.title === query));
  try {
  check('empty homepage has no seeded viewing history', cards() === 0 && !$('#empty-library').hidden);
  $('#add-title').click();
  check('add title opens accessible modal', $('#title-dialog').open && document.activeElement === $('#entry-title'));
  $('#entry-title').value = '   ';
  $('#entry-title').dispatchEvent(new Event('input'));
  $('#entry-status').value = 'watched';
  $('#title-form').requestSubmit();
  check('an unselected title cannot be added', cards() === 0 && $('#title-dialog').open && $('#save-title').disabled);
  $('#close-dialog').click();
  check('cancel adds nothing', cards() === 0 && !$('#title-dialog').open);
  async function add(title, anime, status) {
    $('#add-title').click();
    $('#entry-title').value = title;
    $('#entry-title').dispatchEvent(new Event('input'));
    await waitFor(() => document.querySelectorAll('[role="option"]').length === 1);
    document.querySelector('[role="option"]').click();
    $('#entry-anime').checked = anime;
    $('#entry-status').value = status;
    $('#title-form').requestSubmit();
  }
  await add('Test film', false, 'watched');
  await add('Test anime film', true, 'plan_to_watch');
  await add('Test anime series', true, 'watching');
  check('explicit selected adds create three session entries', cards() === 3 && $('#empty-library').hidden);
  check('personal and IMDb ratings remain distinct and missing', $('.card-ratings').textContent === 'Your ratingNot ratedIMDbNot connected');
  $('#format-filter').value = 'movie';
  $('#format-filter').dispatchEvent(new Event('change'));
  $('#anime-filter').checked = true;
  $('#anime-filter').dispatchEvent(new Event('change'));
  check('anime category combines with movie format', cards() === 1 && $('.library-card h3').textContent === 'Test anime film');
  $('#status-filter').value = 'watching';
  $('#status-filter').dispatchEvent(new Event('change'));
  check('no-results message does not claim library is empty', cards() === 0 && !$('#no-results').hidden && $('#empty-library').hidden);
  $('#reset-filters').click();
  check('reset restores all session titles', cards() === 3);
  $('#search').value = ' TEST ANIME SERIES ';
  $('#search').dispatchEvent(new Event('input'));
  check('search ignores case and surrounding spaces', cards() === 1);
  $('#reset-filters').click();
  await add('<img src=x onerror="window.injected=true">', false, 'watched');
  check('titles render as text not markup', cards() === 4 && !$('.library-card img') && !window.injected);
  return { passed: checks.length, checks };
  } finally {
    if ($('#title-dialog').open) $('#close-dialog').click();
    mock.restore();
  }
}
