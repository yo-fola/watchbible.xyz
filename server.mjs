import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkTmdbConnection, TmdbError } from './tmdb.mjs';

// Explicit public files only. No directory listing, secret files, backups or server code.
const publicFiles = new Map([
  ['/', ['index.html', 'text/html']],
  ...['index.html', 'library.html', 'onboarding.html', 'import.html', 'setup.html'].map(name => [`/${name}`, [name, 'text/html']]),
  ...['profile.html', 'achievements.html', 'collections.html', 'series.html'].map(name => [`/${name}`, [name, 'text/html']]),
  ['/title.html', ['title.html', 'text/html']],
  ['/title-page.css', ['title-page.css', 'text/css']],
  ...['title-page.mjs', 'title-page-checks.mjs', 'cover-navigation-checks.mjs', 'performance-browser-checks.mjs'].map(name => [`/${name}`, [name, 'text/javascript']]),
  ['/series.css', ['series.css', 'text/css']],
  ...['series.mjs', 'episode-progress.mjs', 'tv-browser-checks.mjs'].map(name => [`/${name}`, [name, 'text/javascript']]),
  ['/home-pagination.css', ['home-pagination.css', 'text/css']],
  ...['watch-picker.mjs', 'watch-picker-checks.mjs'].map(name => [`/${name}`, [name, 'text/javascript']]),
  ...['pagination-model.mjs', 'home-pagination-checks.mjs'].map(name => [`/${name}`, [name, 'text/javascript']]),
  ['/gamification.css', ['gamification.css', 'text/css']],
  ...['profile.mjs', 'achievements.mjs', 'collections.mjs', 'user-menu.mjs', 'gamification-model.mjs', 'collection-definitions.mjs', 'gamification-ui-checks.mjs', 'collection-ui-checks.mjs'].map(name => [`/${name}`, [name, 'text/javascript']]),
  ['/theme.css', ['theme.css', 'text/css']],
  ['/title-panel.css', ['title-panel.css', 'text/css']],
  ...['library.mjs', 'library-model.mjs', 'title-search.mjs', 'importer.mjs', 'review.mjs', 'poster.mjs', 'settings.mjs', 'browser-checks.mjs', 'gui-checks.mjs', 'minimal-checks.mjs', 'search-browser-checks.mjs', 'app-state.mjs', 'app.mjs', 'library-actions.mjs', 'recommendation-model.mjs', 'catalogue-browser.mjs', 'home.mjs', 'onboarding.mjs', 'film-card.mjs', 'detail-dialog.mjs', 'title-panel.mjs', 'title-panel-checks.mjs', 'discovery-browser-checks.mjs', 'discovery-flow-checks.mjs'].map(name => [`/${name}`, [name, 'text/javascript']]),
  ['/assets/tmdb.svg', ['assets/tmdb.svg', 'image/svg+xml']],
  ['/examples/sample-import.txt', ['examples/sample-import.txt', 'text/plain']],
  ['/examples/test-cover.svg', ['examples/test-cover.svg', 'image/svg+xml']],
]);

export function createWatchbibleServer({ token = '', fetchImpl = fetch } = {}) {
  let state = token ? 'untested' : 'missing';
  let checkedAt = null;
  let busy = false;
  let searchWindow = { started: Date.now(), count: 0 };
  let catalogueWindow = { started: Date.now(), count: 0 };
  const catalogueCache = new Map();
  const server = createServer(async (request, response) => {
    const send = (status, data, type = 'application/json') => {
      response.writeHead(status, {
        'Content-Type': `${type}; charset=utf-8`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' https://image.tmdb.org; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'; frame-ancestors 'none'",
      });
      response.end(request.method === 'HEAD' ? undefined : type === 'application/json' ? JSON.stringify(data) : data);
    };
    try {
      const port = server.address().port;
      const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      const origins = new Set([...hosts].map(host => `http://${host}`));
      if (!hosts.has(request.headers.host) || (request.headers.origin && !origins.has(request.headers.origin)) || request.headers['sec-fetch-site'] === 'cross-site') {
        return send(403, { error: 'Local requests only.' });
      }
      const url = new URL(request.url, 'http://127.0.0.1');
      const pathname = url.pathname;
      if (['/api/title', '/api/season', '/api/genres', '/api/regions', '/api/discover', '/api/recommendations'].includes(pathname)) {
        if (request.method !== 'GET') return send(405, { error: 'Method not allowed.' });
        const allowed = pathname === '/api/season' ? ['seriesId', 'season'] : ['/api/genres', '/api/regions'].includes(pathname) ? [] : pathname === '/api/title' ? ['format', 'id', 'region'] : pathname === '/api/discover' ? ['format', 'genres', 'page'] : ['format', 'id', 'page'];
        const keys = [...url.searchParams.keys()];
        if (keys.some(key => !allowed.includes(key)) || new Set(keys).size !== keys.length || request.headers['transfer-encoding'] || Number(request.headers['content-length'] || 0) > 0) {
          request.resume();
          return send(400, { error: 'Unexpected request parameters or body.' });
        }
        const positive = (value, name) => {
          if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new TmdbError(400, `Invalid ${name}.`);
          return Number(value);
        };
        const options = {};
        if (pathname === '/api/season') {
          options.seriesId = positive(url.searchParams.get('seriesId'), 'series ID');
          const value = url.searchParams.get('season');
          if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?![\s\S])/.test(value) || !Number.isSafeInteger(Number(value))) throw new TmdbError(400, 'Invalid season number.');
          options.seasonNumber = Number(value);
        }
        if (!['/api/genres', '/api/regions', '/api/season'].includes(pathname)) {
          options.format = url.searchParams.get('format');
          if (!['movie', 'series'].includes(options.format)) throw new TmdbError(400, 'Choose Movie or Series.');
        }
        if (pathname === '/api/title' || pathname === '/api/recommendations') options.id = positive(url.searchParams.get('id'), 'title ID');
        if (pathname === '/api/title') {
          options.region = url.searchParams.get('region') ?? 'NG';
          if (!/^[A-Z]{2}$/.test(options.region)) throw new TmdbError(400, 'Invalid region.');
        }
        if (pathname === '/api/discover' || pathname === '/api/recommendations') {
          options.page = url.searchParams.has('page') ? positive(url.searchParams.get('page'), 'page') : 1;
          if (options.page > 500) throw new TmdbError(400, 'Invalid page.');
        }
        if (pathname === '/api/discover') {
          const genres = url.searchParams.get('genres') || '';
          options.genreIds = genres ? genres.split(',').map(id => positive(id, 'genre')) : [];
          if (options.genreIds.length > 20) throw new TmdbError(400, 'Too many genres.');
        }
        if (!token) throw new TmdbError(503, 'TMDB token not configured. Start the launcher.');
        const cacheKey = `${pathname}:${JSON.stringify(options)}`;
        const cached = catalogueCache.get(cacheKey);
        if (cached && Date.now() - cached.at < 300000) return send(200, cached.result);
        if (Date.now() - catalogueWindow.started > 60000) catalogueWindow = { started: Date.now(), count: 0 };
        if (++catalogueWindow.count > 80) throw new TmdbError(429, 'Too many catalogue requests. Wait a minute and retry.');
        try {
          const service = await import('./catalogue-service.mjs');
          const result = pathname === '/api/genres' ? await service.getGenreLists(token, fetchImpl)
            : pathname === '/api/regions' ? await service.getRegions(token, fetchImpl)
            : pathname === '/api/title' ? await service.getTitleDetails(options, token, fetchImpl)
            : pathname === '/api/season' ? await service.getSeasonDetails(options, token, fetchImpl)
            : pathname === '/api/discover' ? await service.getDiscoverTitles(options, token, fetchImpl)
            : await service.getRelatedTitles(options, token, fetchImpl);
          // Failed availability must remain immediately retryable.
          if (result.watch?.status !== 'error') {
            if (catalogueCache.size >= 200) catalogueCache.delete(catalogueCache.keys().next().value);
            catalogueCache.set(cacheKey, { at: Date.now(), result });
          }
          state = 'connected';
          checkedAt = new Date().toISOString();
          return send(200, result);
        } catch (error) {
          if (error instanceof TmdbError && error.status === 401) { state = 'failed'; checkedAt = null; }
          throw error;
        }
      }
      if (pathname === '/api/search') {
        if (request.method !== 'GET') return send(405, { error: 'Method not allowed.' });
        const keys = [...url.searchParams.keys()];
        if (keys.length !== 1 || keys[0] !== 'q' || request.headers['transfer-encoding'] || Number(request.headers['content-length'] || 0) > 0) {
          request.resume();
          return send(400, { error: 'Unexpected request parameters or body.' });
        }
        if (Date.now() - searchWindow.started > 60000) searchWindow = { started: Date.now(), count: 0 };
        if (++searchWindow.count > 60) return send(429, { error: 'Too many searches. Wait a minute and retry.' });
        try {
          const { searchTmdb } = await import('./tmdb.mjs');
          const result = await searchTmdb(url.searchParams.get('q'), token, fetchImpl);
          state = 'connected';
          checkedAt = new Date().toISOString();
          return send(200, result);
        } catch (error) {
          if (error instanceof TmdbError && (error.status === 401 || error.status === 503)) {
            state = token ? 'failed' : 'missing';
            checkedAt = null;
          }
          throw error;
        }
      }
      if (pathname === '/api/tmdb/test' && request.method === 'POST') {
        if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] || 0) > 0) {
          request.resume();
          return send(400, { error: 'No request body expected. Enter credentials only in Terminal.' });
        }
        if (busy) return send(429, { error: 'A connection test is already running.' });
        busy = true;
        try {
          const result = await checkTmdbConnection(token, fetchImpl);
          state = result.status;
          checkedAt = new Date().toISOString();
          return send(200, { ...result, checkedAt });
        } catch (error) {
          state = token ? 'failed' : 'missing';
          checkedAt = null;
          throw error;
        } finally {
          busy = false;
        }
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, { error: 'Method not allowed.' });
      if (pathname === '/api/status') return send(200, { provider: 'TMDB', configured: Boolean(token), state, checkedAt });
      const file = publicFiles.get(pathname);
      if (!file) return send(404, { error: 'Not found.' });
      return send(200, await readFile(new URL(file[0], import.meta.url)), file[1]);
    } catch (error) {
      if (error instanceof TmdbError) return send(error.status, { error: error.message });
      // Never log or return raw exceptions, environment variables or request headers.
      return send(500, { error: 'Local server error.' });
    }
  });
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 8766);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error('PORT must be an integer from 1024 to 65535.');
    process.exitCode = 1;
  } else {
    try {
      const { loadServerToken } = await import('./local-credentials.mjs');
      const { token } = await loadServerToken();
      const server = createWatchbibleServer({ token });
      server.on('error', () => { console.error('Cannot start watchbible. The local port may already be in use.'); process.exitCode = 1; });
      server.listen(port, '127.0.0.1', () => {
        console.log(`watchbible: http://127.0.0.1:${port}/setup.html`);
        console.log('Use Settings → Test connection. Control-C stops the server.');
      });
    } catch {
      console.error('Cannot load the local TMDB credential. Check private file permissions or run /bin/zsh setup-watchbible-token.zsh. No credential displayed.');
      process.exitCode = 1;
    }
  }
}
