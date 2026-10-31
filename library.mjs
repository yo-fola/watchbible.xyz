import { filterLibrary, sortLibrary } from './library-model.mjs';
import { createTitleSearch } from './title-search.mjs';
import { createTitlePanel } from './title-panel.mjs';
import { createFilmCard, createStarRating } from './film-card.mjs';
import { toLibraryEntry, getPersonalRating, setPersonalRating, setTitleLike } from './library-actions.mjs';
import { appStore } from './app.mjs';

let entries = appStore.getState().library;
const grid = document.querySelector('#library-grid');
const dialog = document.querySelector('#title-dialog');
const form = document.querySelector('#title-form');
const titleInput = document.querySelector('#entry-title');
const search = document.querySelector('#search');
const format = document.querySelector('#format-filter');
const status = document.querySelector('#status-filter');
const anime = document.querySelector('#anime-filter');
const liked = document.querySelector('#liked-filter');
const sort = document.querySelector('#sort-order');
let editingEntry = null;
let likesMode = false, ratingDraft = null, ratingTouched = false;
const statusLabels = { watched: 'Watched', watching: 'Watching', plan_to_watch: 'Watch later' };
const saveButton = document.querySelector('#save-title');
const matchFeedback = document.querySelector('#match-feedback');
const feedback = document.querySelector('#library-feedback');
let selectedMetadata = null;
let animeTouched = false;
const rating = createStarRating({ onChange(value) { ratingDraft = value; ratingTouched = true; } });
document.querySelector('#entry-rating').append(rating.element);
const panel = createTitlePanel(document.querySelector('#details-cover'), { onMetadata(metadata) {
  if (titlePicker.selection?.catalogueId !== metadata.catalogueId) return;
  selectedMetadata = metadata;
  if (!animeTouched) {
    const existing = likesMode ? entries.find(entry => entry.catalogueId === metadata.catalogueId) : editingEntry?.catalogueId === metadata.catalogueId ? editingEntry : null;
    form.elements.anime.checked = (existing?.anime ?? metadata.anime) === true;
  }
} });

function isDuplicate(candidate) {
  return !likesMode && entries.some(entry => entry.catalogueId !== editingEntry?.catalogueId && entry.catalogueId === candidate.catalogueId);
}

const titlePicker = createTitleSearch({
  input: titleInput,
  list: document.querySelector('#title-matches'),
  feedback: matchFeedback,
  retry: document.querySelector('#retry-search'),
  onClear() {
    saveButton.disabled = true;
    panel.cancel();
    selectedMetadata = null;
    animeTouched = false;
    ratingDraft = null; ratingTouched = false; rating.update({ value: null, disabled: Boolean(appStore.loadError) });
    form.elements.liked.checked = likesMode;
    delete dialog.dataset.selected;
    document.querySelector('#title-confirmation').hidden = true;
    form.elements.status.disabled = true;
    form.elements.format.value = '';
    document.querySelector('#selected-meta').hidden = true;
  },
  onChoose(candidate) {
    titleInput.setCustomValidity('');
    document.querySelector('#title-confirmation').hidden = false;
    dialog.dataset.selected = 'true';
    form.elements.status.disabled = false;
    form.elements.format.value = candidate.format === 'movie' ? 'Movie' : 'Series';
    const existing = likesMode ? entries.find(entry => entry.catalogueId === candidate.catalogueId) : editingEntry?.catalogueId === candidate.catalogueId ? editingEntry : null;
    form.elements.liked.checked = existing?.liked === true || likesMode;
    ratingDraft = getPersonalRating(existing); ratingTouched = false; rating.update({ value: ratingDraft, disabled: Boolean(appStore.loadError) });
    if (likesMode) form.elements.status.value = existing?.status ?? 'untracked';
    void panel.show(candidate, { region: appStore.getState().preferences.region, animeOverride: existing?.anime ?? null });
    const metadata = document.querySelector('#selected-meta');
    metadata.textContent = `${candidate.year || 'Year unknown'} · TMDB`;
    saveButton.disabled = isDuplicate(candidate) || Boolean(appStore.loadError);
    if (saveButton.disabled) matchFeedback.textContent = 'Already in your library';
    if (dialog.open && !saveButton.disabled) document.querySelector('#entry-status').focus();
  },
});

function renderLibrary() {
  const unavailable = Boolean(appStore.loadError);
  document.querySelector('#storage-notice').textContent = unavailable ? 'Recovery needed' : 'Saved here';
  document.querySelector('#add-title').disabled = unavailable;
  document.querySelector('#first-title').disabled = unavailable;
  document.querySelector('#add-liked-title').disabled = unavailable;
  if (unavailable) feedback.textContent = 'Local data needs recovery. Open Settings before editing.';
  const visible = sortLibrary(filterLibrary(entries, { query: search.value, format: format.value, status: status.value, anime: anime.checked }).filter(entry => !liked.checked || entry.liked), sort.value);
  grid.replaceChildren();
  document.querySelector('#library-count').textContent = unavailable ? 'Library unavailable' : `${visible.length} of ${entries.length} titles`;
  document.querySelector('#empty-library').hidden = unavailable || entries.length > 0;
  document.querySelector('#no-results').hidden = entries.length === 0 || visible.length > 0;
  for (const button of document.querySelectorAll('[data-status]')) {
    button.setAttribute('aria-pressed', String(button.dataset.status === status.value));
    button.querySelector('[data-count]').textContent = button.dataset.status
      ? entries.filter(entry => entry.status === button.dataset.status).length
      : entries.length;
  }
  for (const entry of visible) {
    const card = createFilmCard(entry, { liked: entry.liked, onLike() {
      const focused = card.contains(document.activeElement);
      try {
        appStore.transact(draft => {
          const saved = draft.library.find(item => item.catalogueId === entry.catalogueId);
          setTitleLike(draft, entry, saved?.liked !== true);
        });
        feedback.textContent = entry.liked ? `Like removed: ${entry.title}` : `Liked: ${entry.title}`;
        if (focused) grid.querySelector(`[data-catalogue-id="${entry.catalogueId}"] .like-button`)?.focus();
      } catch { feedback.textContent = 'Not saved. Check browser storage or back up in Settings.'; }
    } });
    const state = document.createElement('p');
    state.className = 'status-tag';
    state.textContent = statusLabels[entry.status] || 'Not tracked';
    const score = document.createElement('p'); score.className = 'personal-rating-summary';
    const value = getPersonalRating(entry); score.textContent = value === null ? 'Your rating —' : `★ ${value} / 5 · Your rating`;
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'quiet-button'; edit.dataset.editTitle = '';
    edit.textContent = 'Edit'; edit.setAttribute('aria-label', `Edit ${entry.title}`);
    edit.disabled = unavailable;
    edit.addEventListener('click', () => openTitleForm(entry));
    card.querySelector('.card-body').append(state, score, edit);
    grid.append(card);
  }
}

function openTitleForm(entry = null, { addLiked = false } = {}) {
  editingEntry = entry;
  likesMode = addLiked;
  selectedMetadata = null;
  animeTouched = false;
  form.reset();
  titleInput.setCustomValidity('');
  document.querySelector('#dialog-heading').textContent = entry ? 'Title details' : addLiked ? 'Add a title you like' : 'Add title';
  document.querySelector('#save-title').textContent = entry ? 'Save changes' : addLiked ? 'Save like' : 'Add title';
  if (entry) {
    form.elements.status.value = entry.status ?? 'untracked';
    form.elements.anime.checked = entry.anime;
  }
  if (addLiked) form.elements.status.value = 'untracked';
  titlePicker.reset(entry);
  dialog.showModal();
  titleInput.focus();
}

document.querySelector('#add-title').addEventListener('click', () => openTitleForm());
document.querySelector('#add-liked-title').addEventListener('click', () => openTitleForm(null, { addLiked: true }));
document.querySelector('#first-title').addEventListener('click', () => openTitleForm());
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  // Native close events are queued; an older one must not cancel a reopened form.
  if (!dialog.open) { titlePicker.cancel(); panel.cancel(); }
});
form.elements.anime.addEventListener('change', () => {
  animeTouched = true;
  const candidate = titlePicker.selection;
  if (candidate) panel.updatePresentation({ animeOverride: form.elements.anime.checked });
});
titleInput.addEventListener('input', () => {
  titleInput.setCustomValidity(titleInput.value.trim() ? '' : 'Enter a title, not only spaces.');
});
form.addEventListener('submit', event => {
  event.preventDefault();
  const candidate = titlePicker.selection;
  if (!candidate) {
    matchFeedback.textContent = 'Choose a match';
    return;
  }
  if (isDuplicate(candidate)) {
    matchFeedback.textContent = 'Already in your library';
    saveButton.disabled = true;
    return;
  }
  if (!['untracked', 'watched', 'watching', 'plan_to_watch'].includes(form.elements.status.value)) {
    matchFeedback.textContent = 'Choose a viewing status';
    return;
  }
  try {
    appStore.transact(draft => {
      const original = editingEntry ? draft.library.find(item => item.catalogueId === editingEntry.catalogueId) : likesMode ? draft.library.find(item => item.catalogueId === candidate.catalogueId) : null;
      if (editingEntry && !original) throw new Error('Original entry changed.');
      const source = selectedMetadata?.catalogueId === candidate.catalogueId ? selectedMetadata : candidate;
      const sameIdentity = original?.catalogueId === candidate.catalogueId;
      const values = toLibraryEntry(source, sameIdentity ? original : {});
      values.status = form.elements.status.value === 'untracked' ? null : form.elements.status.value;
      values.liked = form.elements.liked.checked;
      if (animeTouched) values.anime = form.elements.anime.checked;
      if (original) draft.library[draft.library.indexOf(original)] = values;
      else draft.library.push(values);
      if (ratingTouched) setPersonalRating(draft, values, ratingDraft);
      draft.dismissed = draft.dismissed.filter(id => id !== candidate.catalogueId);
    });
    if (!editingEntry) resetFilters();
    feedback.textContent = `Saved: ${candidate.title}`;
  } catch {
    matchFeedback.textContent = 'Not saved. Check browser storage or back up in Settings.';
    return;
  }
  dialog.close();
});

function resetFilters() {
  search.value = '';
  format.value = '';
  status.value = '';
  anime.checked = false;
  liked.checked = false;
  renderLibrary();
}

search.addEventListener('input', renderLibrary);
for (const filter of [format, status, anime, liked]) filter.addEventListener('change', renderLibrary);
document.querySelector('#reset-filters').addEventListener('click', resetFilters);
sort.addEventListener('change', renderLibrary);
for (const button of document.querySelectorAll('[data-status]')) {
  button.addEventListener('click', () => {
    status.value = button.dataset.status;
    renderLibrary();
  });
}
for (const view of ['grid', 'list']) {
  document.querySelector(`#view-${view}`).addEventListener('click', () => {
    grid.dataset.view = view;
    for (const option of ['grid', 'list']) {
      document.querySelector(`#view-${option}`).setAttribute('aria-pressed', String(view === option));
    }
  });
}
appStore.subscribe(() => { entries = appStore.getState().library; renderLibrary(); });
renderLibrary();
if (new URL(location.href).searchParams.get('add') === 'liked' && !appStore.loadError) openTitleForm(null, { addLiked: true });
