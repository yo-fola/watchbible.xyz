import { appStore } from './app.mjs';
import { COLLECTIONS } from './collection-definitions.mjs';
import { getCollectionProgress, getProgress } from './gamification-model.mjs';
import { applyTitleChoice } from './library-actions.mjs';
import { createFilmCard, decorateActionButton } from './film-card.mjs';
import { createPoster } from './poster.mjs';

const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
const statusLabel = (state, id) => {
  const entry = state.library.find(item => item.catalogueId === id);
  if (entry) return ({ watched: '✓ Watched', watching: 'Watching', plan_to_watch: 'Watch later', dropped: 'Dropped' })[entry.status] || entry.status;
  return state.dismissed.includes(id) ? 'Not for me' : 'Unwatched';
};

export function mountCollections({ root = document.querySelector('#collections-root'), store = appStore, collectionId = new URL(location.href).searchParams.get('collection') } = {}) {
  if (!root) return () => {};
  const $ = selector => root.querySelector(selector);
  const collection = COLLECTIONS.find(item => item.id === collectionId);
  const feedback = $('#collections-feedback');
  const listeners = [];
  const listen = (node, type, handler) => { node.addEventListener(type, handler); listeners.push(() => node.removeEventListener(type, handler)); };
  function chooseTitle(action, candidate) {
    if (store.loadError) return false;
    // Repeated clicks do not overwrite a richer saved record with roster metadata.
    const existing = store.getState().library.find(item => item.catalogueId === candidate.catalogueId);
    const desired = action === 'watched' ? 'watched' : action === 'watch_later' ? 'plan_to_watch' : null;
    if (existing && desired === existing.status) { feedback.textContent = `${candidate.title}: already ${desired === 'watched' ? 'watched' : 'saved for later'}.`; return true; }
    try {
      const before = getProgress(store.getState());
      store.transact(draft => applyTitleChoice(draft, { ...candidate, ...existing }, action));
      feedback.textContent = `${candidate.title}: ${action === 'watched' ? 'marked Watched' : action === 'watch_later' ? 'saved for later' : 'marked Not for me'}.`;
      const after = getProgress(store.getState());
      const earnedBefore = new Set(before.badges.filter(badge => badge.earned).map(badge => badge.id));
      const unlocked = after.badges.filter(badge => badge.earned && !earnedBefore.has(badge.id));
      if (after.xp > before.xp) feedback.append(document.createTextNode(` +${after.xp - before.xp} XP.`));
      if (after.level > before.level) feedback.append(document.createTextNode(` Level ${after.level} reached.`));
      if (unlocked.length) feedback.append(document.createTextNode(` Unlocked: ${unlocked.map(badge => badge.name).join(', ')}.`));
      if (unlocked.length || after.level > before.level) {
        const link = document.createElement('a'); link.href = 'achievements.html'; link.textContent = 'View achievements →';
        feedback.append(document.createTextNode(' '), link);
      }
      return true;
    } catch { feedback.textContent = 'Could not save this choice. Nothing changed. Retry or open Settings.'; return false; }
  }
  function toggleFollow(id) {
    if (store.loadError) return;
    const restoreFocus = document.activeElement?.dataset.follow === id;
    try {
      store.transact(draft => { const ids = draft.gamification.followed; draft.gamification.followed = ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]; });
      feedback.textContent = store.getState().gamification.followed.includes(id) ? 'Collection followed. Your library has not changed.' : 'Collection unfollowed. Your library has not changed.';
      if (restoreFocus) {
        const target = [...root.querySelectorAll('[data-follow]')].find(button => button.dataset.follow === id && !button.closest('[hidden]'));
        (target || $('#collections-followed')).focus();
      }
    } catch { feedback.textContent = 'Could not save this follow change. Nothing changed. Retry or open Settings.'; }
  }
  function followButton(node, item, state) {
    const followed = state.gamification.followed.includes(item.id);
    node.dataset.follow = item.id; node.textContent = followed ? 'Unfollow collection' : 'Follow collection'; node.setAttribute('aria-pressed', String(followed));
  }
  function empty(show, heading, copy) { $('#collections-empty').hidden = !show; $('#collections-empty-heading').textContent = heading; $('#collections-empty-copy').textContent = copy; }
  function render() {
    const failed = Boolean(store.loadError);
    $('#collections-recovery').hidden = !failed; $('#collections-data').hidden = failed;
    for (const control of root.querySelectorAll('button, select, input')) control.disabled = failed;
    if (failed) { feedback.textContent = 'Saved data could not be read. Collection progress is unavailable; recover your local data in Settings.'; return; }
    const state = store.getState();
    $('#collections-overview').hidden = Boolean(collectionId); $('#collection-detail').hidden = !collection;
    if (collectionId && !collection) { empty(true, 'Collection not found', 'This collection is not in the verified catalogue. Browse the available sets.'); return; }
    if (!collection) {
      const visible = COLLECTIONS.filter(item => {
        const progress = getCollectionProgress(state, item);
        return (!$('#collections-followed').checked || state.gamification.followed.includes(item.id)) && (!$('#collection-status').value || ($('#collection-status').value === 'complete' ? progress.complete : progress.watched > 0 && !progress.complete));
      });
      $('#collections-count').textContent = `${visible.length} ${visible.length === 1 ? 'collection' : 'collections'}`;
      const cards = visible.map(item => {
        const card = document.createElement('article'); card.className = 'collection-card'; card.dataset.collectionId = item.id;
        const link = document.createElement('a'); link.href = `collections.html?collection=${encodeURIComponent(item.id)}`; link.className = 'collection-cover'; link.setAttribute('aria-label', `Open ${item.name}`); link.append(createPoster(item.members[0]));
        const body = document.createElement('div'); body.className = 'collection-card-body';
        const title = document.createElement('a'); title.href = link.href; title.append(text('h2', item.name));
        const progress = getCollectionProgress(state, item); const meter = document.createElement('progress'); meter.max = progress.total || 1; meter.value = progress.watched; meter.setAttribute('aria-label', `${item.name}: ${progress.watched} of ${progress.total} watched`);
        const follow = document.createElement('button'); follow.type = 'button'; follow.className = 'quiet-button'; followButton(follow, item, state); follow.addEventListener('click', () => toggleFollow(item.id));
        body.append(title, text('p', item.description, 'note'), text('p', `${progress.watched} / ${progress.total} watched${progress.complete ? ' · Complete' : ''}`, 'collection-count'), meter, follow); card.append(link, body); return card;
      });
      $('#collections-list').replaceChildren(...cards);
      empty(!visible.length, 'No collections match', $('#collections-followed').checked ? 'No followed collections match these filters. Try All or turn off Followed.' : 'Try a different progress filter.');
      return;
    }
    $('#collections-heading').textContent = collection.name;
    $('#collection-description').textContent = collection.description;
    const progress = getCollectionProgress(state, collection);
    $('#collection-progress').textContent = `${progress.watched} / ${progress.total} watched · ${Math.round(progress.percent)}%${progress.complete ? ' · Complete' : ''}`;
    $('#collection-meter').value = progress.percent; followButton($('#collection-follow'), collection, state);
    const watchedIds = new Set(state.library.filter(item => item.status === 'watched' && item.format === 'movie').map(item => item.catalogueId));
    const visible = collection.members.filter(item => !$('#collection-view').value || ($('#collection-view').value === 'watched' ? watchedIds.has(item.catalogueId) : !watchedIds.has(item.catalogueId)));
    // Members are curated in release order, including same-year releases.
    const focused = document.activeElement; const focusId = focused?.closest('[data-catalogue-id]')?.dataset.catalogueId; const focusChoice = focused?.dataset.choice; const wasPoster = focused?.classList.contains('poster-button');
    $('#collection-grid').replaceChildren(...visible.map(item => {
      const card = createFilmCard(item);
      card.classList.add('collection-film'); card.dataset.watched = String(watchedIds.has(item.catalogueId));
      card.querySelector('.card-body').append(text('p', statusLabel(state, item.catalogueId), 'collection-film-status'));
      const actions = document.createElement('div'); actions.className = 'collection-film-actions'; actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', `Save ${item.title}`);
      for (const [value, label] of [['watched', 'Watched'], ['watch_later', 'Watch later']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button'; button.dataset.choice = value; button.textContent = label;
        const saved = state.library.find(entry => entry.catalogueId === item.catalogueId); button.setAttribute('aria-pressed', String(saved?.status === (value === 'watched' ? 'watched' : 'plan_to_watch')));
        decorateActionButton(button, value);
        button.addEventListener('click', () => chooseTitle(value, item)); actions.append(button);
      }
      card.querySelector('.card-body').append(actions); return card;
    }));
    if (focusId && (focusChoice || wasPoster)) {
      const card = [...$('#collection-grid').children].find(item => item.dataset.catalogueId === focusId);
      const target = card?.querySelector(focusChoice ? `[data-choice="${focusChoice}"]` : '.poster-button');
      (target || $('#collection-view')).focus();
    }
    const source = document.createElement('a'); source.href = collection.sourceUrl; source.textContent = 'Roster source';
    $('#collection-source').replaceChildren(document.createTextNode(`Verified movie set · version ${collection.version}. `), source, document.createTextNode(' · Artwork and movie data: TMDB. Viewing history is self-reported; no watch order or dates are inferred.'));
    empty(!visible.length, 'No movies match', `Try All to see the full ${collection.members.length}-movie checklist.`);
  }
  listen($('#collection-status'), 'change', render); listen($('#collections-followed'), 'change', render); listen($('#collection-view'), 'change', render);
  listen($('#collection-follow'), 'click', () => { if (collection) toggleFollow(collection.id); });
  listen($('#reset-collection-filters'), 'click', () => { $('#collection-status').value = ''; $('#collections-followed').checked = false; $('#collection-view').value = ''; render(); });
  const unsubscribe = store.subscribe(render); render(); if (!store.loadError) feedback.textContent = '';
  return () => { unsubscribe(); for (const remove of listeners) remove(); };
}

if (typeof document !== 'undefined' && document.querySelector('#collections-root')) mountCollections();
