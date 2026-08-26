import test from 'node:test';
import assert from 'node:assert/strict';

import { filterOperations, score, groupByTag, typeAheadIndex, allScopes, allStatusCodes } from '../js/lib/search.js';
import { sampleModel, emptyFilters } from './helpers.mjs';

const filter = (patch) => filterOperations(sampleModel().operations, { ...emptyFilters, ...patch });

test('an empty filter set shows everything', () => {
  assert.equal(filter({}).length, 47);
});

test('a tag narrows to that tag and the counts match the rail', () => {
  assert.equal(filter({ tags: ['Bookings'] }).length, 12);
  assert.equal(filter({ tags: ['Venues'] }).length, 9);
  // Two tags are a union, not an intersection.
  assert.equal(filter({ tags: ['Bookings', 'Venues'] }).length, 21);
});

test('a verb narrows to that verb and the counts match the filter bar', () => {
  assert.equal(filter({ verbs: ['GET'] }).length, 21);
  assert.equal(filter({ verbs: ['DELETE'] }).length, 6);
  assert.equal(filter({ verbs: ['GET', 'POST'] }).length, 33);
});

test('tag and verb compose as an intersection', () => {
  assert.equal(filter({ tags: ['Bookings'], verbs: ['GET'] }).length, 4);
});

test('deprecated endpoints can be hidden, or shown on their own', () => {
  assert.equal(filter({ hideDeprecated: true }).length, 44);
  assert.equal(filter({ onlyDeprecated: true }).length, 3);
  assert.ok(filter({ onlyDeprecated: true }).every((o) => o.deprecated));
});

test('a scope facet narrows to operations that need it', () => {
  const results = filter({ scopes: ['payments.write'] });
  assert.ok(results.length > 0);
  assert.ok(results.every((o) => o.scopes.includes('payments.write')));
});

test('a status-code facet narrows to operations that declare it', () => {
  const results = filter({ statusCodes: ['409'] });
  assert.ok(results.length > 0);
  assert.ok(results.every((o) => o.responses.some((r) => r.code === '409')));
});

test('search matches the path, the summary, a parameter name and a schema name', () => {
  assert.ok(filter({ query: 'holds' }).length > 0);
  assert.ok(filter({ query: 'cancel' }).some((o) => o.path === '/v2/bookings/{bookingId}'));
  assert.ok(filter({ query: 'bookingId' }).length > 0);
  assert.ok(filter({ query: 'AvailabilitySlot' }).length > 0);
});

test('every word in a query has to match something', () => {
  assert.equal(filter({ query: 'bookings zzzz' }).length, 0);
  assert.ok(filter({ query: 'post bookings' }).length > 0);
  assert.ok(filter({ query: 'post bookings' }).every((o) => o.method === 'POST' || o.path.includes('booking')));
});

test('a leading verb narrows the way people type it', () => {
  const results = filter({ query: 'delete venues' });
  assert.ok(results.some((o) => o.method === 'DELETE' && o.path.includes('venues')));
});

test('a path prefix outranks a description mention', () => {
  const model = sampleModel();
  const exact = model.operations.find((o) => o.path === '/v2/venues' && o.method === 'GET');
  const other = model.operations.find((o) => o.path === '/v2/bookings' && o.method === 'GET');
  assert.ok(score(exact, '/v2/venues') > score(other, '/v2/venues'));
});

test('search is case-insensitive', () => {
  assert.equal(filter({ query: 'BOOKINGS' }).length, filter({ query: 'bookings' }).length);
});

test('results are grouped in the tag order the document declared', () => {
  const model = sampleModel();
  const groups = groupByTag(model.operations, model.tags);
  assert.deepEqual(groups.map((g) => g.name), ['Bookings', 'Venues', 'Availability', 'Payments', 'Customers', 'Webhooks']);
  assert.equal(groups[0].operations.length, 12);
});

test('type-ahead finds the next matching path and wraps around', () => {
  const ops = filter({ tags: ['Bookings'] });
  const index = typeAheadIndex(ops, 'v2/bookings/{bookingid}', 0);
  assert.ok(index > 0);
  // From the last item it wraps rather than giving up.
  assert.ok(typeAheadIndex(ops, '/v2/bookings', ops.length - 1) >= 0);
  assert.equal(typeAheadIndex(ops, 'zzz', 0), -1);
});

test('the facet lists are the values actually present in the document', () => {
  const model = sampleModel();
  const scopes = allScopes(model.operations);
  assert.ok(scopes.includes('bookings.write'));
  assert.deepEqual(scopes, [...scopes].sort());
  const codes = allStatusCodes(model.operations);
  assert.equal(codes[0], '200');
  assert.ok(codes.includes('422'));
});

test('filtering does not reorder the list unless there is a query', () => {
  const model = sampleModel();
  const unqueried = filter({ tags: ['Bookings'] });
  const documentOrder = model.operations.filter((o) => o.tags.includes('Bookings'));
  assert.deepEqual(unqueried.map((o) => o.id), documentOrder.map((o) => o.id));
});
