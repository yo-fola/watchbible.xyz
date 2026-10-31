import { createPoster } from './poster.mjs';

// A search result is only a candidate. The library owns final confirmation.
export function createTitleSearch({ input, list, feedback, retry, onChoose, onClear, delay = 300, fetchImpl = (...args) => fetch(...args) }) {
  let selection = null;
  let matches = [];
  let active = -1;
  let timer = null;
  let controller = null;
  let revision = 0;

  function hideResults() {
    matches = [];
    active = -1;
    list.replaceChildren();
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function cancel() {
    revision += 1;
    clearTimeout(timer);
    timer = null;
    controller?.abort();
    controller = null;
    hideResults();
    retry.hidden = true;
  }

  function choose(candidate) {
    cancel();
    selection = candidate;
    input.value = candidate.title;
    feedback.textContent = '';
    onChoose(candidate);
  }

  function setActive(index) {
    active = index;
    for (const [i, option] of [...list.children].entries()) option.setAttribute('aria-selected', String(i === index));
    const option = list.children[index];
    if (option) {
      input.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    }
  }

  function render(results) {
    hideResults();
    matches = results;
    if (matches.length === 0) {
      feedback.textContent = 'No matches';
      return;
    }
    for (const [index, candidate] of matches.entries()) {
      const option = document.createElement('div');
      option.id = `title-match-${revision}-${index}`;
      option.className = 'title-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      const type = candidate.format === 'movie' ? 'Movie' : 'Series';
      option.setAttribute('aria-label', `${candidate.title}, ${candidate.year || 'year unknown'}, ${type}`);
      const text = document.createElement('div');
      const title = document.createElement('span');
      title.className = 'match-title';
      title.textContent = candidate.title;
      const metadata = document.createElement('span');
      metadata.className = 'match-meta';
      metadata.textContent = `${candidate.year || 'Year unknown'} · ${type}`;
      text.append(title, metadata);
      option.append(createPoster(candidate), text);
      option.addEventListener('click', () => choose(candidate));
      option.addEventListener('mousemove', () => setActive(index));
      list.append(option);
    }
    feedback.textContent = '';
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  async function search(query, requestedRevision) {
    timer = null;
    const requestController = new AbortController();
    controller = requestController;
    feedback.textContent = 'Searching…';
    try {
      const response = await fetchImpl(`/api/search?q=${encodeURIComponent(query)}`, { signal: requestController.signal, cache: 'no-store' });
      const data = await response.json();
      if (requestedRevision !== revision) return;
      if (!response.ok) throw new Error(response.status === 404 ? 'Restart watchbible to enable search.' : typeof data.error === 'string' ? data.error : 'Search unavailable.');
      if (!Array.isArray(data.results)) throw new Error('Search unavailable.');
      const valid = data.results.filter(item => typeof item.title === 'string' && typeof item.catalogueId === 'string' && ['movie', 'series'].includes(item.format));
      render(valid.slice(0, 6));
    } catch (error) {
      if (requestedRevision !== revision || requestController.signal.aborted) return;
      hideResults();
      feedback.textContent = error.message || 'Search unavailable.';
      retry.hidden = false;
    } finally {
      if (controller === requestController) controller = null;
    }
  }

  function queueSearch() {
    cancel();
    selection = null;
    onClear();
    const query = input.value.trim();
    feedback.textContent = '';
    if (!query) return;
    const requestedRevision = revision;
    timer = setTimeout(() => search(query, requestedRevision), delay);
  }

  input.addEventListener('input', event => { if (!event.isComposing) queueSearch(); });
  input.addEventListener('compositionend', queueSearch);
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
      event.preventDefault();
      setActive(event.key === 'ArrowDown' ? (active + 1) % matches.length : (active <= 0 ? matches.length : active) - 1);
    } else if (event.key === 'Enter' && !selection) {
      event.preventDefault();
      if (active >= 0 && matches[active]) choose(matches[active]);
      else feedback.textContent = 'Choose a match';
    } else if (event.key === 'Escape' && (matches.length || timer || controller)) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      feedback.textContent = '';
    }
  });
  retry.addEventListener('click', () => {
    cancel();
    const query = input.value.trim();
    if (query) search(query, revision);
  });

  return {
    get selection() { return selection; },
    cancel,
    reset(candidate = null) {
      cancel();
      feedback.textContent = '';
      selection = candidate?.catalogueId ? candidate : null;
      input.value = candidate?.title || '';
      if (selection) onChoose(selection);
      else onClear();
    },
  };
}
