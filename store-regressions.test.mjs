import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppStore } from './app-state.mjs';

test('storage denial after a commit exports the latest known snapshot, not an older loaded copy', () => {
  let value = JSON.stringify(createAppStore({ getItem: () => null, setItem() {} }).getState());
  let denied = false;
  const store = createAppStore({ getItem() { if (denied) throw Error('Synthetic denied storage'); return value; }, setItem(_key, text) { value = text; } });
  store.transact(draft => { draft.preferences.region = 'US'; });
  const committed = JSON.parse(value);
  denied = true;
  assert.equal(store.refresh(), true);
  assert.ok(store.loadError);
  assert.deepEqual(JSON.parse(store.exportJSON()), committed);
});
