// Format and anime are independent: an anime can be a movie or a series.
export function filterLibrary(entries, { query = '', format = '', anime = false, status = '' } = {}) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(entry =>
    terms.every(term => [entry.title, entry.year, entry.overview, entry.format === 'movie' ? 'movie film' : 'series tv television show', entry.anime ? 'anime' : '', ...(entry.genres || []).map(genre => genre.name)].filter(Boolean).join(' ').toLowerCase().includes(term)) &&
    (!format || entry.format === format) &&
    (!anime || entry.anime) &&
    (!status || entry.status === status)
  );
}

export function sortLibrary(entries, order = 'newest') {
  const sorted = [...entries];
  if (order === 'title') {
    return sorted.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
  }
  return sorted.reverse();
}
