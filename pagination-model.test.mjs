import test from 'node:test';
import assert from 'node:assert/strict';
import { pageBounds, pageWindow } from './pagination-model.mjs';
import { readFile } from 'node:fs/promises';

test('home exposes accessible pagination and Refresh instead of More picks', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  for (const id of ['home-pagination', 'home-prev', 'home-next', 'home-page-numbers', 'home-refresh', 'home-heading']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(!html.includes('home-more'));
});

test('bounds clamp invalid targets and respect the provider cap', () => {
  assert.deepEqual(pageBounds(9, 5), { page: 5, total: 5, previous: 4, next: null });
  assert.deepEqual(pageBounds(-2, 5), { page: 1, total: 5, previous: null, next: 2 });
  assert.equal(pageBounds(999, 900).total, 500);
  assert.equal(pageBounds(NaN, 5).page, 1);
});

test('window shows five nearby numbers with honest endpoints and ellipses', () => {
  assert.deepEqual(pageWindow(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageWindow(1, 20), [1, 2, 3, 4, 5, 'ellipsis', 20]);
  assert.deepEqual(pageWindow(10, 20), [1, 'ellipsis', 8, 9, 10, 11, 12, 'ellipsis', 20]);
  assert.deepEqual(pageWindow(20, 20), [1, 'ellipsis', 16, 17, 18, 19, 20]);
});

test('unknown totals never invent page numbers or permit a jump', () => {
  assert.deepEqual(pageBounds(1, null), { page: 1, total: null, previous: null, next: null });
  assert.deepEqual(pageWindow(1, null), [1]);
});
