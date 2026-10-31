// PRIVATE verification entry point. Explicit synthetic responses only; no TMDB requests.
import { createWatchbibleServer } from './server.mjs';

const genres = [{ id: 18, name: 'Test drama' }, { id: 35, name: 'Test comedy' }, { id: 16, name: 'Test animation' }];
const title = (format, id) => ({ id, ...(format === 'movie' ? { title: `Test Film ${id}`, release_date: '2001-01-01' } : { name: `Test Series ${id}`, first_air_date: '2002-01-01' }), adult: false, overview: 'Explicit synthetic synopsis about a drummer for automated checks.', genre_ids: [18], popularity: 10, poster_path: null });
const server = createWatchbibleServer({ token: 'synthetic-test-token', fetchImpl: async target => {
  const url = new URL(target);
  const path = url.pathname;
  if (path === '/3/configuration/countries') return Response.json([{ iso_3166_1: 'NG', english_name: 'Nigeria' }, { iso_3166_1: 'US', english_name: 'United States' }, { iso_3166_1: 'GB', english_name: 'United Kingdom' }]);
  if (path === '/3/configuration') return Response.json({ images: { secure_base_url: 'https://image.tmdb.org/t/p/', poster_sizes: ['w500'] } });
  if (/^\/3\/genre\/(movie|tv)\/list$/.test(path)) return Response.json({ genres });
  if (path === '/3/search/multi') return Response.json({ results: [{ ...title('movie', 1010), media_type: 'movie' }, { ...title('series', 2010), media_type: 'tv' }] });
  const discover = path.match(/^\/3\/discover\/(movie|tv)$/);
  if (discover) {
    const format = discover[1] === 'movie' ? 'movie' : 'series';
    const page = Number(url.searchParams.get('page') || 1);
    return Response.json({ page, total_pages: 5, results: Array.from({ length: 20 }, (_, index) => title(format, (format === 'movie' ? 1000 : 2000) + (page - 1) * 20 + index)) });
  }
  const season = path.match(/^\/3\/tv\/(\d+)\/season\/(\d+)$/);
  if (season) {
    const seriesId = Number(season[1]), seasonNumber = Number(season[2]);
    const count = seasonNumber === 0 ? 1 : 8;
    return Response.json({ id: seriesId * 100 + seasonNumber, season_number: seasonNumber, name: seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`, overview: 'Explicit synthetic season overview.', poster_path: null, air_date: '2002-01-01', episodes: Array.from({ length: count }, (_, index) => ({
      id: seriesId * 10000 + seasonNumber * 100 + index + 1, show_id: seriesId, season_number: seasonNumber, episode_number: index + 1,
      name: `Synthetic episode ${index + 1}`, overview: `Synthetic episode ${index + 1} description.`, still_path: null, runtime: 45,
      air_date: seasonNumber === 2 && index === 7 ? '2999-01-01' : '2002-01-01', episode_type: index === count - 1 ? 'finale' : 'standard',
    })) });
  }
  const match = path.match(/^\/3\/(movie|tv)\/(\d+)(\/watch\/providers|\/recommendations)?$/);
  if (match) {
    const format = match[1] === 'movie' ? 'movie' : 'series';
    const id = Number(match[2]);
    if (match[3] === '/recommendations') return Response.json({ page: 1, total_pages: 1, results: Array.from({ length: 10 }, (_, index) => title(format, 3000 + index)) });
    if (match[3] === '/watch/providers') return Response.json({ id, results: Object.fromEntries(['NG', 'US', 'GB'].map(region => [region, { link: `https://www.themoviedb.org/${match[1]}/${id}/watch?locale=${region}`, flatrate: [{ provider_id: 1, provider_name: 'Test service', logo_path: null }] }])) });
    return Response.json({ ...title(format, id), genres: [genres[0]], runtime: format === 'movie' ? 90 : null, number_of_seasons: format === 'series' ? 2 : undefined, number_of_episodes: format === 'series' ? 16 : undefined,
      ...(format === 'series' ? { status: 'Returning Series', in_production: true, seasons: [0, 1, 2].map(season => ({ id: id * 100 + season, season_number: season, name: season === 0 ? 'Specials' : `Season ${season}`, episode_count: season === 0 ? 1 : 8, air_date: '2002-01-01', poster_path: null })) } : {}),
      keywords: format === 'movie' ? { keywords: [] } : { results: id === 2003 ? [{ id: 1, name: 'anime' }] : [] } });
  }
  return Response.json({ error: 'Unknown synthetic fixture' }, { status: 404 });
} });
const port = Number(process.env.PORT || 8767);
server.listen(port, '127.0.0.1', () => console.log(`Synthetic fixtures only: http://127.0.0.1:${port}`));
