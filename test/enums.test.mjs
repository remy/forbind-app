import test from 'node:test';
import assert from 'node:assert/strict';

import { enumValues } from '../js/lib/enums.js';
import { normalise } from '../js/lib/openapi.js';
import { sampleValue } from '../js/lib/request.js';

const doc = {
  components: {
    schemas: {
      FieldName: {
        description: 'A metadata field.',
        type: 'string',
        enum: ['title', 'artist', 'albumartist', 'album', 'genre'],
      },
      Described: {
        allOf: [{ $ref: '#/components/schemas/FieldName' }, { description: 'Which field to sort on.' }],
      },
      Nullable: {
        oneOf: [{ $ref: '#/components/schemas/FieldName' }, { type: 'null' }],
      },
      Ambiguous: {
        oneOf: [
          { type: 'string', enum: ['a', 'b'] },
          { type: 'string', enum: ['c', 'd'] },
        ],
      },
    },
  },
};

test('an enum written in place is found', () => {
  assert.deepEqual(enumValues(doc, { type: 'string', enum: ['on', 'off'] }), ['on', 'off']);
});

test('an enum behind a $ref is found, which is how documents usually name one', () => {
  assert.deepEqual(
    enumValues(doc, { $ref: '#/components/schemas/FieldName' }),
    ['title', 'artist', 'albumartist', 'album', 'genre'],
  );
});

test('an allOf wrapper that only adds prose does not hide the values', () => {
  assert.deepEqual(enumValues(doc, { $ref: '#/components/schemas/Described' }).slice(0, 2), ['title', 'artist']);
});

test('a nullable enum still offers its values', () => {
  assert.equal(enumValues(doc, { $ref: '#/components/schemas/Nullable' }).length, 5);
});

test('a field with no fixed set of values stays a text field', () => {
  assert.equal(enumValues(doc, { type: 'string' }), null);
  assert.equal(enumValues(doc, {}), null);
  assert.equal(enumValues(doc, null), null);
  // An array of enums wants a multi-select, which is not what this decides.
  assert.equal(enumValues(doc, { type: 'array', items: { $ref: '#/components/schemas/FieldName' } }), null);
  // Two branches with different sets is not a choice to make on the reader's
  // behalf.
  assert.equal(enumValues(doc, { $ref: '#/components/schemas/Ambiguous' }), null);
});

test('values a dropdown cannot carry are dropped, and duplicates collapse', () => {
  assert.deepEqual(enumValues({}, { enum: ['a', null, { x: 1 }, 'a', 2] }), ['a', '2']);
  assert.equal(enumValues({}, { enum: [null] }), null);
});

test('a $ref enum parameter still names its values in the notes and seeds a real one', () => {
  const model = normalise({
    openapi: '3.1.0',
    servers: [{ url: 'https://api.example.com' }],
    components: doc.components,
    paths: {
      '/tracks': {
        get: {
          parameters: [{ name: 'sort', in: 'query', required: true, schema: { $ref: '#/components/schemas/FieldName' } }],
          responses: {},
        },
      },
    },
  }, 'enums');
  const param = model.operations[0].parameters[0];
  assert.match(param.constraints.join(' '), /one of 5: title, artist, albumartist/);
  // The value the dropdown opens on is one the document allows.
  assert.ok(enumValues(model.doc, param.schema).includes(String(sampleValue(model.doc, param.schema))));
});

test('the prose half of an allOf wrapper does not end up in the type label', () => {
  const model = normalise({
    openapi: '3.1.0',
    components: doc.components,
    paths: {
      '/tracks': {
        get: {
          parameters: [{
            name: 'group',
            in: 'query',
            schema: {
              allOf: [{ $ref: '#/components/schemas/FieldName' }, { description: 'Which field to group by.' }],
            },
          }],
          responses: {},
        },
      },
    },
  }, 'described');
  // Not "FieldName & any": the member carrying only a description describes
  // no type, so it names nothing.
  assert.equal(model.operations[0].parameters[0].type.label, 'FieldName');
});
