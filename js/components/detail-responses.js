/**
 * The Responses section of the detail pane.
 *
 * Collapsed, a response is the row the design draws: a status chip, its phrase
 * and the shape of what comes back. Opened, it is what the response actually
 * contains — the body as a walkable set of fields, and an example built from
 * the same schema. Every 2xx starts open, because that is the one you came to
 * read; the rest wait to be asked for.
 *
 * Which of them are open is not this file's to remember. The set is owned by
 * `fb-detail` and passed in, because the section is rebuilt every time the
 * pane renders — a trip to the Code tab and back included — and a disclosure
 * you opened is an answer you gave, not a default to be restored over.
 *
 * It lives beside `fb-detail.js` rather than inside it because that file has
 * enough subjects in it already.
 */

import { el } from '../lib/dom.js';
import { statusClass, payloadChildren, describeType } from '../lib/openapi.js';
import { sampleValue } from '../lib/request.js';
import { markdownToText } from '../lib/markdown.js';
import { languageFor, highlightInto } from '../lib/highlight.js';

/**
 * The responses that are unfolded on arrival: the one success, when there is
 * exactly one. Two successes are a choice, and a choice is not made here.
 *
 * @param {object} op
 * @returns {Set<string>}
 */
export function defaultOpenResponses(op) {
  const success = op.responses.filter((r) => statusClass(r.code) === 'success');
  return new Set(success.length === 1 && success[0].schema ? [success[0].code] : []);
}

/**
 * @param {object} state
 * @param {object} op
 * @param {{hashFor: (target: object) => string, opened: Set<string>}} ctx
 */
export function renderResponses(state, op, ctx) {
  if (!op.responses.length) {
    return el('section', { class: 'detail__section', 'aria-label': 'Responses' }, [
      el('p', { class: 'empty__body', text: 'This operation declares no responses.' }),
    ]);
  }

  return el('section', { class: 'detail__section', 'aria-label': 'Responses' }, [
    el('ul', { class: 'response-list' }, op.responses.map((response) =>
      el('li', {}, [renderResponse(state, response, ctx)]),
    )),
  ]);
}

function renderResponse(state, response, ctx) {
  const klass = statusClass(response.code);
  const hasBody = Boolean(response.schema);
  const children = hasBody ? payloadChildren(state.schema.doc, response.schema) : null;
  const typeLabel = hasBody ? describeType(state.schema.doc, response.schema).label : '';

  let shape = 'no body';
  if (hasBody) {
    const count = children?.items.length ?? 0;
    if (!children) shape = typeLabel;
    else if (children.kind === 'variants') shape = `${typeLabel} · ${count} shapes`;
    else shape = `${typeLabel} · ${count} ${count === 1 ? 'field' : 'fields'}`;
  }

  const summaryLine = el('summary', { class: 'response-summary' }, [
    el('span', { class: `response-chip pill--${klass}`, text: response.code }),
    el('span', { class: 'response-summary__text', text: markdownToText(response.description) || '—' }),
    el('span', { class: 'response-summary__shape', text: shape }),
  ]);

  if (!hasBody) {
    // Nothing to open, so it is a row rather than a disclosure that does
    // nothing when you press it.
    return el('div', { class: 'response-row' }, [
      el('span', { class: `response-chip pill--${klass}`, text: response.code }),
      el('span', { class: 'response-summary__text', text: markdownToText(response.description) || '—' }),
      el('span', { class: 'response-summary__shape', text: shape }),
    ]);
  }

  const tree = el('fb-schema-tree', {});
  const label = `The ${response.code} response body`;
  const example = exampleFor(state.schema.doc, response);
  // Coloured from the same `Content-Type` the chip above names, exactly as a
  // live try-it result is — a documented example and a captured response are
  // the same kind of text and read the same once they're on screen.
  const exampleBlock = el('pre', { class: 'code-block', tabindex: '0' });
  if (example !== null) highlightInto(example, languageFor(response.contentType), exampleBlock);
  const open = ctx.opened.has(response.code);

  const wrapper = el('details', { class: 'response-detail', open: open ? true : null }, [
    summaryLine,
    el('div', { class: 'response-detail__body' }, [
      el('div', { class: 'response-detail__meta' }, [
        response.contentType
          ? el('span', { class: 'chip chip--static', text: response.contentType })
          : null,
        response.schemaName
          ? el('a', {
              href: ctx.hashFor({ view: 'schema', id: response.schemaName }),
              text: response.schemaName,
            })
          : null,
      ]),
      el('div', { class: 'detail__section' }, [
        el('h3', { class: 'label', text: 'Body' }),
        tree,
      ]),
      example !== null
        ? el('div', { class: 'detail__section' }, [
            el('h3', { class: 'label', text: 'Example' }),
            exampleBlock,
          ])
        : null,
    ]),
  ]);

  // A closed response does not pay to describe a payload nobody has asked to
  // see — and an operation can declare a dozen of them. Once described it
  // stays described; the tree is thrown away with the element, not reused.
  let described = false;
  const describe = () => {
    if (described) return;
    described = true;
    tree.describe(response.schema, label);
  };
  if (open) describe();
  wrapper.addEventListener('toggle', () => {
    if (wrapper.open) {
      ctx.opened.add(response.code);
      describe();
    } else {
      ctx.opened.delete(response.code);
    }
  });

  return wrapper;
}

/**
 * The example body: whatever the document offers, else one built from the
 * schema. Unlike a request draft this includes optional fields — a response
 * example is meant to show everything you might get back.
 *
 * A document-supplied example is already text when it is a string — an XML or
 * YAML body written into the spec that way — and `JSON.stringify`-ing that
 * would quote and escape it into something that is no longer the example. Only
 * a non-string value, doc-supplied or built from the schema, needs stringifying
 * at all.
 */
function exampleFor(doc, response) {
  if (response.example !== undefined) {
    return typeof response.example === 'string' ? response.example : JSON.stringify(response.example, null, 2);
  }
  if (!response.schema) return null;
  const value = sampleValue(doc, response.schema, { includeOptional: true });
  if (value === null || value === undefined) return null;
  return JSON.stringify(value, null, 2);
}
