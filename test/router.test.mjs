import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildHash, foldQuerySchema } from '../js/lib/router.js';

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

/* --- a schema named in the query string ---------------------------------- */

test('?url= is folded into the fragment the router reads', () => {
  const folded = foldQuerySchema('https://allyway.dev/?url=https://api.example.com/openapi.yaml');
  assert.equal(parseHash(new URL(folded).hash).src, 'https://api.example.com/openapi.yaml');
  // …and is gone from the query, so there is one place to read it from.
  assert.equal(new URL(folded).search, '');
});

test('?src= is taken as well, because someone who saw the fragment will try it', () => {
  const folded = foldQuerySchema('https://allyway.dev/?src=/samples/bookings-api.v2.yaml');
  assert.equal(parseHash(new URL(folded).hash).src, '/samples/bookings-api.v2.yaml');
});

test('a query schema keeps whatever the fragment already asked for', () => {
  const folded = foldQuerySchema('https://allyway.dev/?url=https://api.example.com/o.yaml#/op/get-things?tag=Bookings');
  const route = parseHash(new URL(folded).hash);
  assert.equal(route.view, 'operation');
  assert.equal(route.id, 'get-things');
  assert.deepEqual(route.filters.tags, ['Bookings']);
  assert.equal(route.src, 'https://api.example.com/o.yaml');
});

test('a src already in the fragment wins — it came with the operation it wants', () => {
  const folded = foldQuerySchema('https://allyway.dev/?url=https://loser.example/o.yaml#/op/x?src=https%3A%2F%2Fwinner.example%2Fo.yaml');
  assert.equal(parseHash(new URL(folded).hash).src, 'https://winner.example/o.yaml');
});

test('other query parameters are left alone', () => {
  const folded = foldQuerySchema('https://allyway.dev/?utm_source=docs&url=https://api.example.com/o.yaml');
  assert.equal(new URL(folded).searchParams.get('utm_source'), 'docs');
  assert.equal(new URL(folded).searchParams.get('url'), null);
});

test('nothing to fold means nothing to do, and a junk address does not throw', () => {
  assert.equal(foldQuerySchema('https://allyway.dev/#/op/get-things'), null);
  assert.equal(foldQuerySchema('https://allyway.dev/'), null);
  assert.equal(foldQuerySchema('not a url'), null);
  assert.equal(foldQuerySchema(''), null);
});
