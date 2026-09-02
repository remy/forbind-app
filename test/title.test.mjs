import test from 'node:test';
import assert from 'node:assert/strict';
import { documentTitle } from '../js/lib/title.js';

const SCHEMA = {
  title: 'Bookings API',
  operations: [
    { id: 'get-v2-bookings', method: 'GET', path: '/v2/bookings' },
    { id: 'post-v2-bookings', method: 'POST', path: '/v2/bookings' },
  ],
};

/** @param {object} patch */
const state = (patch) => ({
  schemaState: 'ready', schema: SCHEMA, browsing: true,
  selectedOperationId: null, selectedSchemaName: null, ...patch,
});

test('each screen gets its own title, most specific part first', () => {
  assert.equal(
    documentTitle(state({ schemaState: 'idle', schema: null })),
    'Load a schema — forbind',
  );
  assert.equal(documentTitle(state({ schemaState: 'loading' })), 'Loading a schema — forbind');
  assert.equal(documentTitle(state({ schemaState: 'error' })), 'Could not load the schema — forbind');
  assert.equal(documentTitle(state({ browsing: false })), 'Parse report — Bookings API — forbind');
  assert.equal(documentTitle(state({})), 'Bookings API — forbind');
  assert.equal(
    documentTitle(state({ selectedOperationId: 'get-v2-bookings' })),
    'GET /v2/bookings — Bookings API — forbind',
  );
  assert.equal(
    documentTitle(state({ selectedSchemaName: 'Booking' })),
    'Booking — Bookings API — forbind',
  );
});

test('replacing a schema is named by the state, not by what is still in memory', () => {
  // replaceSchema() returns to the import screen without dropping the parsed
  // document, so a title keyed off `schema` alone would still say "Bookings
  // API" while the import screen is on show.
  assert.equal(
    documentTitle(state({ schemaState: 'idle', browsing: false })),
    'Load a schema — forbind',
  );
});

test('an operation the URL names but the document does not falls back to the API', () => {
  assert.equal(documentTitle(state({ selectedOperationId: 'delete-nothing' })), 'Bookings API — forbind');
});
