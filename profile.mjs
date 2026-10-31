import { appStore } from './app.mjs';
import { getProgress, recognizeHistory } from './gamification-model.mjs';

// No derived progress is persisted by rendering. Only explicit form/confirm actions write.
export function mountProfile({ root = document.querySelector('#profile-root'), store = appStore } = {}) {
  if (!root) return () => {};
  const $ = selector => root.querySelector(selector);
  const feedback = $('#profile-feedback');
  const input = $('#display-name');
  const preview = $('#recognition-preview');
  let previewIds = null;
  let nameDirty = false;
  const listeners = [];
  const listen = (node, event, handler) => { node.addEventListener(event, handler); listeners.push(() => node.removeEventListener(event, handler)); };
  const sameIds = (left, right) => left.length === right.length && [...left].sort().every((id, index) => id === [...right].sort()[index]);
  const previewChanged = new Error('Recognition preview changed');

  function render() {
    const failed = Boolean(store.loadError);
    $('#profile-recovery').hidden = !failed;
    $('#profile-data').hidden = failed;
    $('#save-profile').disabled = failed;
    input.disabled = failed;
    if (failed) {
      $('#profile-name').textContent = 'Your profile';
      feedback.textContent = 'Saved data could not be read. Progress is unavailable; export recoverable data in Settings before restoring a backup.';
      return;
    }
    const state = store.getState();
    const progress = getProgress(state);
    const name = state.gamification.profile.displayName;
    $('#profile-name').textContent = name || 'Your profile';
    if (!nameDirty) input.value = name;
    $('#profile-level').textContent = `Level ${progress.level}`;
    $('#level-progress').max = progress.nextLevelXP;
    $('#level-progress').value = progress.levelXP;
    $('#level-detail').textContent = `${progress.levelXP} / ${progress.nextLevelXP} XP towards Level ${progress.level + 1}`;
    $('#total-xp').textContent = `${progress.xp} XP`;
    $('#watched-movies').textContent = String(progress.watchedMovies);
    $('#earned-badges').textContent = String(progress.badges.filter(badge => badge.earned).length);
    const pending = progress.pendingRecognition.length;
    $('#recognition-pending').textContent = pending ? `${pending} watched ${pending === 1 ? 'movie is' : 'movies are'} eligible for review.` : 'No movie history is waiting for XP recognition.';
    $('#preview-recognition').disabled = pending === 0;
    $('#followed-collections').textContent = `Collections · ${state.gamification.followed.length} followed`;
  }

  function showPreview(ids, changed = false) {
    previewIds = [...ids];
    preview.hidden = false;
    $('#recognition-summary').textContent = `${ids.length} ${ids.length === 1 ? 'movie' : 'movies'} · ${ids.length * 100} XP. ${changed ? 'History changed. Review this updated preview before confirming again.' : 'Nothing has been credited yet.'}`;
    const selected = new Set(ids);
    $('#recognition-titles').replaceChildren(...store.getState().library.filter(movie => selected.has(movie.catalogueId)).map(movie => {
      const item = document.createElement('li');
      item.textContent = `${movie.title}${movie.year ? ` (${movie.year})` : ''} · Movie`;
      return item;
    }));
    $('#confirm-recognition').disabled = ids.length === 0;
  }

  listen(input, 'input', () => { nameDirty = true; });
  listen($('#profile-form'), 'submit', event => {
    event.preventDefault();
    if (store.loadError) return;
    const name = input.value.trim();
    if (name.length > input.maxLength) { feedback.textContent = 'Use a display name of 60 characters or fewer.'; return; }
    try {
      store.transact(draft => { draft.gamification.profile.displayName = name; });
      nameDirty = false;
      render();
      feedback.textContent = 'Display name saved in this browser.';
    } catch { feedback.textContent = 'Could not save your name. Nothing changed. Retry or open Settings to check local storage.'; }
  });
  listen($('#preview-recognition'), 'click', () => {
    if (store.loadError) return;
    showPreview(getProgress(store.getState()).pendingRecognition);
    feedback.textContent = '';
    $('#recognition-preview-heading').focus();
  });
  listen($('#cancel-recognition'), 'click', () => {
    previewIds = null;
    preview.hidden = true;
    feedback.textContent = 'Recognition cancelled. No XP credited.';
    $('#preview-recognition').focus();
  });
  listen($('#confirm-recognition'), 'click', () => {
    if (previewIds === null || store.loadError) return;
    const current = getProgress(store.getState());
    if (!sameIds(previewIds, current.pendingRecognition)) {
      showPreview(current.pendingRecognition, true);
      feedback.textContent = 'History changed. Review the refreshed count and XP before confirming.';
      return;
    }
    if (previewIds.length === 0) return;
    const approvedIds = [...previewIds];
    try {
      // Re-evaluate at the transaction boundary as well as immediately before it.
      store.transact(draft => {
        if (!sameIds(approvedIds, getProgress(draft).pendingRecognition)) throw previewChanged;
        recognizeHistory(draft, approvedIds);
      });
      const after = getProgress(store.getState());
      previewIds = null;
      preview.hidden = true;
      feedback.textContent = `History recognised: ${after.xp - current.xp} XP credited. No watch dates or viewing statuses changed.`;
      render();
      $('#profile-level').setAttribute('tabindex', '-1');
      $('#profile-level').focus();
    } catch (error) {
      if (error === previewChanged) {
        showPreview(getProgress(store.getState()).pendingRecognition, true);
        feedback.textContent = 'History changed. Review the refreshed preview before confirming.';
      } else {
        feedback.textContent = 'Could not save recognition. No XP credited. Retry or open Settings to check local storage.';
      }
    }
  });
  const unsubscribe = store.subscribe(render);
  render();
  if (!store.loadError) feedback.textContent = '';
  return () => { unsubscribe(); for (const remove of listeners) remove(); };
}

if (typeof document !== 'undefined' && document.querySelector('#profile-root')) mountProfile();
