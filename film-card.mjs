import { createPoster } from './poster.mjs';

export function titlePageHref(candidate) {
  if (!candidate || !['movie', 'series'].includes(candidate.format) || !Number.isSafeInteger(candidate.tmdbId) || candidate.tmdbId < 1 || candidate.catalogueId !== `tmdb:${candidate.format}:${candidate.tmdbId}`) return null;
  return `title.html?format=${candidate.format}&id=${candidate.tmdbId}`;
}

let ratingSequence = 0;
// Native radios supply keyboard/assistive-technology behaviour; no score is
// inferred from a Like, provider score, or viewing status. Return false to roll
// back a failed save. A form may instead keep this value as an unsaved draft.
export function createStarRating({ value = null, disabled = false, onChange = () => {}, document: doc = globalThis.document } = {}) {
  const element = doc.createElement('fieldset'); element.className = 'personal-rating';
  const legend = doc.createElement('legend'); legend.textContent = 'Your rating';
  const row = doc.createElement('div'); row.className = 'rating-stars';
  const output = doc.createElement('output'); output.className = 'rating-value'; output.setAttribute('aria-live', 'polite');
  const name = `personal-stars-${++ratingSequence}`, inputs = [], symbols = [];
  let selected = value, locked = disabled;
  function update({ value = selected, disabled = locked } = {}) {
    selected = value; locked = disabled; element.disabled = locked;
    inputs.forEach((input, index) => {
      input.checked = selected === index + 1; input.disabled = locked;
      symbols[index].textContent = selected !== null && selected >= index + 1 ? '★' : '☆';
      symbols[index].dataset.filled = String(selected !== null && selected >= index + 1);
    });
    output.textContent = selected === null ? 'Not rated' : `${selected} / 5 stars`;
    clear.disabled = locked || selected === null;
  }
  function choose(next) {
    if (locked) return;
    const previous = selected;
    try { update({ value: onChange(next) === false ? previous : next }); }
    catch { update({ value: previous }); }
  }
  for (let stars = 1; stars <= 5; stars++) {
    const label = doc.createElement('label'); label.className = 'rating-star';
    const input = doc.createElement('input'); input.type = 'radio'; input.name = name; input.value = String(stars); input.className = 'sr-only';
    input.setAttribute('aria-label', `Rate ${stars} out of 5 stars`);
    const symbol = doc.createElement('span'); symbol.setAttribute('aria-hidden', 'true');
    input.addEventListener('change', () => choose(stars));
    inputs.push(input); symbols.push(symbol); label.append(input, symbol); row.append(label);
  }
  const clear = doc.createElement('button'); clear.type = 'button'; clear.className = 'quiet-button rating-clear'; clear.textContent = 'Clear'; clear.setAttribute('aria-label', 'Clear your rating');
  clear.addEventListener('click', () => choose(null)); row.append(clear);
  element.append(legend, row, output); update();
  return { element, update };
}

const actionSymbols = {
  watched: ['M9 12l2 2 4-4', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0'],
  watching: ['M8 5l11 7-11 7Z'],
  watch_later: ['M6 3h12v18l-6-4-6 4Z'],
  like: ['M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z'],
  not_for_me: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M5.6 5.6l12.8 12.8'],
  clear: ['M3 10a9 9 0 1 1 2.7 8.4', 'M3 4v6h6'],
};

// Decorative, fixed SVG geometry; existing text and action handlers stay intact.
export function decorateActionButton(button, action) {
  if (!actionSymbols[action]) return button;
  button.classList.add('action-button'); button.dataset.visualAction = action;
  button.querySelector('.action-symbol')?.remove();
  const svg = button.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'action-symbol');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  for (const geometry of actionSymbols[action]) {
    const path = button.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', geometry); svg.append(path);
  }
  button.prepend(svg);
  return button;
}

export function createFilmCard(candidate, { onChoice, choice = null, onLike, liked = false, reason = '' } = {}) {
  const card = document.createElement('article');
  card.className = 'library-card';
  card.dataset.catalogueId = candidate.catalogueId;
  const href = titlePageHref(candidate);
  const poster = document.createElement(href ? 'a' : 'div');
  poster.className = 'poster-button';
  if (href) {
    poster.href = href;
    poster.classList.add('card-open');
    poster.setAttribute('aria-label', `Open ${candidate.title}`);
  }
  poster.append(createPoster(candidate));
  const body = document.createElement('div');
  body.className = 'card-body';
  const meta = document.createElement('p');
  meta.className = 'eyebrow';
  meta.textContent = [candidate.year, candidate.format === 'movie' ? 'Movie' : 'Series', candidate.anime === true ? 'Anime' : null].filter(Boolean).join(' · ');
  const heading = document.createElement('h3');
  heading.textContent = candidate.title;
  body.append(meta, heading);
  if (candidate.genres?.length) {
    const genres = document.createElement('p');
    genres.className = 'card-genres';
    genres.textContent = candidate.genres.map(genre => genre.name).join(' · ');
    body.append(genres);
  }
  if (reason) {
    const why = document.createElement('p');
    why.className = 'recommendation-reason';
    why.textContent = reason;
    body.append(why);
  }
  if (onChoice) {
    const actions = document.createElement('div');
    actions.className = 'film-actions';
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', `Choose for ${candidate.title}`);
    for (const [value, label] of [['watch_later', 'Watch later'], ['watched', 'Watched'], ['not_for_me', 'Not for me']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quiet-button';
      button.dataset.choice = value;
      button.textContent = label;
      button.setAttribute('aria-pressed', String(choice === value));
      decorateActionButton(button, value);
      button.addEventListener('click', () => onChoice(value, candidate));
      actions.append(button);
    }
    body.append(actions);
  }
  if (onLike) {
    const heart = document.createElement('button');
    heart.type = 'button';
    heart.className = 'like-button quiet-button';
    const label = document.createElement('span'); label.className = 'sr-only'; label.textContent = 'Like'; heart.append(label);
    heart.setAttribute('aria-label', `Like ${candidate.title}`);
    heart.setAttribute('aria-pressed', String(liked));
    decorateActionButton(heart, 'like');
    heart.addEventListener('click', () => onLike(candidate));
    body.append(heart);
  }
  card.append(poster, body);
  return card;
}
