import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildHash } from '../js/lib/router.js';

const FILTERS = {
  query: 'book', tags: ['Bookings', 'Venues'], verbs: ['POST'],
  scopes: ['bookings.write'], statusCodes: ['409'], hideDeprecated: true, onlyDeprecated: false,
};

test('an operation round-trips through the URL with its filters intact', () => {
  const hash = buildHash({ view: 'operation', id: 'post-v2-bookings', filters: FILTERS });
  const parsed = parseHash(hash);
  assert.equal(parsed.view, 'operation');
  assert.equal(parsed.id, 'post-v2-bookings');
  assert.deepEqual(parsed.filters, FILTERS);
});

test('a schema round-trips', () => {
  const parsed = parseHash(buildHash({ view: 'schema', id: 'Booking', filters: {} }));
  assert.equal(parsed.view, 'schema');
  assert.equal(parsed.id, 'Booking');
});

test('the schema source rides along so a link opens for someone who has never loaded it', () => {
  const src = 'https://api.example.com/openapi.yaml';
  const hash = buildHash({ view: 'operation', id: 'get-things', filters: {}, src });
  assert.match(hash, /src=https%3A%2F%2Fapi\.example\.com%2Fopenapi\.yaml/);
  assert.equal(parseHash(hash).src, src);
});

test('deprecated has three states and only one is ever in the URL', () => {
  assert.match(buildHash({ view: 'browse', filters: { hideDeprecated: true } }), /deprecated=hide/);
  assert.match(buildHash({ view: 'browse', filters: { onlyDeprecated: true } }), /deprecated=only/);
  assert.ok(!buildHash({ view: 'browse', filters: {} }).includes('deprecated'));
  assert.equal(parseHash('#/?deprecated=only').filters.onlyDeprecated, true);
  assert.equal(parseHash('#/?deprecated=only').filters.hideDeprecated, false);
});

test('an unknown or empty hash lands on the browse view rather than erroring', () => {
  for (const hash of ['', '#', '#/', '#/nonsense', '#/op']) {
    assert.equal(parseHash(hash).view, 'browse', `for ${JSON.stringify(hash)}`);
  }
});

test('the import route is addressable', () => {
  assert.equal(parseHash('#/import').view, 'import');
});

test('ids containing characters that need escaping survive the round trip', () => {
  const parsed = parseHash(buildHash({ view: 'schema', id: 'Weird Name/With Slash', filters: {} }));
  assert.equal(parsed.id, 'Weird Name/With Slash');
});
