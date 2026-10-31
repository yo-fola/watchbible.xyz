// Server-only module. Never import this into browser-delivered JavaScript.
export async function searchTmdb(query, token, fetchImpl = fetch) {
  if (typeof query !== 'string' || !query.trim() || query.trim().length > 200) {
    throw new TmdbError(400, 'Search must contain between 1 and 200 characters.');
  }
  if (typeof token !== 'string' || !token.trim()) {
    throw new TmdbError(503, 'Token not configured. Start with start-watchbible.zsh.');
  }
  const url = new URL('https://api.themoviedb.org/3/search/multi');
  url.search = new URLSearchParams({ query: query.trim(), include_adult: 'false', language: 'en-US', page: '1' });
  let response;
  try {
    response = await fetchImpl(url.href, {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new TmdbError(502, 'Could not reach TMDB. Check your connection and retry.');
  }
  if (!response || !Number.isInteger(response.status) || typeof response.ok !== 'boolean') {
    throw new TmdbError(502, 'Unexpected TMDB response.');
  }
  if (response.status === 401 || response.status === 403) throw new TmdbError(401, 'TMDB rejected the token. Restart and enter the read-access token again.');
  if (response.status === 429) throw new TmdbError(429, 'TMDB rate limit. Try again later.');
  if (!response.ok) throw new TmdbError(502, 'TMDB is unavailable. Try again later.');
  let data;
  try {
    data = await response.json();
  } catch {
    throw new TmdbError(502, 'Unexpected TMDB response.');
  }
  if (!data || !Array.isArray(data.results)) throw new TmdbError(502, 'Unexpected TMDB response.');
  const results = [];
  const seen = new Set();
  for (const item of data.results) {
    if (!item || (item.media_type !== 'movie' && item.media_type !== 'tv') || item.adult === true || !Number.isSafeInteger(item.id) || item.id <= 0) continue;
    const isMovie = item.media_type === 'movie';
    const format = isMovie ? 'movie' : 'series';
    const title = isMovie ? item.title : item.name;
    if (typeof title !== 'string' || !title.trim()) continue;
    const catalogueId = `tmdb:${format}:${item.id}`;
    if (seen.has(catalogueId)) continue;
    seen.add(catalogueId);
    const date = isMovie ? item.release_date : item.first_air_date;
    results.push({
      catalogueId,
      tmdbId: item.id,
      provider: 'TMDB',
      title: title.trim(),
      year: validatedYear(date),
      format,
      posterUrl: typeof item.poster_path === 'string' && /^\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)(?![\s\S])/.test(item.poster_path)
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
      sourceUrl: `https://www.themoviedb.org/${isMovie ? 'movie' : 'tv'}/${item.id}`,
    });
    if (results.length === 6) break;
  }
  return { results };
}

function validatedYear(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}(?![\s\S])/.test(date) || date.startsWith('0000')) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date.slice(0, 4) : null;
}

export class TmdbError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function checkTmdbConnection(token, fetchImpl = fetch) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new TmdbError(503, 'Token not configured. Start with start-watchbible.zsh.');
  }
  try {
    const response = await fetchImpl('https://api.themoviedb.org/3/configuration', {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401 || response.status === 403) throw new TmdbError(401, 'TMDB rejected the token. Restart and enter the read-access token again.');
    if (response.status === 429) throw new TmdbError(429, 'TMDB rate limit. Try again later.');
    if (!response.ok) throw new TmdbError(502, 'TMDB is unavailable. Try again later.');
    const data = await response.json();
    if (data?.images?.secure_base_url !== 'https://image.tmdb.org/t/p/' || !Array.isArray(data.images.poster_sizes)) {
      throw new TmdbError(502, 'Unexpected TMDB response.');
    }
    return { provider: 'TMDB', status: 'connected' };
  } catch (error) {
    if (error instanceof TmdbError) throw error;
    // Never expose network exceptions, request headers, or upstream response bodies.
    throw new TmdbError(502, 'Could not reach TMDB. Check your connection and retry.');
  }
}
