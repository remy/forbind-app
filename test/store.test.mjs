import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, initialState } from '../js/lib/store.js';

/** A localStorage stand-in, so the persistence rule can actually be tested. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    get size() { return map.size; },
    dump: () => Object.fromEntries(map),
  };
}

test('subscribers hear about a change, and only about a change', () => {
  const store = new Store();
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  store.set({ density: 'roomy' });
  assert.equal(calls, 1);
  store.set({ density: 'roomy' });
  assert.equal(calls, 1, 'a no-op set notified anyway');
  store.set({ density: 'dense' });
  assert.equal(calls, 2);
});

test('unsubscribing stops the calls', () => {
  const store = new Store();
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  store.set({ theme: 'dark' });
  off();
  store.set({ theme: 'light' });
  assert.equal(calls, 1);
});

test('nested objects are replaced, not mutated, so identity checks can be trusted', () => {
  const store = new Store();
  const before = store.state.filters;
  store.patch('filters', { query: 'book' });
  assert.notEqual(store.state.filters, before);
  assert.equal(before.query, '');
  assert.equal(store.state.filters.query, 'book');
  // The keys that were not patched survive.
  assert.deepEqual(store.state.filters.tags, []);
});

test('a subscriber sees both the new state and the old one', () => {
  const store = new Store();
  let seen = null;
  store.subscribe((state, prev) => { seen = [state.density, prev.density]; });
  store.set({ density: 'roomy' });
  assert.deepEqual(seen, ['roomy', 'dense']);
});

test('ONLY the display preferences are persisted — never the credential', () => {
  const storage = fakeStorage();
  globalThis.localStorage = storage;
  try {
    const store = new Store();
    store.set({ theme: 'dark', density: 'roomy' });
    store.patch('auth', { credential: 'a-real-secret-token', schemeId: 'bearerAuth' });
    store.set({ schema: { sourceName: 'private-api.yaml', operations: [] } });
    store.patch('filters', { query: 'internal-only' });

    const written = storage.dump()['allyway:prefs'];
    assert.deepEqual(JSON.parse(written), { theme: 'dark', density: 'roomy', showHints: true });
    const everything = JSON.stringify(storage.dump());
    assert.ok(!everything.includes('a-real-secret-token'), 'the credential reached storage');
    assert.ok(!everything.includes('private-api.yaml'), 'the schema name reached storage');
    assert.ok(!everything.includes('internal-only'), 'a filter reached storage');
    assert.equal(storage.size, 1, 'more than the preferences key was written');
  } finally {
    delete globalThis.localStorage;
  }
});

test('a stored preference is read back, and anything else in there is ignored', () => {
  const storage = fakeStorage();
  storage.setItem('allyway:prefs', JSON.stringify({ theme: 'dark', density: 'roomy', credential: 'injected', schema: {} }));
  globalThis.localStorage = storage;
  try {
    const store = new Store();
    assert.equal(store.state.theme, 'dark');
    assert.equal(store.state.density, 'roomy');
    assert.equal(store.state.auth.credential, '');
    assert.equal(store.state.schema, null);
    assert.ok(!('credential' in store.state));
  } finally {
    delete globalThis.localStorage;
  }
});

test('storage that throws does not take the app down with it', () => {
  globalThis.localStorage = {
    getItem() { throw new Error('storage disabled'); },
    setItem() { throw new Error('storage disabled'); },
  };
  try {
    const store = new Store();
    assert.equal(store.state.theme, 'auto');
    store.set({ theme: 'dark' });
    assert.equal(store.state.theme, 'dark');
  } finally {
    delete globalThis.localStorage;
  }
});

test('corrupt stored preferences fall back to the defaults', () => {
  const storage = fakeStorage();
  storage.setItem('allyway:prefs', 'not json at all');
  globalThis.localStorage = storage;
  try {
    assert.equal(new Store().state.theme, 'auto');
  } finally {
    delete globalThis.localStorage;
  }
});

test('the initial state carries no credential and no schema', () => {
  const state = initialState();
  assert.equal(state.schema, null);
  assert.equal(state.auth.credential, '');
  assert.equal(state.auth.verifyState, 'idle');
  assert.equal(state.browsing, false);
});
