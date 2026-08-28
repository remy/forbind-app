import test from 'node:test';
import assert from 'node:assert/strict';

import {
  inspectServers, baseUrlFor, normaliseBaseUrl, describeServerGap, isAbsoluteBase, originFrom,
} from '../js/lib/servers.js';
import { normalise } from '../js/lib/openapi.js';

test('a document with no servers block is reported as missing one', () => {
  assert.deepEqual(inspectServers([]), { present: false, usable: false, url: null, reason: 'missing' });
  assert.deepEqual(inspectServers(), { present: false, usable: false, url: null, reason: 'missing' });
});

test('a declared server that cannot be sent to says which way it is unusable', () => {
  assert.equal(inspectServers([{ url: '/v1' }]).reason, 'relative');
  assert.equal(inspectServers([{ url: 'https://{region}.api.example' }]).reason, 'placeholder');
  // Declared, and still not somewhere a request can go.
  assert.equal(inspectServers([{ url: '/v1' }]).present, true);
  assert.equal(inspectServers([{ url: '/v1' }]).usable, false);
});

test('the first server a browser could actually fetch is the one that is used', () => {
  const check = inspectServers([{ url: '/v1' }, { url: 'https://api.example.com/v2/' }]);
  assert.equal(check.usable, true);
  assert.equal(check.url, 'https://api.example.com/v2');
});

test('an operation server wins over the document, and a supplied base URL over both', () => {
  const model = { servers: [{ url: 'https://doc.example.com' }] };
  const operation = { servers: [{ url: 'https://op.example.com' }] };
  assert.equal(baseUrlFor({ model, operation }), 'https://op.example.com');
  assert.equal(baseUrlFor({ model }), 'https://doc.example.com');
  assert.equal(baseUrlFor({ model, operation, baseUrl: 'https://mine.example.com/' }), 'https://mine.example.com');
  assert.equal(baseUrlFor({}), '');
});

test('a base URL is completed rather than refused when only the scheme is missing', () => {
  assert.deepEqual(normaliseBaseUrl('api.example.com'), { url: 'https://api.example.com', error: null });
  assert.deepEqual(normaliseBaseUrl('  http://localhost:3000/v1/  '), { url: 'http://localhost:3000/v1', error: null });
});

test('a base URL that would send a request somewhere unintended is refused with a reason', () => {
  for (const input of ['', '   ', 'ftp://files.example.com', 'https://{region}.example.com', 'https://api.example.com?key=1']) {
    const { url, error } = normaliseBaseUrl(input);
    assert.equal(url, null, `${input} should not be accepted`);
    assert.ok(error && error.length > 10, `${input} should say why`);
  }
});

test('the parse report flags a missing base URL as something to populate', () => {
  const model = normalise({ openapi: '3.1.0', paths: { '/things': { get: { responses: {} } } } }, 'noserver');
  assert.deepEqual(model.report.baseUrl, { needed: true, reason: 'missing', declared: null });
  const note = model.report.notes.find((n) => /server URL/.test(n.parts.join('')));
  assert.equal(note.level, 'WARN');
  assert.match(note.parts.join(''), /Set a base URL, or browse without one/);
});

test('a relative or unfilled server URL is flagged for the same reason', () => {
  const relative = normalise({
    openapi: '3.1.0', servers: [{ url: '/v1' }], paths: { '/things': { get: { responses: {} } } },
  }, 'relative');
  assert.equal(relative.report.baseUrl.needed, true);
  assert.equal(relative.report.baseUrl.reason, 'relative');

  const templated = normalise({
    openapi: '3.1.0',
    servers: [{ url: 'https://{region}.api.example.com' }],
    paths: { '/things': { get: { responses: {} } } },
  }, 'templated');
  assert.equal(templated.report.baseUrl.reason, 'placeholder');
});

test('a server variable with a default is filled in and needs nothing from the reader', () => {
  const model = normalise({
    openapi: '3.1.0',
    servers: [{ url: 'https://{region}.api.example.com', variables: { region: { default: 'eu' } } }],
    paths: { '/things': { get: { responses: {} } } },
  }, 'filled');
  assert.equal(model.report.baseUrl.needed, false);
  assert.equal(model.report.baseUrl.declared, 'https://eu.api.example.com');
});

test('an operation carrying its own server does not drag the document into the warning', () => {
  const model = normalise({
    openapi: '3.1.0',
    paths: { '/things': { get: { servers: [{ url: 'https://api.example.com' }], responses: {} } } },
  }, 'op-level');
  assert.equal(model.report.baseUrl.needed, false);
});

test('Swagger 2.0 host and basePath count as a declared server', () => {
  const model = normalise({
    swagger: '2.0', host: 'api.example.com', basePath: '/v1', schemes: ['https'],
    paths: { '/things': { get: { responses: {} } } },
  }, 'v2');
  assert.equal(model.report.baseUrl.needed, false);
  // basePath on its own is relative, which is exactly the gap the reader fills.
  const bare = normalise({
    swagger: '2.0', basePath: '/v1', paths: { '/things': { get: { responses: {} } } },
  }, 'v2-bare');
  assert.equal(bare.report.baseUrl.reason, 'relative');
});

test('the sample schema declares a server, so nothing is asked of the reader', () => {
  assert.equal(isAbsoluteBase('https://api.example.com'), true);
  assert.equal(isAbsoluteBase('/v1'), false);
  assert.match(describeServerGap('missing'), /declares no server URL/);
  assert.match(describeServerGap('relative', '/v1'), /relative \(\/v1\)/);
  assert.match(describeServerGap('placeholder', 'https://{r}.x'), /variable in it/);
});

test('the address a schema was fetched from offers its origin as a starting value', () => {
  assert.equal(originFrom('https://api.example.com/v2/openapi.json'), 'https://api.example.com');
  // A port is part of the origin; a path, a query and a fragment are not.
  assert.equal(originFrom('http://localhost:8080/docs/openapi.yaml?v=2#x'), 'http://localhost:8080');
});

test('an address there is nothing to suggest from suggests nothing', () => {
  // A file the reader dropped in never had an address at all.
  assert.equal(originFrom(null), '');
  assert.equal(originFrom(undefined), '');
  assert.equal(originFrom(''), '');
  assert.equal(originFrom('not a url'), '');
  // And a scheme no request can be sent to is not a base URL.
  assert.equal(originFrom('file:///Users/someone/openapi.yaml'), '');
  assert.equal(originFrom('data:text/yaml,openapi: 3.1.0'), '');
});

test('a suggested origin is a starting value, not a base URL that is in force', () => {
  // Whatever the field is pre-filled with, nothing is resolved against it
  // until the reader has actually applied it.
  const model = normalise({
    openapi: '3.1.0', paths: { '/things': { get: { responses: {} } } },
  }, 'no-servers');
  assert.equal(model.report.baseUrl.needed, true);
  assert.equal(baseUrlFor({ model }), '');
  assert.equal(baseUrlFor({ model, baseUrl: originFrom('https://api.example.com/openapi.json') }), 'https://api.example.com');
});
