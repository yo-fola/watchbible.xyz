// Pure ranking: no persistence, requests, or implicit positive watch-history signal.
export function rankRecommendations(candidates, state) {
  const excluded = new Set(state.dismissed);
  const likedSeeds = new Map(), laterSeeds = new Map();
  let order = 0;
  for (const seed of state.library) {
    const id = seed.catalogueId;
    excluded.add(id);
    if (seed.liked === true && !likedSeeds.has(id)) likedSeeds.set(id, { title: seed.title, order });
    if (seed.status === 'plan_to_watch' && !laterSeeds.has(id)) laterSeeds.set(id, { order });
    order++;
  }
  const formats = new Set(state.preferences.formats);
  const genresByFormat = new Map([...formats].map(format => [format, new Set(state.preferences.genres[format])]));
  const merged = new Map();
  for (const candidate of candidates) {
    const existing = merged.get(candidate.catalogueId);
    if (!existing) {
      const item = structuredClone(candidate);
      item.genreIds = [...new Set(item.genreIds)];
      if (item.relatedTo) item.relatedTo = [...new Set(item.relatedTo)];
      merged.set(item.catalogueId, item);
    } else {
      existing.relatedTo = [...new Set([...(existing.relatedTo || []), ...(candidate.relatedTo || [])])];
      existing.genreIds = [...new Set([...existing.genreIds, ...candidate.genreIds])];
      if (candidate.adult === true) existing.adult = true;
      if (Number.isFinite(candidate.popularity) && candidate.popularity > (Number.isFinite(existing.popularity) ? existing.popularity : 0)) {
        existing.popularity = candidate.popularity;
      }
    }
  }
  // Map insertion order plus stable sort preserves first-seen order on ties.
  return [...merged.values()]
    .filter(item => item.adult !== true && !excluded.has(item.catalogueId) && formats.has(item.format))
    .map(item => {
      let liked, later;
      for (const id of item.relatedTo || []) {
        const seed = likedSeeds.get(id);
        if (seed && (!liked || seed.order < liked.order)) liked = seed;
        if (laterSeeds.has(id)) later = true;
      }
      const genres = genresByFormat.get(item.format);
      const matches = item.genreIds.filter(id => genres.has(id)).length;
      const popularity = Number.isFinite(item.popularity) && item.popularity > 0 ? item.popularity : 0;
      // Bounded secondary signals can never overwhelm the explicit seed tiers.
      const score = (liked ? 300 : later ? 200 : matches ? 100 : 0) +
        10 * matches / (matches + 1) + popularity / (popularity + 100);
      const recommendationReason = liked ? `Because you liked ${liked.title}` : later ? 'From your Watch later' : matches ? 'Fits your genres' : 'Popular picks';
      return { ...item, recommendationReason, score };
    })
    .sort((a, b) => b.score - a.score);
}
