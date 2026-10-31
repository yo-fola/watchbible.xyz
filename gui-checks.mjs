// Run after awaiting checkLibrary() on synthetic entries, never real history.
export function checkInterface() {
  const checks = [];
  const $ = selector => document.querySelector(selector);
  const check = (name, ok) => { if (!ok) throw new Error(name); checks.push(name); };
  check('grid and list controls are present', !!$('#view-list') && !!$('#view-grid'));
  $('#view-list').click();
  check('list view changes layout and accessible pressed state', $('#library-grid').dataset.view === 'list' && $('#view-list').getAttribute('aria-pressed') === 'true');
  $('#view-grid').click();
  check('grid view restores layout', $('#library-grid').dataset.view === 'grid');
  $('#sort-order').value = 'title';
  $('#sort-order').dispatchEvent(new Event('change'));
  const names = [...document.querySelectorAll('.library-card h3')].map(node => node.textContent);
  check('title sort changes rendered order', JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))));
  check('entries without an image have an honest cover fallback', document.querySelectorAll('.library-card .poster-fallback').length === 4);
  $('.library-card .card-open').click();
  check('card opens an editable details panel', $('#title-dialog').open && $('#dialog-heading').textContent === 'Title details');
  const editedTitle = $('#entry-title').value;
  const originalStatus = $('.library-card .status-tag').textContent;
  $('#entry-status').value = 'plan_to_watch';
  $('#close-dialog').click();
  check('closing details discards unsaved status changes', $('.library-card .status-tag').textContent === originalStatus);
  $('.library-card .card-open').click();

  $('#entry-status').value = 'watching';
  $('#title-form').requestSubmit();
  check('saving details edits rather than duplicates a title', !$('#title-dialog').open && document.querySelectorAll('.library-card').length === 4);
  const edited = [...document.querySelectorAll('.library-card')].find(card => card.querySelector('h3').textContent === editedTitle);
  check('saved status changes preserve the selected title identity', !!edited && edited.querySelector('.status-tag').textContent === 'Watching');
  $('[data-status="watching"]').click();
  check('status shortcut stays in sync with filters', $('#status-filter').value === 'watching' && $('[data-status="watching"]').getAttribute('aria-pressed') === 'true' && [...document.querySelectorAll('.status-tag')].every(node => node.textContent === 'Watching'));
  $('#reset-filters').click();
  check('reset synchronises shortcut state', $('[data-status=""]').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('.library-card').length === 4);
  return { passed: checks.length, checks };
}

export async function checkPosters() {
  const { createPoster } = await import('./poster.mjs');
  const checks = [];
  const check = (name, ok) => { if (!ok) throw new Error(name); checks.push(name); };
  const empty = createPoster({ title: 'Synthetic fixture' });
  check('missing cover shows a fallback, not a broken image', !!empty.querySelector('.poster-fallback') && !empty.querySelector('img'));
  const valid = createPoster({ title: 'Synthetic fixture', posterUrl: './examples/test-cover.svg' });
  document.body.append(valid);
  const image = valid.querySelector('img');
  await new Promise((resolve, reject) => {
    if (image.complete && image.naturalWidth) return resolve();
    image.onload = resolve;
    image.onerror = reject;
  });
  check('an available cover loads with descriptive alternative text', image.naturalWidth > 0 && image.alt.includes('Synthetic fixture'));
  valid.remove();
  const broken = createPoster({ title: 'Synthetic fixture', posterUrl: './examples/missing-cover.svg' });
  document.body.append(broken);
  await new Promise(resolve => setTimeout(resolve, 300));
  check('failed image restores the cover unavailable fallback', !broken.querySelector('img') && !!broken.querySelector('.poster-fallback'));
  broken.remove();
  return { passed: checks.length, checks };
}
