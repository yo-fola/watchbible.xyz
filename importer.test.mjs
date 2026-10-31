import test from 'node:test';
import assert from 'node:assert/strict';

// This test describes the import behaviour before we implement it.
test('turns checked, unchecked, and plain titles into review entries', async () => {
  const { parseTitleList } = await import('./importer.mjs');
  const text = '- [x] whiplash\r\n- [ ] fight club\r\n\r\n  28 years later  ';

  assert.deepEqual(parseTitleList(text), [
    { originalLine: '- [x] whiplash', title: 'whiplash', status: 'watched' },
    { originalLine: '- [ ] fight club', title: 'fight club', status: 'plan_to_watch' },
    { originalLine: '  28 years later  ', title: '28 years later', status: null },
  ]);
});
