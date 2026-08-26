import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalise, parseText, deref, resolvePointer, describeType, describeConstraints,
  fieldRows, makeOperationId, statusClass, verbLabel, verbClass, describeScheme, SchemaError,
} from '../js/lib/openapi.js';
import { sampleModel, op, yamlDeps } from './helpers.mjs';

test('the bundled sample normalises to the counts the design was drawn against', () => {
  const model = sampleModel();
  assert.deepEqual(model.report.counts, { endpoints: 47, tags: 6, schemas: 9, deprecated: 3 });
  assert.deepEqual(
    model.verbCounts.map((v) => [v.verb, v.count]),
    [['GET', 21], ['POST', 12], ['PATCH', 8], ['DELETE', 6]],
  );
  assert.deepEqual(
    model.tags.map((t) => [t.name, t.count]),
    [['Bookings', 12], ['Venues', 9], ['Availability', 5], ['Payments', 8], ['Customers', 7], ['Webhooks', 6]],
  );
});

test('tags keep the order the document declared them in', () => {
  const model = sampleModel();
  assert.equal(model.tags[0].name, 'Bookings');
  assert.equal(model.tags.at(-1).name, 'Webhooks');
});

test('the parse report says the three things the design says it says', () => {
  const notes = sampleModel().report.notes;
  const flat = notes.map((n) => n.level + ' ' + n.parts.map((p) => (typeof p === 'string' ? p : p.code)).join(''));
  assert.equal(notes.length, 3);
  assert.match(flat[0], /^WARN 4 operations have no summary/);
  assert.match(flat[1], /^WARN Customer\.email has no format/);
  assert.match(flat[2], /^INFO One security scheme found: http bearer/);
  assert.equal(sampleModel().report.ok, true);
});

test('operation ids read like the URL they end up in', () => {
  assert.equal(makeOperationId('POST', '/v2/bookings'), 'post-v2-bookings');
  assert.equal(makeOperationId('GET', '/v2/bookings/{bookingId}'), 'get-v2-bookings-booking-id');
  assert.equal(op(sampleModel(), 'POST', '/v2/bookings').id, 'post-v2-bookings');
});

test('duplicate ids are disambiguated rather than colliding', () => {
  const model = normalise({
    openapi: '3.1.0',
    paths: {
      '/a/{x}': { get: { responses: {} } },
      '/a/{y}': { get: { responses: {} } },
    },
  }, 'dupes');
  const ids = model.operations.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, `ids collided: ${ids.join(', ')}`);
});

test('path-level parameters are merged in, and the operation wins on a clash', () => {
  const model = normalise({
    openapi: '3.1.0',
    paths: {
      '/things/{id}': {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' }, description: 'from the path item' },
        ],
        get: {
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' }, description: 'from the operation' }],
          responses: { 200: { description: 'ok' } },
        },
      },
    },
  }, 'merge');
  const [operation] = model.operations;
  assert.equal(operation.parameters.length, 2);
  assert.equal(operation.parameters.find((p) => p.name === 'limit').description, 'from the operation');
  assert.equal(operation.parameters.find((p) => p.name === 'id').required, true);
});

test('Swagger 2.0 is normalised into the same shape', () => {
  const model = normalise({
    swagger: '2.0',
    host: 'api.example.com',
    basePath: '/v1',
    schemes: ['https'],
    securityDefinitions: { key: { type: 'apiKey', name: 'X-Api-Key', in: 'header' } },
    definitions: { Thing: { type: 'object', properties: { id: { type: 'string' } } } },
    paths: {
      '/things': {
        post: {
          summary: 'Make a thing',
          tags: ['Things'],
          security: [{ key: [] }],
          parameters: [
            { name: 'body', in: 'body', required: true, schema: { $ref: '#/definitions/Thing' } },
            { name: 'dry', in: 'query', type: 'boolean' },
          ],
          responses: { 201: { description: 'Made', schema: { $ref: '#/definitions/Thing' } } },
        },
      },
    },
  }, 'swagger.json');

  assert.equal(model.oasLabel, 'Swagger 2.0');
  assert.deepEqual(model.servers, [{ url: 'https://api.example.com/v1', description: '' }]);
  const [operation] = model.operations;
  // The `body` parameter becomes a requestBody; the rest stay parameters.
  assert.equal(operation.requestBody.schemaName, 'Thing');
  assert.deepEqual(operation.parameters.map((p) => p.name), ['dry']);
  assert.equal(operation.parameters[0].type.label, 'boolean');
  assert.equal(operation.responses[0].schemaName, 'Thing');
  assert.equal(model.schemas[0].name, 'Thing');
  assert.equal(describeScheme(model.securitySchemes.key), 'apiKey in header');
});

test('Swagger 2.0 formData becomes a form-encoded body', () => {
  const model = normalise({
    swagger: '2.0',
    paths: {
      '/upload': {
        post: {
          parameters: [
            { name: 'name', in: 'formData', type: 'string', required: true },
            { name: 'note', in: 'formData', type: 'string' },
          ],
          responses: { 200: { description: 'ok' } },
        },
      },
    },
  }, 'form');
  const body = model.operations[0].requestBody;
  assert.equal(body.contentType, 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.keys(body.schema.properties), ['name', 'note']);
  assert.deepEqual(body.schema.required, ['name']);
});

test('a document with no version field is refused with a sentence, not a stack trace', () => {
  assert.throws(() => normalise({ paths: {} }, 'x'), (error) => {
    assert.ok(error instanceof SchemaError);
    assert.match(error.message, /No `openapi` or `swagger` version field/);
    return true;
  });
});

test('$refs resolve, and a cycle terminates instead of hanging', () => {
  const doc = {
    components: {
      schemas: {
        Node: { type: 'object', properties: { child: { $ref: '#/components/schemas/Node' } } },
        Alias: { $ref: '#/components/schemas/Node' },
      },
    },
  };
  assert.equal(resolvePointer(doc, '#/components/schemas/Node').type, 'object');
  const resolved = deref(doc, { $ref: '#/components/schemas/Alias' });
  assert.equal(resolved.name, 'Alias');
  assert.equal(resolved.value.type, 'object');
  // The self-reference is followed once and then stopped.
  const rows = fieldRows(doc, { $ref: '#/components/schemas/Node' });
  assert.deepEqual(rows.map((r) => r.name), ['child']);
  assert.equal(rows[0].type.ref, 'Node');
});

test('a $ref that does not resolve is reported rather than swallowed', () => {
  const model = normalise({
    openapi: '3.1.0',
    paths: { '/a': { get: { parameters: [{ $ref: '#/components/parameters/Missing' }], responses: {} } } },
  }, 'broken');
  assert.ok(model.report.notes.some((n) => n.level === 'FAIL'));
});

test('an external $ref is named but not followed', () => {
  const result = deref({}, { $ref: 'other.yaml#/components/schemas/Thing' });
  assert.equal(result.external, true);
  assert.equal(result.name, 'Thing');
});

test('describeType covers the shapes a real document uses', () => {
  const doc = { components: { schemas: { Customer: { type: 'object' } } } };
  const t = (node) => describeType(doc, node).label;
  assert.equal(t({ type: 'string' }), 'string');
  assert.equal(t({ type: ['string', 'null'] }), 'string | null');
  assert.equal(t({ type: 'string', nullable: true }), 'string | null');
  assert.equal(t({ type: 'array', items: { type: 'integer' } }), 'integer[]');
  assert.equal(t({ $ref: '#/components/schemas/Customer' }), 'Customer');
  assert.equal(t({ type: 'array', items: { $ref: '#/components/schemas/Customer' } }), 'Customer[]');
  assert.equal(t({ oneOf: [{ type: 'string' }, { type: 'null' }] }), 'string | null');
  assert.equal(t({ properties: {} }), 'object');
  assert.equal(t({}), 'any');
  // An array of a named schema still links to the schema.
  assert.equal(describeType(doc, { type: 'array', items: { $ref: '#/components/schemas/Customer' } }).ref, 'Customer');
});

test('constraints are described in the order a caller needs them', () => {
  assert.deepEqual(describeConstraints({ type: 'integer', minimum: 1, maximum: 20 }), ['1–20']);
  assert.deepEqual(describeConstraints({ type: 'string', maxLength: 500 }), ['max 500 chars']);
  assert.deepEqual(describeConstraints({ type: 'string', format: 'date' }), ['date']);
  assert.deepEqual(describeConstraints({ enum: ['a', 'b'] }), ['one of a, b']);
  assert.deepEqual(describeConstraints({ readOnly: true }), ['read-only']);
});

test('fieldRows flattens the request body the way the params table shows it', () => {
  const model = sampleModel();
  const rows = fieldRows(model.doc, op(model, 'POST', '/v2/bookings').requestBody.schema);
  assert.deepEqual(rows.map((r) => r.name), ['venueId', 'holdId', 'partySize', 'customer', 'notes']);
  assert.deepEqual(rows.map((r) => r.required), [true, true, true, true, false]);
  // A type that names a schema is what makes the cell a link.
  assert.equal(rows.find((r) => r.name === 'customer').type.ref, 'Customer');
  assert.equal(rows.find((r) => r.name === 'partySize').notes, '1–20');
  assert.equal(rows.find((r) => r.name === 'venueId').description, 'ULID');
});

test('allOf composition merges into one set of fields', () => {
  const doc = {
    components: {
      schemas: {
        Base: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        Extra: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      },
    },
  };
  const rows = fieldRows(doc, { allOf: [{ $ref: '#/components/schemas/Base' }, { $ref: '#/components/schemas/Extra' }] });
  assert.deepEqual(rows.map((r) => r.name), ['id', 'name']);
  assert.deepEqual(rows.map((r) => r.required), [true, true]);
});

test('response classes drive the tint but never the meaning', () => {
  assert.equal(statusClass('201'), 'success');
  assert.equal(statusClass('302'), 'info');
  assert.equal(statusClass('409'), 'warn');
  assert.equal(statusClass('422'), 'error');
  assert.equal(statusClass('503'), 'error');
  assert.equal(statusClass('default'), 'neutral');
});

test('DELETE is abbreviated for the pill but never for the accessible name', () => {
  assert.equal(verbLabel('DELETE'), 'DEL');
  assert.equal(verbLabel('GET'), 'GET');
  assert.equal(verbClass('PUT'), 'patch');
  assert.equal(verbClass('OPTIONS'), 'other');
});

test('JSON is parsed as JSON, with the position of the problem', () => {
  assert.deepEqual(parseText('{"openapi":"3.1.0"}', yamlDeps), { openapi: '3.1.0' });
  assert.throws(() => parseText('{"a": }', yamlDeps), (error) => {
    assert.match(error.message, /not valid JSON/);
    assert.equal(error.detail.line, 1);
    return true;
  });
});

test('a YAML error carries the line, the column and the line itself', () => {
  assert.throws(() => parseText('a:\n b: 1\n  c: 2\n', yamlDeps), (error) => {
    assert.match(error.message, /not valid YAML/);
    assert.equal(typeof error.detail.line, 'number');
    assert.equal(typeof error.detail.snippet, 'string');
    return true;
  });
});

test('an empty file says so rather than parsing to nothing', () => {
  assert.throws(() => parseText('   \n', yamlDeps), /empty/);
});

test('server variables are substituted from their defaults', () => {
  const model = normalise({
    openapi: '3.1.0',
    servers: [{ url: 'https://{region}.api.example.com/{ver}', variables: { region: { default: 'eu' }, ver: { enum: ['v2'] } } }],
    paths: {},
  }, 'vars');
  assert.equal(model.servers[0].url, 'https://eu.api.example.com/v2');
});

test('operation-level security overrides the document default, and an empty array means none', () => {
  const model = normalise({
    openapi: '3.1.0',
    security: [{ bearerAuth: ['read'] }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    paths: {
      '/open': { get: { security: [], responses: {} } },
      '/closed': { get: { responses: {} } },
    },
  }, 'sec');
  const open = model.operations.find((o) => o.path === '/open');
  const closed = model.operations.find((o) => o.path === '/closed');
  assert.deepEqual(open.security, []);
  assert.deepEqual(closed.scopes, ['read']);
});
