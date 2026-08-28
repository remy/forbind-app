/**
 * Fields, and the two places they are read.
 *
 * A parameter list, a request body and a component schema are all the same
 * thing on screen — a set of named fields with a type, a required flag and
 * notes — so they are drawn by one function here rather than three in the
 * detail pane. It lives beside `aw-detail.js` rather than inside it because
 * that file has enough subjects in it already.
 *
 * The table is a real `<table>` with `scope`d headers where there is room, and
 * a real `<dl>` of stacked rows where there is not. The switch is a media
 * query rather than CSS on the table: restyling a table to `display: block`
 * keeps the look and throws the semantics away, which is the wrong trade here.
 */

import { el } from '../lib/dom.js';
import { verbLabel, verbClass, fieldRows, describeType, describeConstraints, deref } from '../lib/openapi.js';
import { markdownBlock } from '../lib/markdown.js';

/**
 * The Notes cell: the constraints as they are, then the description as the
 * markdown it is. Inline, because a table cell is not the place for a heading
 * or a fenced block, and separated so a row with only one of the two does not
 * carry a dangling separator.
 *
 * @param {{notes?: string, description?: string}} row
 * @param {string} [separator]
 */
function noteCell(row, separator = ' — ') {
  const description = markdownBlock(row.description, { inline: true });
  return [
    row.notes ? el('span', { text: row.notes }) : null,
    row.notes && description ? el('span', { 'aria-hidden': 'true', text: separator }) : null,
    description,
  ].filter(Boolean);
}

/** A type that names a component schema is a link to it. */
export function typeCell(type, hashFor) {
  if (!type.ref) return el('span', { text: type.label });
  return el('a', { href: hashFor({ view: 'schema', id: type.ref }), text: type.label });
}

/**
 * @param {object} options
 * @param {string} options.caption       what the table is of, for the caption
 * @param {Array<{name: string, type: {label: string, ref: string|null}, required: boolean, notes?: string, description?: string, deprecated?: boolean}>} options.rows
 * @param {boolean} options.narrow       stack the rows instead of tabulating
 * @param {(target: object) => string} options.hashFor
 */
export function paramTable({ caption, rows, narrow, hashFor }) {
  if (narrow) {
    return el('dl', { class: 'params-stack' }, rows.map((row) => {
      const notes = noteCell(row, ' · ');
      return el('div', {}, [
        el('dt', { text: row.name }),
        el('dd', {}, [
          typeCell(row.type, hashFor),
          el('span', { 'aria-hidden': 'true', text: ' · ' }),
          el('span', { text: row.required ? 'required' : 'optional' }),
          notes.length ? el('span', { 'aria-hidden': 'true', text: ' · ' }) : null,
          ...notes,
          row.deprecated ? el('span', { text: ' · deprecated' }) : null,
        ]),
      ]);
    }));
  }

  return el('table', { class: 'params' }, [
    el('caption', { class: 'visually-hidden', text: caption }),
    el('colgroup', {}, [
      el('col', { class: 'c-field' }),
      el('col', { class: 'c-type' }),
      el('col', { class: 'c-req' }),
      el('col', { class: 'c-notes' }),
    ]),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Field' }),
        el('th', { scope: 'col', text: 'Type' }),
        el('th', { scope: 'col', text: 'Req' }),
        el('th', { scope: 'col', text: 'Notes' }),
      ]),
    ]),
    el('tbody', {}, rows.map((row) =>
      el('tr', {}, [
        el('th', { scope: 'row', text: row.name }),
        el('td', { class: 'col-type' }, [typeCell(row.type, hashFor)]),
        // A word, never a colour and never an asterisk.
        el('td', {}, [
          el('span', { class: row.required ? 'req-yes' : 'req-no', text: row.required ? 'yes' : 'no' }),
        ]),
        el('td', { class: 'col-notes' }, [
          ...noteCell(row),
          row.deprecated
            ? el('span', { text: row.notes || row.description ? ' — deprecated' : 'deprecated' })
            : null,
        ]),
      ]),
    )),
  ]);
}

/**
 * The component-schema view: one schema, its fields, and who calls it.
 *
 * @param {object} state
 * @param {object} options
 * @param {boolean} options.narrow
 * @param {(target: object) => string} options.hashFor
 * @returns {Node[]}
 */
export function renderSchemaView(state, { narrow, hashFor }) {
  const name = state.selectedSchemaName;
  const entry = state.schema.schemas.find((candidate) => candidate.name === name);
  if (!entry) {
    return [el('div', { class: 'detail__body' }, [
      el('h2', { class: 'empty__title', text: 'Schema not found' }),
      el('p', { class: 'empty__body', text: `This document declares no component schema called “${name}”.` }),
    ])];
  }

  const resolved = deref(state.schema.doc, entry.node).value;
  const rows = fieldRows(state.schema.doc, entry.node);
  const users = state.schema.operations.filter((op) =>
    op.requestBody?.schemaName === name || op.responses.some((r) => r.schemaName === name),
  );

  return [
    el('div', {}, [
      el('div', { class: 'detail__header' }, [
        el('div', { class: 'detail__title-row' }, [
          el('span', { class: 'chip chip--static', text: 'schema' }),
          el('h2', { class: 'detail__path', text: name }),
        ]),
        markdownBlock(resolved.description, { class: 'detail__lede' }),
        el('div', { class: 'detail__chips' }, [
          el('span', { class: 'chip chip--static', text: describeType(state.schema.doc, entry.node).label }),
          ...describeConstraints(resolved).map((note) => el('span', { class: 'chip chip--static', text: note })),
        ]),
      ]),
      el('div', { class: 'detail__body' }, [
        el('section', { class: 'detail__section' }, [
          el('h3', { class: 'label', text: 'Fields' }),
          rows.length
            ? paramTable({ caption: `${name} fields`, rows, narrow, hashFor })
            : el('p', { class: 'empty__body', text: 'This schema declares no named properties.' }),
        ]),
        users.length
          ? el('section', { class: 'detail__section' }, [
              el('h3', { class: 'label', text: `Used by ${users.length} ${users.length === 1 ? 'operation' : 'operations'}` }),
              el('ul', { class: 'response-list' }, users.map((op) =>
                el('li', {}, [
                  el('span', { class: `response-chip pill--${verbClass(op.method)}`, text: verbLabel(op.method) }),
                  el('a', { href: hashFor({ view: 'operation', id: op.id }), text: op.path }),
                  el('span', { text: op.summary }),
                ]),
              )),
            ])
          : null,
      ]),
    ]),
  ];
}
