// User actions are separate from catalogue metadata and recommendation scores.
export function toLibraryEntry(candidate, existing = {}) {
  const result = {};
  for (const key of ['catalogueId', 'tmdbId', 'provider', 'title', 'format', 'year', 'posterUrl', 'sourceUrl', 'overview', 'genres', 'genreIds', 'backdropUrl', 'runtimeMinutes', 'seasons', 'episodes', 'imdbId', 'fetchedAt']) {
    if (candidate[key] !== undefined) result[key] = structuredClone(candidate[key]);
    else if (existing[key] !== undefined) result[key] = structuredClone(existing[key]);
  }
  result.genres ??= [];
  if (candidate.genres && candidate.genreIds === undefined) result.genreIds = candidate.genres.map(genre => genre.id);
  result.genreIds ??= result.genres.map(genre => genre.id);
  result.overview ??= '';
  result.year ??= null;
  result.posterUrl ??= null;
  result.anime = existing.anime ?? candidate.anime ?? null;
  result.liked = existing.liked === true;
  result.status = existing.status === null ? null : existing.status || 'plan_to_watch';
  if (existing.personalRating !== undefined) result.personalRating = existing.personalRating;
  if (existing.personalRatingScale !== undefined) result.personalRatingScale = existing.personalRatingScale;
  return result;
}

// Ratings without an explicit scale retain their original ten-point meaning.
export function getPersonalRating(entry) {
  const value = entry?.personalRating;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (entry.personalRatingScale === 5) return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
  if (entry.personalRatingScale !== undefined) return null;
  return value >= 0 && value <= 10 ? value / 2 : null;
}

export function setPersonalRating(draft, candidate, value) {
  if (value !== null && (!Number.isInteger(value) || value < 1 || value > 5)) {
    throw new TypeError('Personal rating must be an integer from 1 to 5 or null.');
  }
  let existing = draft.library.find(entry => entry.catalogueId === candidate.catalogueId);
  if (!existing && value === null) return;
  if (!existing) {
    existing = { ...toLibraryEntry(candidate), status: null, liked: false };
    draft.library.push(existing);
  }
  existing.personalRating = value;
  existing.personalRatingScale = 5;
}

export function setTitleLike(draft, candidate, liked) {
  if (typeof liked !== 'boolean') throw new TypeError('Like must be a boolean.');
  const existing = draft.library.find(entry => entry.catalogueId === candidate.catalogueId);
  if (!existing && !liked) return;
  if (existing) existing.liked = liked;
  else draft.library.push({ ...toLibraryEntry(candidate), status: null, liked });
  if (liked) draft.dismissed = draft.dismissed.filter(id => id !== candidate.catalogueId);
}

export function applyTitleChoice(draft, candidate, action) {
  if (!['watch_later', 'watched', 'not_for_me'].includes(action)) throw new Error('Invalid choice.');
  const existing = draft.library.find(entry => entry.catalogueId === candidate.catalogueId);
  if (action === 'not_for_me') {
    if (existing) throw new Error('Already in your library.');
    if (!draft.dismissed.includes(candidate.catalogueId)) draft.dismissed.push(candidate.catalogueId);
    return;
  }
  draft.dismissed = draft.dismissed.filter(id => id !== candidate.catalogueId);
  const status = action === 'watched' ? 'watched' : 'plan_to_watch';
  const entry = { ...toLibraryEntry(candidate, existing), status };
  if (existing) draft.library[draft.library.indexOf(existing)] = entry;
  else draft.library.push(entry);
}
