import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseCredential, maskCredential, readJwt, describeExpiry,
  pickProbeOperation, interpretProbe,
} from '../js/lib/auth.js';
import { sampleModel } from './helpers.mjs';

test('the sheet promises to strip the prefix for you, so it does', () => {
  assert.equal(normaliseCredential('Bearer abc123'), 'abc123');
  assert.equal(normaliseCredential('bearer abc123'), 'abc123');
  assert.equal(normaliseCredential('Authorization: Bearer abc123'), 'abc123');
  assert.equal(normaliseCredential('authorization:Bearer abc123'), 'abc123');
  assert.equal(normaliseCredential('Token abc123'), 'abc123');
  assert.equal(normaliseCredential('Basic dXNlcjpwdw=='), 'dXNlcjpwdw==');
  assert.equal(normaliseCredential('  abc123  '), 'abc123');
  assert.equal(normaliseCredential('"abc123"'), 'abc123');
  assert.equal(normaliseCredential("'abc123'"), 'abc123');
  assert.equal(normaliseCredential(null), '');
});

test('a token that merely begins with the word bearer is not mangled', () => {
  assert.equal(normaliseCredential('bearerish-token-value'), 'bearerish-token-value');
});

test('masking leaves enough to tell two tokens apart and no more', () => {
  assert.equal(maskCredential('supersecrettoken4f2a').endsWith('4f2a'), true);
  assert.ok(!maskCredential('supersecrettoken4f2a').includes('supersecret'));
  assert.equal(maskCredential('abc'), '•••');
  assert.equal(maskCredential(''), '');
});

function jwt(claims) {
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode(claims)}.signature`;
}

test('a JWT is read locally for its scopes and expiry', () => {
  const exp = Math.floor(Date.now() / 1000) + 51 * 60;
  const read = readJwt(jwt({ scope: 'a b c d e f', exp, iss: 'https://auth.example.com', sub: 'u_1' }));
  assert.equal(read.scopes.length, 6);
  assert.equal(read.issuer, 'https://auth.example.com');
  assert.equal(read.subject, 'u_1');
  assert.equal(describeExpiry(read.expiresAt), 'expires in 51 min');
});

test('the several ways a scope claim gets spelled are all read', () => {
  assert.deepEqual(readJwt(jwt({ scope: 'a b' })).scopes, ['a', 'b']);
  assert.deepEqual(readJwt(jwt({ scp: ['a', 'b'] })).scopes, ['a', 'b']);
  assert.deepEqual(readJwt(jwt({ scopes: 'a,b' })).scopes, ['a', 'b']);
  assert.deepEqual(readJwt(jwt({})).scopes, []);
});

test('anything that is not a JWT reads as null rather than throwing', () => {
  assert.equal(readJwt('plain-api-key'), null);
  assert.equal(readJwt('a.b.c'), null);
  assert.equal(readJwt(''), null);
  assert.equal(readJwt(null), null);
});

test('expiry is phrased for a human, including in the past', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  assert.equal(describeExpiry(now + 51 * 60000, now), 'expires in 51 min');
  assert.equal(describeExpiry(now + 3 * 3600000, now), 'expires in 3 h');
  assert.equal(describeExpiry(now + 5 * 86400000, now), 'expires in 5 days');
  assert.equal(describeExpiry(now - 3 * 60000, now), 'expired 3 min ago');
  assert.equal(describeExpiry(now - 5 * 3600000, now), 'expired 5 h ago');
  assert.equal(describeExpiry(null, now), null);
});

test('the probe picks a GET that needs no invented path parameter', () => {
  const model = sampleModel();
  const probe = pickProbeOperation(model.operations, 'bearerAuth');
  assert.equal(probe.method, 'GET');
  assert.ok(probe.parameters.every((p) => p.in !== 'path'));
  assert.equal(probe.deprecated, false);
  // And it prefers one with nothing required at all.
  assert.ok(probe.parameters.every((p) => !p.required));
});

test('with nothing safe to probe, no operation is invented', () => {
  const model = sampleModel();
  assert.equal(pickProbeOperation(model.operations, 'noSuchScheme'), null);
  assert.equal(pickProbeOperation([], 'bearerAuth'), null);
});

test('a probe status is reported as what it actually tells you', () => {
  assert.equal(interpretProbe(200).state, 'valid');
  assert.equal(interpretProbe(204).state, 'valid');
  assert.equal(interpretProbe(401).state, 'invalid');
  assert.equal(interpretProbe(403).state, 'invalid');
  // A 404 still means the token got past authentication.
  assert.equal(interpretProbe(404).state, 'valid');
  // A server error says nothing about the token, so it claims nothing.
  assert.equal(interpretProbe(500).state, 'idle');
  assert.equal(interpretProbe(418).state, 'idle');
});
