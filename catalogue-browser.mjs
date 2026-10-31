export function interleaveResults(groups, limit = 40) {
  const result = [];
  const seen = new Set();
  const longest = Math.max(0, ...groups.map(group => group.length));
  for (let index = 0; index < longest && result.length < limit; index += 1) {
    for (const group of groups) {
      const candidate = group[index];
      if (candidate && !seen.has(candidate.catalogueId) && result.length < limit) {
        seen.add(candidate.catalogueId);
        result.push(candidate);
      }
    }
  }
  return result;
}

export async function fetchJSON(path, options = {}, fetchImpl = (...args) => fetch(...args)) {
  const response = await fetchImpl(path, { cache: 'no-store', ...options });
  let data;
  try { data = await response.json(); } catch { throw new Error('Unexpected local API response. Restart the launcher and retry.'); }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Catalogue unavailable. Retry.');
  return data;
}

export function enrichGenres(candidate, lists) {
  const ids = candidate.genreIds || candidate.genres?.map(genre => genre.id) || [];
  return { ...candidate, genreIds: [...ids], genres: candidate.genres || (lists[candidate.format] || []).filter(genre => ids.includes(genre.id)) };
}

export function positiveSeeds(state, limit = 3) {
  return [...state.library.filter(entry => entry.liked), ...state.library.filter(entry => !entry.liked && entry.status === 'plan_to_watch')].slice(0, limit);
}
