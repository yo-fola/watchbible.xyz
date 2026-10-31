// Server-only: never import into browser-delivered JavaScript.
import { TmdbError } from './tmdb.mjs';

async function request(path, params, token, fetchImpl, titleRequest = false) {
  if (typeof token !== 'string' || !token.trim()) throw new TmdbError(503, 'TMDB credential is not configured.');
  const url = new URL(`https://api.themoviedb.org/3/${path}`);
  url.search = new URLSearchParams(params);
  let response;
  try {
    response = await fetchImpl(url.href, {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
  } catch { throw new TmdbError(502, 'Could not reach TMDB.'); }
  if (!response || !Number.isInteger(response.status) || typeof response.ok !== 'boolean') throw new TmdbError(502, 'Unexpected TMDB response.');
  if (response.status === 401 || response.status === 403) throw new TmdbError(401, 'TMDB rejected the credential.');
  if (response.status === 429) throw new TmdbError(429, 'TMDB rate limit. Try again later.');
  if (response.status === 404 && titleRequest) throw new TmdbError(404, 'Title not found.');
  if (!response.ok) throw new TmdbError(502, 'TMDB is unavailable.');
  try { return await response.json(); }
  catch { throw new TmdbError(502, 'Unexpected TMDB response.'); }
}

const positiveId = value => Number.isSafeInteger(value) && value > 0;
const integerOrNull = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const imageUrl = path => typeof path === 'string' && /^\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)(?![\s\S])/.test(path) ? `https://image.tmdb.org/t/p/w500${path}` : null;
function validatedYear(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}(?![\s\S])/.test(date) || date.startsWith('0000')) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date.slice(0, 4) : null;
}
function cleanGenres(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter(item => {
    if (!positiveId(item?.id) || typeof item.name !== 'string' || !item.name.trim() || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).map(item => ({ id: item.id, name: item.name.trim() }));
}

function normalizeWatch(data, type, id, region) {
  const result = { region, status: 'unlisted', link: null, offers: [], attribution: 'JustWatch' };
  if (!isRecord(data) || data.id !== id || !isRecord(data.results)) throw new TmdbError(502, 'Unexpected TMDB response.');
  if (!Object.hasOwn(data.results, region)) return result;
  const local = data.results[region];
  if (!isRecord(local) || !validWatchLink(local.link, type, id, region)) throw new TmdbError(502, 'Unexpected TMDB response.');
  result.link = local.link;
  const seen = new Set();
  for (const [bucket, kind] of [['flatrate', 'stream'], ['rent', 'rent'], ['buy', 'buy'], ['free', 'free'], ['ads', 'ads']]) {
    if (Object.hasOwn(local, bucket) && !Array.isArray(local[bucket])) throw new TmdbError(502, 'Unexpected TMDB response.');
    for (const item of local[bucket] ?? []) {
      if (!positiveId(item?.provider_id) || typeof item.provider_name !== 'string' || !item.provider_name.trim()) continue;
      const key = `${kind}:${item.provider_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.offers.push({ providerId: item.provider_id, name: item.provider_name.trim(), logoUrl: imageUrl(item.logo_path), kind });
    }
  }
  result.status = result.offers.length ? 'ok' : 'unlisted';
  return result;
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function validWatchLink(link, type, id, region) {
  if (typeof link !== 'string' || /[\s\\]/.test(link)) return false;
  try {
    const url = new URL(link);
    return url.origin === 'https://www.themoviedb.org' && !url.username && !url.password && !url.hash
      && new RegExp(`^/${type}/${id}(?:-[^/]+)?/watch$`).test(url.pathname)
      && url.searchParams.getAll('locale').length === 1 && url.searchParams.get('locale') === region;
  } catch { return false; }
}

function candidatePage(data, format, page) {
  if (!isRecord(data) || !Array.isArray(data.results) || data.page !== page || integerOrNull(data.total_pages) === null) throw new TmdbError(502, 'Unexpected TMDB response.');
  const type = format === 'movie' ? 'movie' : 'tv';
  const results = [];
  const seen = new Set();
  for (const item of data.results) {
    const title = format === 'movie' ? item?.title : item?.name;
    if (!isRecord(item) || !positiveId(item.id) || (item.media_type !== undefined && item.media_type !== type) || item.adult === true || typeof title !== 'string' || !title.trim() || seen.has(item.id)) continue;
    seen.add(item.id);
    results.push({
      catalogueId: `tmdb:${format}:${item.id}`, tmdbId: item.id, provider: 'TMDB', title: title.trim(),
      year: validatedYear(format === 'movie' ? item.release_date : item.first_air_date), format,
      posterUrl: imageUrl(item.poster_path), sourceUrl: `https://www.themoviedb.org/${type}/${item.id}`,
      overview: typeof item.overview === 'string' ? item.overview : '',
      genreIds: [...new Set((Array.isArray(item.genre_ids) ? item.genre_ids : []).filter(positiveId))],
      popularity: typeof item.popularity === 'number' && Number.isFinite(item.popularity) && item.popularity >= 0 ? item.popularity : null,
    });
    if (results.length === 20) break;
  }
  return { results, page: data.page, totalPages: Math.min(data.total_pages, 500) };
}

function validatePageInput(input) {
  if (!isRecord(input) || !['movie', 'series'].includes(input.format) || (input.page !== undefined && (!positiveId(input.page) || input.page > 500))) throw new TmdbError(400, 'Invalid catalogue request.');
}

export async function getDiscoverTitles(input, token, fetchImpl = fetch) {
  validatePageInput(input);
  const { format, genreIds = [], page = 1 } = input;
  if (!Array.isArray(genreIds) || genreIds.length > 20 || !Array.from(genreIds).every(positiveId)) throw new TmdbError(400, 'Invalid genre selection.');
  const type = format === 'movie' ? 'movie' : 'tv';
  const params = { language: 'en-US', include_adult: 'false', page: String(page) };
  // Selected genres are independent interests: TMDB's pipe means ANY (OR), not comma's ALL (AND).
  if (genreIds.length) params.with_genres = genreIds.join('|');
  return candidatePage(await request(`discover/${type}`, params, token, fetchImpl), format, page);
}

export async function getRelatedTitles(input, token, fetchImpl = fetch) {
  validateTitleInput(input);
  validatePageInput(input);
  const { format, id, page = 1 } = input;
  const type = format === 'movie' ? 'movie' : 'tv';
  const data = await request(`${type}/${id}/recommendations`, { language: 'en-US', page: String(page) }, token, fetchImpl, true);
  return candidatePage(data, format, page);
}

export async function getRegions(token, fetchImpl = fetch) {
  const data = await request('configuration/countries', { language: 'en-US' }, token, fetchImpl);
  if (!Array.isArray(data)) throw new TmdbError(502, 'Unexpected TMDB response.');
  const seen = new Set();
  const regions = data.filter(item => {
    if (!isRecord(item) || typeof item.iso_3166_1 !== 'string' || !/^[A-Z]{2}(?![\s\S])/.test(item.iso_3166_1) || typeof item.english_name !== 'string' || !item.english_name.trim() || seen.has(item.iso_3166_1)) return false;
    seen.add(item.iso_3166_1);
    return true;
  }).map(item => ({ code: item.iso_3166_1, name: item.english_name.trim() }));
  return { regions };
}

export async function getGenreLists(token, fetchImpl = fetch) {
  const lists = await Promise.all(['movie', 'tv'].map(async type => {
    const data = await request(`genre/${type}/list`, { language: 'en-US' }, token, fetchImpl);
    if (!isRecord(data) || !Array.isArray(data.genres)) throw new TmdbError(502, 'Unexpected TMDB response.');
    return cleanGenres(data.genres);
  }));
  return { movie: lists[0], series: lists[1] };
}

function validateTitleInput(input) {
  if (!isRecord(input) || !['movie', 'series'].includes(input.format) || !positiveId(input.id)) throw new TmdbError(400, 'Invalid title request.');
}

const airDate = value => validatedYear(value) ? value : null;
// TMDB's season endpoint is keyed by series ID and season NUMBER, not season ID.
export async function getSeasonDetails(input, token, fetchImpl = fetch) {
  if (!isRecord(input) || !positiveId(input.seriesId) || integerOrNull(input.seasonNumber) === null) throw new TmdbError(400, 'Invalid season request.');
  const { seriesId, seasonNumber } = input;
  const show = await request(`tv/${seriesId}`, { language: 'en-US' }, token, fetchImpl, true);
  if (!isRecord(show) || show.id !== seriesId || (show.media_type !== undefined && show.media_type !== 'tv') || show.adult === true || typeof show.name !== 'string' || !show.name.trim()) throw new TmdbError(502, 'Unexpected TMDB response.');
  if (!Array.isArray(show.seasons)) throw new TmdbError(502, 'Unexpected TMDB response.');
  const roster = seasonRoster(show);
  const listed = roster.find(row => row.seasonNumber === seasonNumber);
  if (!listed) throw new TmdbError(404, 'Season not found.');
  const data = await request(`tv/${seriesId}/season/${seasonNumber}`, { language: 'en-US' }, token, fetchImpl, true);
  if (!isRecord(data) || (data.show_id !== undefined && data.show_id !== seriesId) || (data.media_type !== undefined && data.media_type !== 'tv')) throw new TmdbError(502, 'Unexpected TMDB response.');
  if (!isRecord(data) || !positiveId(data.id) || data.id !== show.seasons.find(row => row.season_number === seasonNumber).id || data.season_number !== seasonNumber || typeof data.name !== 'string' || !data.name.trim() || !Array.isArray(data.episodes) || data.episodes.length !== listed.episodeCount) throw new TmdbError(502, 'Unexpected TMDB response.');
  const ids = new Set();
  const numbers = new Set();
  for (const row of data.episodes) {
    if (!isRecord(row) || !positiveId(row.id) || !positiveId(row.episode_number) || row.episode_number > listed.episodeCount || row.season_number !== seasonNumber || (row.show_id !== undefined && row.show_id !== seriesId) || (row.media_type !== undefined && row.media_type !== 'tv') || typeof row.name !== 'string' || !row.name.trim() || ids.has(row.id) || numbers.has(row.episode_number)) throw new TmdbError(502, 'Unexpected TMDB response.');
    ids.add(row.id);
    numbers.add(row.episode_number);
  }
  return {
    catalogueId: `tmdb:series:${seriesId}`, seriesId, seasonId: data.id, seasonNumber,
    name: data.name.trim(), overview: typeof data.overview === 'string' ? data.overview : '',
    posterUrl: imageUrl(data.poster_path), airDate: airDate(data.air_date),
    episodes: data.episodes.map(row => ({ episodeId: row.id, episodeNumber: row.episode_number, seasonNumber: row.season_number, name: row.name.trim(), overview: typeof row.overview === 'string' ? row.overview : '', stillUrl: imageUrl(row.still_path), airDate: airDate(row.air_date), runtimeMinutes: integerOrNull(row.runtime), episodeType: ['standard', 'mid_season', 'finale'].includes(row.episode_type) ? row.episode_type : null })),
  };
}

function seasonRoster(data) {
  // Older/minimal title responses may omit seasons; an explicit malformed roster is never complete.
  if (data.seasons === undefined) return [];
  if (!Array.isArray(data.seasons)) throw new TmdbError(502, 'Unexpected TMDB response.');
  const numbers = new Set();
  const ids = new Set();
  return data.seasons.map(row => {
    if (!isRecord(row) || !positiveId(row.id) || integerOrNull(row.season_number) === null || integerOrNull(row.episode_count) === null || typeof row.name !== 'string' || !row.name.trim() || numbers.has(row.season_number) || ids.has(row.id)) throw new TmdbError(502, 'Unexpected TMDB response.');
    numbers.add(row.season_number);
    ids.add(row.id);
    return { seasonNumber: row.season_number, name: row.name.trim(), episodeCount: row.episode_count, airDate: airDate(row.air_date), posterUrl: imageUrl(row.poster_path) };
  });
}

export async function getTitleDetails(input, token, fetchImpl = fetch) {
  validateTitleInput(input);
  const { format, id, region = 'NG' } = input;
  if (typeof region !== 'string' || !/^[A-Z]{2}(?![\s\S])/.test(region)) throw new TmdbError(400, 'Invalid region.');
  const type = format === 'movie' ? 'movie' : 'tv';
  const data = await request(`${type}/${id}`, { language: 'en-US', append_to_response: 'keywords' }, token, fetchImpl, true);
  const title = format === 'movie' ? data?.title : data?.name;
  if (!isRecord(data) || data.id !== id || (data.media_type !== undefined && data.media_type !== type) || data.adult === true || typeof title !== 'string' || !title.trim()) throw new TmdbError(502, 'Unexpected TMDB response.');
  let watch;
  try {
    watch = normalizeWatch(await request(`${type}/${id}/watch/providers`, {}, token, fetchImpl), type, id, region);
  } catch {
    watch = { region, status: 'error', link: null, offers: [], attribution: 'JustWatch' };
  }
  return {
    catalogueId: `tmdb:${format}:${id}`, tmdbId: id, provider: 'TMDB',
    title: (format === 'movie' ? data.title : data.name).trim(), format,
    year: validatedYear(format === 'movie' ? data.release_date : data.first_air_date),
    posterUrl: imageUrl(data.poster_path),
    backdropUrl: imageUrl(data.backdrop_path),
    sourceUrl: `https://www.themoviedb.org/${type}/${id}`,
    overview: typeof data.overview === 'string' ? data.overview : '', genres: cleanGenres(data.genres),
    anime: (Array.isArray(data.keywords?.keywords) ? data.keywords.keywords : Array.isArray(data.keywords?.results) ? data.keywords.results : []).some(item => item?.name === 'anime') ? true : null,
    runtimeMinutes: integerOrNull(format === 'movie' ? data.runtime : (Array.isArray(data.episode_run_time) ? data.episode_run_time : []).find(value => integerOrNull(value) !== null)),
    seasons: format === 'series' ? integerOrNull(data.number_of_seasons) : null,
    episodes: format === 'series' ? integerOrNull(data.number_of_episodes) : null,
    ...(format === 'series' ? {
      seasonList: seasonRoster(data),
      seriesStatus: typeof data.status === 'string' && data.status.trim() ? data.status.trim() : null,
      inProduction: typeof data.in_production === 'boolean' ? data.in_production : null,
    } : {}),
    imdbId: typeof data.imdb_id === 'string' && /^tt\d{7,10}(?![\s\S])/.test(data.imdb_id) ? data.imdb_id : null,
    fetchedAt: new Date().toISOString(),
    watch,
  };
}
