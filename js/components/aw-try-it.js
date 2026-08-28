/**
 * Try it: build a request, send it, read the answer.
 *
 * The request goes straight from the browser to whatever host the schema
 * declares. There is no proxy, by design — a proxy would mean the credential
 * passing through allyway's server, which is exactly what the auth sheet
 * promises does not happen. The cost of that decision is CORS: a browser
 * cannot read a cross-origin response unless the API says it may. So when a
 * request fails that way, the panel says so in those words instead of showing
 * a shrug.
 *
 * The other thing that can be missing is the host itself: a document with no
 * `servers` block describes a path and nothing to put in front of it. That is
 * asked for here, in the panel, rather than only failing at send time — the
 * field appears above the parameters, because it is the first thing the
 * request needs and the reader is the only one who knows it.
 */

import { AwElement, define } from '../lib/element.js';
import { el, replace, uid } from '../lib/dom.js';
import { announce } from '../lib/announce.js';
import { buildRequest, sampleValue, parameterExample } from '../lib/request.js';
import { explainFailure, renderResult, formatBytes } from './tryit-result.js';
import { enumValues } from '../lib/enums.js';
import { markdownBlock } from '../lib/markdown.js';

/** Verbs that change something and deserve a word of warning first. */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The LIVE warning, which names the host the request is actually going to. */
function liveSentence(op, host) {
  return `This sends a real ${op.method} to ${host || 'the declared server'}. `
    + 'It is not a sandbox — whatever it changes, stays changed.';
}

class AwTryIt extends AwElement {
  static observes = ['schema', 'auth', 'baseUrl'];

  /** @type {object|null} */
  operation = null;

  /** { path: {}, query: {}, header: {}, body: string } */
  #values = { path: {}, query: {}, header: {}, body: '' };
  #result = null;
  #sending = false;
  #operationId = null;
  /** Keyed `${in}:${name}` — a required field that was left empty. */
  #errors = {};

  render(state) {
    if (!this.operation) {
      replace(this, []);
      return;
    }
    // A different operation means the entered values belong to the old one.
    if (this.#operationId !== this.operation.id) {
      this.#operationId = this.operation.id;
      this.#values = { path: {}, query: {}, header: {}, body: '' };
      this.#result = null;
      this.#errors = {};
    }

    const op = this.operation;
    const baseId = uid('try');
    // Seed before the preview is computed, so the URL under the button, the
    // curl block above it, and the dropdowns all say the same thing.
    this.#seedDefaults(state, op);
    const preview = this.#preview(state);

    const params = op.parameters.filter((p) => p.in !== 'cookie');
    const authRequired = op.security.length > 0;
    const haveCredential = Boolean(state.auth.credential) && op.security.some((s) => s.schemeId === state.auth.schemeId);

    // Built rather than declared so the operation reaches it: an operation
    // with its own `servers` needs nothing here even when the document does.
    const baseUrlField = el('aw-base-url', { variant: 'inline', '.operation': op });

    replace(this, [
      baseUrlField,

      MUTATING.has(op.method)
        ? el('p', { class: 'tryit__warning' }, [
            el('span', { class: 'word word--warn', text: 'LIVE' }),
            el('span', { dataset: { liveWarning: '' }, text: liveSentence(op, preview.host) }),
          ])
        : null,

      authRequired && !haveCredential
        ? el('p', { class: 'tryit__warning' }, [
            el('span', { class: 'word word--warn', text: 'NO TOKEN' }),
            el('span', {}, [
              el('span', { text: 'This operation declares a security scheme and no credential is set, so it will be sent unauthenticated. ' }),
              el('button', {
                type: 'button',
                class: 'link-quiet',
                text: 'Set one up',
                onclick: () => this.actions.openAuth(),
              }),
            ]),
          ])
        : null,

      // A real <form>, so Enter in any field sends the request — that is what
      // Enter means in a form, and reimplementing it per input would only get
      // it wrong somewhere. `novalidate` because the browser's own bubble is
      // easy to miss and gone in a moment; the check below announces instead,
      // and moves focus to the field it is talking about.
      el('form', {
        class: 'tryit__form',
        novalidate: true,
        onsubmit: (event) => {
          event.preventDefault();
          this.send();
        },
      }, [
        el('div', { class: 'tryit__fields' }, [
          ...params.map((param) => this.#fieldFor(baseId, param)),
          op.requestBody ? this.#bodyField(baseId, state, op) : null,
        ]),

        el('div', { class: 'tryit__actions' }, [
          el('button', {
            type: 'submit',
            class: 'btn btn--filled btn--lg',
            text: this.#sending ? 'Sending…' : `Send ${op.method}`,
            'aria-disabled': this.#sending ? 'true' : null,
          }),
          el('button', {
            type: 'button',
            class: 'btn btn--lg',
            text: 'Reset',
            onclick: () => {
              this.#values = { path: {}, query: {}, header: {}, body: '' };
              this.#result = null;
              this.#errors = {};
              this.render(this.state);
              announce('Try-it fields reset.');
            },
          }),
          el('span', { class: 'tryit__status', text: preview.url }),
        ]),
      ]),

      this.#result ? renderResult(this.#result) : null,
    ]);
  }

  /**
   * A base URL arrives while the keyboard is standing in the field that set
   * it, so the panel patches the two things it changes — the URL under the
   * Send button and the host in the LIVE warning — rather than rebuilding the
   * form around the focused input.
   */
  update(state, prev) {
    const onlyBaseUrl = !Object.is(state.baseUrl, prev.baseUrl)
      && Object.is(state.schema, prev.schema)
      && Object.is(state.auth, prev.auth);
    if (!onlyBaseUrl || !this.operation) {
      this.render(state, prev);
      return;
    }
    const preview = this.#preview(state);
    const status = this.querySelector('.tryit__status');
    if (status) status.textContent = preview.url;
    const live = this.querySelector('[data-live-warning]');
    if (live) live.textContent = liveSentence(this.operation, preview.host);
  }

  #preview(state) {
    try {
      const request = buildRequest({
        model: state.schema,
        operation: this.operation,
        serverUrl: state.baseUrl,
        auth: state.auth,
        values: this.#values,
        revealCredential: true,
      });
      let host = '';
      try { host = new URL(request.url).host; } catch { host = ''; }
      return { url: request.url, host, request };
    } catch {
      return { url: '', host: '', request: null };
    }
  }

  /**
   * The values a parameter is allowed to take, if the schema says.
   *
   * Resolved through `$ref` and `allOf`, because a named enum pointed at from
   * the parameter is the same promise as one written out in place — and a
   * field with a fixed set of values should be a dropdown either way.
   */
  #enumFor(param) {
    return enumValues(this.state.schema?.doc ?? {}, param.schema ?? {});
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
  #seedDefaults(state, op) {
    const doc = state.schema?.doc ?? {};
    for (const param of op.parameters) {
      if (!param.required || param.in === 'cookie') continue;
      if (this.#values[param.in]?.[param.name]) continue;
      const options = this.#enumFor(param);
      if (!options) continue;
      const suggested = parameterExample(doc, param);
      this.#values[param.in] ??= {};
      this.#values[param.in][param.name] = options.includes(suggested) ? suggested : options[0];
    }
  }

  #fieldFor(baseId, param) {
    const id = `${baseId}-${param.in}-${param.name}`;
    const hintId = `${id}-hint`;
    const errorId = `${id}-error`;
    const key = `${param.in}:${param.name}`;
    const error = this.#errors[key] ?? null;
    const options = this.#enumFor(param);
    const current = this.#values[param.in]?.[param.name] ?? '';

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
      this.#values[param.in] ??= {};
      this.#values[param.in][param.name] = event.target.value;
      if (this.#errors[key]) {
        delete this.#errors[key];
        event.target.removeAttribute('aria-invalid');
        this.querySelector(`#${CSS.escape(errorId)}`)?.remove();
        event.target.setAttribute('aria-describedby', [hintId, prose ? proseId : null].filter(Boolean).join(' '));
      }
      this.#updatePreview();
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
      // #seedDefaults has already put a required parameter's value in place.
      control.value = current;
    } else {
      const placeholder = param.in === 'path'
        ? `{${param.name}}`
        : String(sampleValue(this.state.schema.doc, param.schema ?? {}) ?? '');
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

  #bodyField(baseId, state, op) {
    const id = `${baseId}-body`;
    const hintId = `${id}-hint`;
    if (this.#values.body === '') {
      const sample = op.requestBody.example ?? sampleValue(state.schema.doc, op.requestBody.schema ?? {});
      this.#values.body = op.requestBody.contentType?.includes('json')
        ? JSON.stringify(sample, null, 2)
        : String(sample ?? '');
    }
    return el('div', { class: 'field-row' }, [
      el('label', { for: id, text: 'Request body' }),
      el('textarea', {
        id,
        spellcheck: 'false',
        'aria-describedby': hintId,
        '.value': this.#values.body,
        oninput: (event) => {
          this.#values.body = event.target.value;
          this.#updatePreview();
        },
      }),
      el('p', {
        class: 'hint',
        id: hintId,
        text: `${op.requestBody.contentType ?? 'application/json'} · drafted from the schema, edit freely`,
      }),
    ]);
  }

  /** Keep the URL preview honest without re-rendering the fields under the cursor. */
  #updatePreview() {
    const status = this.querySelector('.tryit__status');
    if (status) status.textContent = this.#preview(this.state).url;
  }

  /* --- sending ---------------------------------------------------------- */

  /**
   * Stop only where the request would be nonsense.
   *
   * An empty required field is not automatically a problem: the builder falls
   * back to whatever the schema offers as an example, and the curl block above
   * is already showing that value. What cannot be sent is a parameter with no
   * value and nothing to fall back on — the URL would carry the literal
   * `{bookingId}` from the path template. So the test is what the builder
   * would actually produce, which keeps the snippet and the sender agreeing.
   *
   * @returns {boolean} true if the request is worth sending
   */
  #validate() {
    this.#errors = {};
    const doc = this.state.schema?.doc ?? {};
    for (const param of this.operation.parameters) {
      if (!param.required || param.in === 'cookie') continue;
      const value = this.#values[param.in]?.[param.name];
      if (value !== undefined && String(value).trim() !== '') continue;
      if (parameterExample(doc, param) !== `{${param.name}}`) continue;
      this.#errors[`${param.in}:${param.name}`] =
        `${param.name} needs a value — the schema offers no example to fall back on.`;
    }
    const missing = Object.keys(this.#errors);
    if (!missing.length) return true;

    this.render(this.state);
    const names = missing.map((key) => key.split(':')[1]);
    announce(
      names.length === 1
        ? `Cannot send: ${names[0]} is required.`
        : `Cannot send: ${names.length} required parameters are empty — ${names.join(', ')}.`,
      { assertive: true },
    );
    this.querySelector('[aria-invalid="true"]')?.focus();
    return false;
  }

  async send() {
    if (this.#sending || !this.operation) return;
    if (!this.#validate()) return;
    const state = this.state;
    const built = buildRequest({
      model: state.schema,
      operation: this.operation,
      serverUrl: state.baseUrl,
      auth: state.auth,
      values: this.#values,
      revealCredential: true,
    });

    if (!built.url || built.url.startsWith('/')) {
      this.#result = {
        kind: 'error',
        title: 'No server to send to',
        detail: 'There is no host in front of this path, so the request has nowhere to go. The base URL field above this form takes one — or copy the snippet and supply a base URL of your own.',
      };
      this.render(this.state);
      announce('Cannot send: no base URL. Set one in the field above the form.', { assertive: true });
      this.querySelector('aw-base-url input')?.focus();
      return;
    }

    this.#sending = true;
    this.#result = null;
    this.render(this.state);
    announce(`Sending ${built.method} to ${built.url}.`);

    const started = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(built.url, {
        method: built.method,
        headers: Object.fromEntries(built.headers),
        body: built.body ?? undefined,
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
      });
      const elapsed = Math.round(performance.now() - started);
      const text = await response.text();
      const headers = [...response.headers.entries()];
      this.#result = {
        kind: 'response',
        status: response.status,
        statusText: response.statusText,
        elapsed,
        bytes: new Blob([text]).size,
        headers,
        body: text,
        contentType: response.headers.get('content-type') ?? '',
        warnings: built.warnings,
      };
      announce(`${response.status} ${response.statusText} in ${elapsed} milliseconds, ${formatBytes(this.#result.bytes)}.`);
    } catch (error) {
      const elapsed = Math.round(performance.now() - started);
      this.#result = explainFailure(error, built, elapsed);
      announce(`Request failed: ${this.#result.title}.`, { assertive: true });
    } finally {
      clearTimeout(timeout);
      this.#sending = false;
      this.render(this.state);
      this.querySelector('.result')?.focus();
    }
  }

}

define('aw-try-it', AwTryIt);
