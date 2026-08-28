import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readPrefs, writePrefs,
  readSchema, writeSchema, clearSchema,
  readAuth, writeAuth, clearAuth, hasRememberedAuth,
  readBaseUrl, writeBaseUrl, clearBaseUrl,
} from '../js/lib/persist.js';

/** A storage stand-in with an optional quota, so the failure path is testable. */
function fakeStorage({ quota = Infinity } = {}) {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      if (String(v).length > quota) {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      }
      map.set(k, String(v));
    },
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
    get keys() { return [...map.keys()]; },
  };
}

function withStorage(local, session, fn) {
  globalThis.localStorage = local;
  globalThis.sessionStorage = session;
  try {
    return fn();
  } finally {
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
  }
}

const SECRET = 'a-real-secret-token-4f2a';

/* --- preferences --------------------------------------------------------- */

test('preferences round-trip, and nothing else is taken from that key', () => {
  const local = fakeStorage();
  withStorage(local, fakeStorage(), () => {
    writePrefs({
      theme: 'dark', density: 'roomy', showHints: false, railCollapsed: true, listCollapsed: false,
      credential: SECRET, schema: {},
    });
    const kept = { theme: 'dark', density: 'roomy', showHints: false, railCollapsed: true, listCollapsed: false };
    assert.deepEqual(JSON.parse(local.dump()['allyway:prefs']), kept);
    assert.deepEqual(readPrefs(), kept);
    assert.ok(!JSON.stringify(local.dump()).includes(SECRET));
  });
});

/* --- the schema ---------------------------------------------------------- */

test('a schema loaded from a file keeps its text, so a reload can restore it', () => {
  const local = fakeStorage();
  withStorage(local, fakeStorage(), () => {
    writeSchema({ name: 'oak.json', url: null, text: '{"openapi":"3.1.0"}' });
    const stored = readSchema();
    assert.equal(stored.name, 'oak.json');
    assert.equal(stored.url, null);
    assert.equal(stored.text, '{"openapi":"3.1.0"}');
  });
});

test('a schema loaded from a URL keeps the URL, not a copy of the document', () => {
  const local = fakeStorage();
  withStorage(local, fakeStorage(), () => {
    writeSchema({ name: 'openapi.yaml', url: 'https://api.example.com/openapi.yaml', text: 'x'.repeat(50_000) });
    const stored = readSchema();
    assert.equal(stored.url, 'https://api.example.com/openapi.yaml');
    assert.equal(stored.text, null, 'a fetchable URL should not also spend the quota on the body');
    assert.ok(local.dump()['allyway:schema'].length < 500);
  });
});

test('a file too large to store is not stored at all, rather than half-stored', () => {
  const local = fakeStorage();
  withStorage(local, fakeStorage(), () => {
    assert.equal(writeSchema({ name: 'huge.json', url: null, text: 'x'.repeat(4 * 1024 * 1024) }), null);
    assert.equal(readSchema(), null);
  });
});

test('a storage quota refusal is survivable', () => {
  const local = fakeStorage({ quota: 100 });
  withStorage(local, fakeStorage(), () => {
    assert.equal(writeSchema({ name: 'medium.json', url: null, text: 'x'.repeat(5000) }), null);
    assert.equal(readSchema(), null);
  });
});

test('clearing the schema clears it', () => {
  const local = fakeStorage();
  withStorage(local, fakeStorage(), () => {
    writeSchema({ name: 'a.json', url: null, text: '{}' });
    clearSchema();
    assert.equal(readSchema(), null);
  });
});

test('a half-written record is treated as no record', () => {
  const local = fakeStorage();
  local.setItem('allyway:schema', JSON.stringify({ name: 'a.json' }));
  withStorage(local, fakeStorage(), () => {
    assert.equal(readSchema(), null);
  });
});

/* --- the credential ------------------------------------------------------ */

test('a credential goes to sessionStorage by default — this tab, and no further', () => {
  const local = fakeStorage();
  const session = fakeStorage();
  withStorage(local, session, () => {
    writeAuth({ credential: SECRET, schemeId: 'bearerAuth', remember: false, schemaKey: 'file:oak.json' });
    assert.ok(JSON.stringify(session.dump()).includes(SECRET));
    assert.ok(!JSON.stringify(local.dump()).includes(SECRET), 'the credential reached disk without being asked to');
    assert.equal(hasRememberedAuth(), false);
    assert.equal(readAuth('file:oak.json').credential, SECRET);
  });
});

test('"remember on this device" moves it to localStorage and takes the other copy with it', () => {
  const local = fakeStorage();
  const session = fakeStorage();
  withStorage(local, session, () => {
    writeAuth({ credential: SECRET, schemeId: 'bearerAuth', remember: false, schemaKey: 'k' });
    writeAuth({ credential: SECRET, schemeId: 'bearerAuth', remember: true, schemaKey: 'k' });
    assert.ok(JSON.stringify(local.dump()).includes(SECRET));
    assert.ok(!JSON.stringify(session.dump()).includes(SECRET), 'the session copy was left behind');
    assert.equal(hasRememberedAuth(), true);
    assert.equal(readAuth('k').remember, true);
  });
});

test('turning remembering off removes what was already written to disk', () => {
  const local = fakeStorage();
  const session = fakeStorage();
  withStorage(local, session, () => {
    writeAuth({ credential: SECRET, schemeId: 'b', remember: true, schemaKey: 'k' });
    writeAuth({ credential: SECRET, schemeId: 'b', remember: false, schemaKey: 'k' });
    assert.ok(!JSON.stringify(local.dump()).includes(SECRET), 'the remembered copy outlived the choice');
    assert.ok(JSON.stringify(session.dump()).includes(SECRET));
  });
});

test('a credential is only handed back to the schema it was entered against', () => {
  const local = fakeStorage();
  const session = fakeStorage();
  withStorage(local, session, () => {
    writeAuth({ credential: SECRET, schemeId: 'b', remember: true, schemaKey: 'https://a.example/openapi.yaml' });
    assert.equal(readAuth('https://a.example/openapi.yaml').credential, SECRET);
    assert.equal(readAuth('https://b.example/openapi.yaml'), null, 'a token leaked to a different API');
    assert.equal(readAuth('file:oak.json'), null);
  });
});

test('an empty credential is a removal, not a stored empty string', () => {
  const local = fakeStorage();
  const session = fakeStorage();
  withStorage(local, session, () => {
    writeAuth({ credential: SECRET, schemeId: 'b', remember: true, schemaKey: 'k' });
    writeAuth({ credential: '', schemeId: 'b', remember: true, schemaKey: 'k' });
    assert.deepEqual(local.keys, []);
    assert.deepEqual(session.keys, []);
    assert.equal(readAuth('k'), null);
  });
});

test('forgetting clears both stores', () => {
  const local = fakeStorage();
  const session = fakeStorage();
  withStorage(local, session, () => {
    writeAuth({ credential: SECRET, schemeId: 'b', remember: true, schemaKey: 'k' });
    clearAuth();
    assert.equal(readAuth('k'), null);
    assert.equal(hasRememberedAuth(), false);
    assert.ok(!JSON.stringify({ ...local.dump(), ...session.dump() }).includes(SECRET));
  });
});

test('storage that is blocked outright does not throw on the way past', () => {
  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  withStorage(blocked, blocked, () => {
    assert.deepEqual(readPrefs(), {});
    assert.doesNotThrow(() => writePrefs({
      theme: 'dark', density: 'dense', showHints: true, railCollapsed: false, listCollapsed: false,
    }));
    assert.equal(readSchema(), null);
    assert.equal(writeSchema({ name: 'a', url: null, text: '{}' }), null);
    assert.equal(readAuth('k'), null);
    assert.doesNotThrow(() => writeAuth({ credential: SECRET, schemeId: null, remember: true, schemaKey: 'k' }));
    assert.doesNotThrow(() => clearAuth());
  });
});

/* --- the base URL -------------------------------------------------------- */

test('a base URL comes back for the schema it was typed against, and no other', () => {
  const local = fakeStorage();
  withStorage(local, fakeStorage(), () => {
    writeBaseUrl({ url: 'https://api.example.com', schemaKey: 'https://example.com/openapi.yaml' });
    assert.equal(readBaseUrl('https://example.com/openapi.yaml'), 'https://api.example.com');
    // Another document must not inherit a host nobody chose for it.
    assert.equal(readBaseUrl('file:other.yaml'), '');
  });
});

test('clearing the base URL takes it off the device', () => {
  const local = fakeStorage();
  withStorage(local, fakeStorage(), () => {
    writeBaseUrl({ url: 'https://api.example.com', schemaKey: 'k' });
    clearBaseUrl();
    assert.equal(readBaseUrl('k'), '');
    assert.deepEqual(local.keys, []);
    // Writing an empty one is the same as clearing it.
    writeBaseUrl({ url: 'https://api.example.com', schemaKey: 'k' });
    writeBaseUrl({ url: '', schemaKey: 'k' });
    assert.equal(readBaseUrl('k'), '');
  });
});
