import test from 'node:test';
import assert from 'node:assert/strict';

// Synthetic fixtures only. These tests do not verify the user's real token.
test('connection check uses bearer authentication without returning the token', async () => {
  const { checkTmdbConnection } = await import('./tmdb.mjs');
  const result = await checkTmdbConnection('synthetic-test-token', async (url, options) => {
    assert.equal(url, 'https://api.themoviedb.org/3/configuration');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-token');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    return Response.json({ images: { secure_base_url: 'https://image.tmdb.org/t/p/', poster_sizes: ['w500'] } });
  });
  assert.deepEqual(result, { provider: 'TMDB', status: 'connected' });
  assert.ok(!JSON.stringify(result).includes('synthetic-test-token'));
});

test('missing credentials and provider failures produce safe, actionable errors', async () => {
  const { checkTmdbConnection } = await import('./tmdb.mjs');
  await assert.rejects(checkTmdbConnection('', () => { throw new Error('Must not request without a token'); }), error => error.status === 503);
  for (const [providerStatus, expectedStatus] of [[401, 401], [403, 401], [429, 429], [500, 502]]) {
    await assert.rejects(checkTmdbConnection('synthetic-test-token', async () => new Response('private upstream details', { status: providerStatus })), error => error.status === expectedStatus && !error.message.includes('private upstream details'));
  }
  await assert.rejects(checkTmdbConnection('synthetic-test-token', async () => { throw new Error('synthetic-test-token in a network failure'); }), error => error.status === 502 && !error.message.includes('synthetic-test-token'));
  await assert.rejects(checkTmdbConnection('synthetic-test-token', async () => Response.json({ unexpected: true })), error => error.status === 502);
});
