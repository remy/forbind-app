/**
 * The fields inside the try-it form.
 *
 * Split out of `aw-try-it.js`, which owns the panel — what has been typed,
 * what is being sent, and what came back. This file owns one row of that form
 * at a time: the control a parameter deserves, the hint and prose and error
 * wired to it by id, and the two places a value is drafted from the schema so
 * the form never contradicts the snippet above it.
 *
 * Everything here is a function over `ctx`, the panel's own working state
 * passed by reference — `values` and `errors` are the panel's objects, not
 * copies, so a keystroke lands where the sender will look for it.
 *
 * @typedef {object} FieldContext
 * @property {string} baseId          prefix for every id this form mints
 * @property {object} doc             the raw OpenAPI document
 * @property {object} values          `{ path, query, header, body }`, mutated in place
 * @property {Record<string, string>} errors  keyed `${in}:${name}`
 * @property {HTMLElement} root       the panel, for reaching an error node
 * @property {() => void} onEdit      called after every keystroke
 */

import { el } from '../lib/dom.js';
import { sampleValue, parameterExample } from '../lib/request.js';
import { enumValues } from '../lib/enums.js';
import { markdownBlock } from '../lib/markdown.js';

/**
 * The values a parameter is allowed to take, if the schema says.
 *
 * Resolved through `$ref` and `allOf`, because a named enum pointed at from
 * the parameter is the same promise as one written out in place — and a field
 * with a fixed set of values should be a dropdown either way.
 */
export function enumFor(doc, param) {
  return enumValues(doc ?? {}, param.schema ?? {});
}

/**
 * A required dropdown has to open on something, and the honest something is
 * whatever the request builder would have used anyway — the schema's own
 * `example` where it gives one, its first allowed value otherwise. Anything
 * else and the form would contradict the curl block sitting above it.
 *
 * Optional parameters are left alone: "not sent" is what optional means, and
 * it is what the builder does with them.
 */
export function seedDefaults(doc, op, values) {
  for (const param of op.parameters) {
    if (!param.required || param.in === 'cookie') continue;
    if (values[param.in]?.[param.name]) continue;
    const options = enumFor(doc, param);
    if (!options) continue;
    const suggested = parameterExample(doc, param);
    values[param.in] ??= {};
    values[param.in][param.name] = options.includes(suggested) ? suggested : options[0];
  }
}

/** The body the panel opens on, drafted from the schema. Asked for once. */
export function draftBody(doc, op) {
  const sample = op.requestBody.example ?? sampleValue(doc, op.requestBody.schema ?? {});
  return op.requestBody.contentType?.includes('json')
    ? JSON.stringify(sample, null, 2)
    : String(sample ?? '');
}

/**
 * One parameter, as a labelled control with its facts, its prose and — while
 * there is one — the complaint about it.
 *
 * @param {object} param
 * @param {FieldContext} ctx
 */
export function fieldFor(param, ctx) {
  const { baseId, doc, values, errors } = ctx;
  const id = `${baseId}-${param.in}-${param.name}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const key = `${param.in}:${param.name}`;
  const error = errors[key] ?? null;
  const options = enumFor(doc, param);
  const current = values[param.in]?.[param.name] ?? '';

  // When the values are a dropdown, listing them in the hint as well is just
  // the same information twice.
  const constraints = options
    ? param.constraints.filter((note) => !note.startsWith('one of'))
    : param.constraints;
  // Two things, not one line. The facts about the field stay terse and
  // `·`-joined; the description is prose the document wrote in markdown —
  // often a table of what the field accepts — and it gets the room to be
  // that, because flattened into the facts line it is unreadable.
  const facts = [param.type.label, param.required ? 'required' : 'optional', ...constraints]
    .filter(Boolean)
    .join(' · ');
  const prose = markdownBlock(param.description, { class: 'hint hint--prose' });
  const proseId = `${id}-desc`;
  if (prose) prose.id = proseId;

  const describedBy = [hintId, prose ? proseId : null, error ? errorId : null].filter(Boolean).join(' ');

  const onChange = (event) => {
    values[param.in] ??= {};
    values[param.in][param.name] = event.target.value;
    if (errors[key]) {
      delete errors[key];
      event.target.removeAttribute('aria-invalid');
      ctx.root.querySelector(`#${CSS.escape(errorId)}`)?.remove();
      event.target.setAttribute('aria-describedby', [hintId, prose ? proseId : null].filter(Boolean).join(' '));
    }
    ctx.onEdit();
  };

  let control;
  if (options) {
    control = el('select', {
      id,
      'aria-describedby': describedBy,
      'aria-invalid': error ? 'true' : null,
      onchange: onChange,
    }, [
      // An optional parameter has to be able to stay unsent, so the empty
      // choice is a real one and is named rather than left blank.
      param.required ? null : el('option', { value: '', text: '— not sent —' }),
      ...options.map((value) => el('option', { value, text: value })),
    ]);
    // seedDefaults has already put a required parameter's value in place.
    control.value = current;
  } else {
    const placeholder = param.in === 'path'
      ? `{${param.name}}`
      : String(sampleValue(doc, param.schema ?? {}) ?? '');
    control = el('input', {
      id,
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: placeholder === 'string' ? '' : placeholder,
      'aria-describedby': describedBy,
      'aria-invalid': error ? 'true' : null,
      'aria-required': param.required ? 'true' : null,
      '.value': current,
      oninput: onChange,
    });
  }

  return el('div', { class: 'field-row' }, [
    el('label', { for: id }, [
      el('span', { text: param.name }),
      el('span', { class: 'visually-hidden', text: ` (${param.in} parameter)` }),
    ]),
    control,
    el('p', { class: 'hint', id: hintId, text: facts }),
    prose,
    error ? el('p', { class: 'hint hint--error', id: errorId }, [
      el('span', { class: 'word word--fail', text: 'NEEDED' }),
      el('span', { text: ` ${error}` }),
    ]) : null,
  ]);
}

/**
 * The request body, as a textarea holding whatever the panel has drafted or
 * the reader has since written.
 *
 * @param {object} op
 * @param {FieldContext} ctx
 */
export function bodyField(op, ctx) {
  const id = `${ctx.baseId}-body`;
  const hintId = `${id}-hint`;
  return el('div', { class: 'field-row' }, [
    el('label', { for: id, text: 'Request body' }),
    el('textarea', {
      id,
      spellcheck: 'false',
      'aria-describedby': hintId,
      '.value': ctx.values.body,
      oninput: (event) => {
        ctx.values.body = event.target.value;
        ctx.onEdit();
      },
    }),
    el('p', {
      class: 'hint',
      id: hintId,
      text: `${op.requestBody.contentType ?? 'application/json'} · drafted from the schema, edit freely`,
    }),
  ]);
}
