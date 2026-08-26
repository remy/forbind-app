import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { isPrivateHost, assertFetchable } from '../netlify/functions/fetch-schema.mjs';

const call = (url) => handler(new Request(`https://allyway.example/api/fetch-schema?url=${encodeURIComponent(url)}`));
const body = async (response) => JSON.parse(await response.text());

test('a private or link-local address is refused before any request is made', async () => {
  const blocked = [
    'http://localhost/openapi.yaml',
    'http://127.0.0.1/openapi.yaml',
    'http://127.1.2.3/x',
    'http://0.0.0.0/x',
    'http://10.0.0.5/x',
    'http://172.16.4.1/x',
    'http://172.31.255.254/x',
    'http://192.168.1.1/x',
    'http://100.64.0.1/x',
    // The cloud metadata endpoint, which is the whole reason this guard exists.
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/x',
    'http://[fd00::1]/x',
    'http://api.local/x',
    'http://thing.internal/x',
    'http://[::ffff:169.254.169.254]/x',
  ];
  for (const url of blocked) {
    const response = await call(url);
    assert.equal(response.status, 400, `${url} was not refused`);
    assert.match((await body(response)).error, /private or link-local|not a valid URL/, url);
  }
});

test('the address guard does not over-reach into neighbouring public ranges', () => {
  // Each of these sits one step outside a private range. A guard that catches
  // them is a guard that blocks real APIs.
  for (const host of ['172.32.0.1', '172.15.255.255', '11.0.0.1', '192.169.1.1', '100.128.0.1', '169.253.0.1', '8.8.8.8', 'api.example.com', '2606:4700::1111']) {
    assert.equal(isPrivateHost(host), false, `${host} was treated as private`);
  }
});

test('every written form of a private address is caught, normalised or not', () => {
  for (const host of [
    'localhost', 'x.localhost', 'printer.local', 'vault.internal',
    '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.5',
    '172.16.4.1', '172.31.255.254', '192.168.1.1', '100.64.0.1',
    '169.254.169.254',
    '::1', '::', 'fd00::1', 'fc00::1', 'fe80::1',
    // The IPv4-mapped forms, before and after the URL parser rewrites them.
    '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::ffff:127.0.0.1', '::ffff:7f00:1',
  ]) {
    assert.equal(isPrivateHost(host), true, `${host} was not treated as private`);
  }
});

test('assertFetchable returns the URL it approved', () => {
  assert.equal(assertFetchable('https://api.example.com/o.yaml'), 'https://api.example.com/o.yaml');
  assert.throws(() => assertFetchable('http://169.254.169.254/'), /private or link-local/);
});

test('non-http schemes and embedded credentials are refused', async () => {
  assert.equal((await call('file:///etc/passwd')).status, 400);
  assert.equal((await call('ftp://example.com/x')).status, 400);
  const creds = await call('https://user:pw@example.com/x');
  assert.equal(creds.status, 400);
  assert.match((await body(creds)).error, /embedded credentials/);
});

test('a missing url parameter is a 400 with a sentence', async () => {
  const response = await handler(new Request('https://allyway.example/api/fetch-schema'));
  assert.equal(response.status, 400);
  assert.match((await body(response)).error, /url. query parameter/);
});

test('only GET and OPTIONS are answered', async () => {
  const response = await handler(new Request('https://allyway.example/api/fetch-schema?url=https://x.dev/a', { method: 'POST' }));
  assert.equal(response.status, 405);
  const preflight = await handler(new Request('https://allyway.example/api/fetch-schema', { method: 'OPTIONS' }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
});

test('every response is JSON and carries the CORS headers the page needs', async () => {
  const response = await call('http://127.0.0.1/x');
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://allyway.example');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
