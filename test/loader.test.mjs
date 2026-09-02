import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseUrl, loadFromUrl, describeFetchFailure } from '../js/lib/loader.js';

const BASE = 'https://forbind.example/index.html';

test('URLs are accepted in the shapes people paste them in', () => {
  assert.equal(normaliseUrl('https://api.example.com/openapi.yaml', BASE), 'https://api.example.com/openapi.yaml');
  assert.equal(normaliseUrl('http://api.example.com/o.json', BASE), 'http://api.example.com/o.json');
  // A bare host gets https, not a guess at a scheme.
  assert.equal(normaliseUrl('api.example.com/o.yaml', BASE), 'https://api.example.com/o.yaml');
  // A same-origin path stays same-origin.
  assert.equal(normaliseUrl('/samples/x.yaml', BASE), 'https://forbind.example/samples/x.yaml');
  assert.equal(normaliseUrl('  https://x.dev/a  ', BASE), 'https://x.dev/a');
});

test('non-http schemes are refused rather than attempted', () => {
  assert.throws(() => normaliseUrl('file:///etc/passwd', BASE), /Only http and https/);
  assert.throws(() => normaliseUrl('javascript:alert(1)', BASE), /Only http and https/);
  assert.throws(() => normaliseUrl('', BASE), /Enter a URL/);
});

test('a direct fetch is used when the host allows it', async () => {
  const calls = [];
  const result = await loadFromUrl('https://api.example.com/o.yaml', {
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, status: 200, statusText: 'OK', text: async () => 'openapi: 3.1.0' };
    },
  });
  assert.deepEqual(calls, ['https://api.example.com/o.yaml']);
  assert.equal(result.via, 'direct');
  assert.equal(result.name, 'o.yaml');
  assert.equal(result.note, null);
});

test('a blocked direct fetch falls back to the relay, and says that it did', async () => {
  const calls = [];
  const result = await loadFromUrl('https://api.example.com/o.yaml', {
    fetchImpl: async (url) => {
      calls.push(url);
      if (!url.startsWith('/api/fetch-schema')) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, json: async () => ({ text: 'openapi: 3.1.0' }) };
    },
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1], /^\/api\/fetch-schema\?url=/);
  assert.equal(result.via, 'relay');
  assert.match(result.note, /could not fetch that URL directly/);
});

test('when neither route works the CORS explanation is the one that surfaces', async () => {
  await assert.rejects(
    loadFromUrl('https://api.example.com/o.yaml', {
      fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
    }),
    (error) => {
      assert.match(error.message, /Access-Control-Allow-Origin|blocked the response/);
      assert.match(error.detail.hint, /Download the file and drop it in instead/);
      return true;
    },
  );
});

test('an HTTP error status is reported as itself, not as a CORS problem', async () => {
  await assert.rejects(
    loadFromUrl('https://api.example.com/o.yaml', {
      fetchImpl: async (url) => {
        if (!url.startsWith('/api/fetch-schema')) return { ok: false, status: 404, statusText: 'Not Found', text: async () => '' };
        return { ok: false, status: 502, json: async () => ({ error: 'The server answered 404 Not Found.' }) };
      },
    }),
    /404 Not Found/,
  );
});

test('a fetch rejection is explained as the two things it can be', () => {
  const message = describeFetchFailure(new TypeError('Failed to fetch'));
  assert.match(message, /Access-Control-Allow-Origin/);
  assert.match(describeFetchFailure({ message: 'The operation was aborted' }), /timed out/);
});
