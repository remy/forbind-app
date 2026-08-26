import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRequest, toCurl, toFetch, toPython, sampleValue, lineCount } from '../js/lib/request.js';
import { normalise } from '../js/lib/openapi.js';
import { sampleModel, op } from './helpers.mjs';

const AUTH = { schemeId: 'bearerAuth', credential: 'a-real-secret-token' };

test('the curl snippet matches what the design draws', () => {
  const model = sampleModel();
  const request = buildRequest({ model, operation: op(model, 'POST', '/v2/bookings') });
  const curl = toCurl(request);
  assert.equal(curl.split('\n')[0], 'curl -X POST https://api.bookings.dev/v2/bookings \\');
  assert.match(curl, /-H "Authorization: Bearer \$TOKEN"/);
  assert.match(curl, /-H "Idempotency-Key: 01J9F2K3"/);
  assert.match(curl, /"venueId":"01J8QW"/);
  assert.equal(lineCount(curl), 5);
});

test('a snippet NEVER carries the real credential, whatever it is handed', () => {
  const model = sampleModel();
  for (const operation of model.operations) {
    const request = buildRequest({ model, operation, auth: AUTH, revealCredential: false });
    for (const render of [toCurl, toFetch, toPython]) {
      const snippet = render(request);
      assert.ok(
        !snippet.includes(AUTH.credential),
        `${render.name} leaked the credential for ${operation.method} ${operation.path}`,
      );
    }
  }
});

test('a snippet built with no revealCredential flag at all still redacts', () => {
  const model = sampleModel();
  // The default must be the safe one: forgetting the flag cannot leak.
  const request = buildRequest({ model, operation: op(model, 'POST', '/v2/bookings'), auth: AUTH });
  assert.match(toCurl(request), /\$TOKEN/);
  assert.ok(!toCurl(request).includes(AUTH.credential));
});

test('the sender does use the real credential', () => {
  const model = sampleModel();
  const request = buildRequest({
    model, operation: op(model, 'POST', '/v2/bookings'), auth: AUTH, revealCredential: true,
  });
  assert.deepEqual(
    request.headers.find(([name]) => name === 'Authorization'),
    ['Authorization', `Bearer ${AUTH.credential}`],
  );
});

test('a credential for a different scheme is not sent', () => {
  const model = sampleModel();
  const request = buildRequest({
    model,
    operation: op(model, 'POST', '/v2/bookings'),
    auth: { schemeId: 'someOtherScheme', credential: 'nope' },
    revealCredential: true,
  });
  assert.match(request.headers.find(([n]) => n === 'Authorization')[1], /\$TOKEN$/);
  assert.ok(request.warnings.some((w) => /unauthenticated/.test(w)));
});

test('path parameters are substituted and required query parameters are filled', () => {
  const model = sampleModel();
  const request = buildRequest({
    model,
    operation: op(model, 'GET', '/v2/availability'),
    values: { query: { venueId: '01J8QW', date: '2026-03-01', partySize: '4' } },
  });
  assert.equal(request.url, 'https://api.bookings.dev/v2/availability?venueId=01J8QW&date=2026-03-01&partySize=4');
});

test('an unfilled path parameter stays a visible placeholder, and the URL gets quoted', () => {
  const model = sampleModel();
  const request = buildRequest({ model, operation: op(model, 'GET', '/v2/bookings/{bookingId}') });
  assert.equal(request.url, 'https://api.bookings.dev/v2/bookings/{bookingId}');
  assert.match(toCurl(request), /curl -X GET "https:\/\/api\.bookings\.dev\/v2\/bookings\/\{bookingId\}"/);
});

test('optional query parameters are left out unless given a value', () => {
  const model = sampleModel();
  const bare = buildRequest({ model, operation: op(model, 'GET', '/v2/bookings') });
  assert.equal(bare.url, 'https://api.bookings.dev/v2/bookings');
  const filtered = buildRequest({
    model, operation: op(model, 'GET', '/v2/bookings'), values: { query: { status: 'confirmed' } },
  });
  assert.equal(filtered.url, 'https://api.bookings.dev/v2/bookings?status=confirmed');
});

test('an apiKey in the query goes in the query, redacted for snippets', () => {
  const model = normalise({
    openapi: '3.1.0',
    servers: [{ url: 'https://api.example.com' }],
    components: { securitySchemes: { key: { type: 'apiKey', in: 'query', name: 'api_key' } } },
    security: [{ key: [] }],
    paths: { '/things': { get: { responses: { 200: { description: 'ok' } } } } },
  }, 'k');
  const snippet = buildRequest({ model, operation: model.operations[0], auth: { schemeId: 'key', credential: 'sekrit' } });
  assert.match(snippet.url, /api_key=\$API_KEY$/);
  const real = buildRequest({
    model, operation: model.operations[0], auth: { schemeId: 'key', credential: 'sekrit' }, revealCredential: true,
  });
  assert.match(real.url, /api_key=sekrit$/);
});

test('an apiKey in a header uses the header the document named', () => {
  const model = normalise({
    openapi: '3.1.0',
    servers: [{ url: 'https://api.example.com' }],
    components: { securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'X-Api-Key' } } },
    security: [{ key: [] }],
    paths: { '/things': { get: { responses: {} } } },
  }, 'k');
  const request = buildRequest({ model, operation: model.operations[0] });
  assert.deepEqual(request.headers[0], ['X-Api-Key', '$API_KEY']);
});

test('basic auth gets its own placeholder', () => {
  const model = normalise({
    openapi: '3.1.0',
    servers: [{ url: 'https://api.example.com' }],
    components: { securitySchemes: { b: { type: 'http', scheme: 'basic' } } },
    security: [{ b: [] }],
    paths: { '/things': { get: { responses: {} } } },
  }, 'b');
  assert.deepEqual(buildRequest({ model, operation: model.operations[0] }).headers[0], ['Authorization', 'Basic $BASIC_CREDENTIALS']);
});

test('a document with no server says so instead of inventing a host', () => {
  const model = normalise({ openapi: '3.1.0', paths: { '/things': { get: { responses: {} } } } }, 'noserver');
  const request = buildRequest({ model, operation: model.operations[0] });
  assert.equal(request.url, '/things');
  assert.ok(request.warnings.some((w) => /No server URL/.test(w)));
});

test('the body draft carries required fields and anything the document exemplified', () => {
  const model = sampleModel();
  const request = buildRequest({ model, operation: op(model, 'POST', '/v2/bookings') });
  const body = JSON.parse(request.body);
  assert.deepEqual(Object.keys(body), ['venueId', 'holdId', 'partySize', 'customer']);
  assert.equal(body.partySize, 4);
  assert.deepEqual(Object.keys(body.customer), ['name', 'email', 'marketingConsent']);
});

test('read-only fields are never drafted into a request body', () => {
  const model = sampleModel();
  const request = buildRequest({ model, operation: op(model, 'POST', '/v2/venues') });
  const body = JSON.parse(request.body);
  assert.ok(!('id' in body), 'the read-only id was drafted into the body');
});

test('sampleValue prefers what the document says over anything invented', () => {
  assert.equal(sampleValue({}, { type: 'string', example: 'hello' }), 'hello');
  assert.equal(sampleValue({}, { type: 'string', default: 'fallback' }), 'fallback');
  assert.equal(sampleValue({}, { type: 'string', enum: ['a', 'b'] }), 'a');
  assert.equal(sampleValue({}, { type: 'string', format: 'date' }), '2026-01-31');
  assert.equal(sampleValue({}, { type: 'integer', minimum: 7 }), 7);
  assert.equal(sampleValue({}, { type: 'boolean' }), true);
  assert.deepEqual(sampleValue({}, { type: 'array', items: { type: 'integer' } }), [1]);
});

test('an edited body wins over the drafted one', () => {
  const model = sampleModel();
  const request = buildRequest({
    model, operation: op(model, 'POST', '/v2/bookings'), values: { body: '{"mine":true}' },
  });
  assert.equal(request.body, '{"mine":true}');
});

test('all three snippet languages come from one request model', () => {
  const model = sampleModel();
  const request = buildRequest({ model, operation: op(model, 'POST', '/v2/bookings') });
  const fetchSnippet = toFetch(request);
  const pythonSnippet = toPython(request);
  // Whatever the syntax, the same URL, method and headers appear in each.
  for (const snippet of [toCurl(request), fetchSnippet, pythonSnippet]) {
    assert.match(snippet, /https:\/\/api\.bookings\.dev\/v2\/bookings/);
    assert.match(snippet, /Idempotency-Key/);
  }
  assert.match(fetchSnippet, /^await fetch\(/);
  assert.match(pythonSnippet, /^import requests/);
  assert.match(pythonSnippet, /requests\.post\(/);
  // Python literals, not JSON ones.
  assert.ok(!/\bfalse\b/.test(pythonSnippet), 'python snippet contains a JSON boolean');
});

test('a body with a single quote does not break out of the curl quoting', () => {
  const model = normalise({
    openapi: '3.1.0',
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/things': {
        post: {
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string', example: "O'Rae" } }, required: ['name'] } } } },
          responses: {},
        },
      },
    },
  }, 'quote');
  const curl = toCurl(buildRequest({ model, operation: model.operations[0] }));
  assert.match(curl, /'\\''/);
});

test('a response example shows everything, unlike a request draft', () => {
  const model = sampleModel();
  const booking = model.doc.components.schemas.Booking;
  const draft = sampleValue(model.doc, booking);
  const full = sampleValue(model.doc, booking, { includeOptional: true });

  // The draft is trimmed to what a caller has to send.
  assert.ok(!('createdAt' in draft), 'a read-only field was drafted into a request');
  // The response example is the opposite: show what might come back.
  assert.ok('createdAt' in full, 'a read-only field was left out of a response example');
  assert.ok('notes' in full, 'an optional field was left out of a response example');
  assert.ok(Object.keys(full).length > Object.keys(draft).length);
});

test('a write-only field never appears in a response example', () => {
  const doc = {};
  const full = sampleValue(doc, {
    type: 'object',
    properties: { url: { type: 'string' }, secret: { type: 'string', writeOnly: true } },
  }, { includeOptional: true });
  assert.deepEqual(Object.keys(full), ['url']);
});
