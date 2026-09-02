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
 *
 * The rows of the form itself are in `tryit-fields.js`; this file owns the
 * panel around them — what has been typed, what is being sent, what came back.
 */

import { AwElement, define } from '../lib/element.js';
import { el, replace, uid } from '../lib/dom.js';
import { announce } from '../lib/announce.js';
import { buildRequest, parameterExample } from '../lib/request.js';
import { explainFailure, renderResult, formatBytes } from './tryit-result.js';
import { confirmMutation, MUTATING } from './tryit-confirm.js';
import { bodyField, draftBody, fieldFor, seedDefaults } from './tryit-fields.js';

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
  /**
   * Whether the body has been drafted from the schema yet. Seeding on "the
   * box is empty" would put the draft back every time the panel re-rendered,
   * which makes deleting a body a thing you cannot do.
   */
  #bodyDrafted = false;
  /** The base URL field, kept so a half-typed host survives a re-render. */
  #baseUrlField = null;

  /** Back to an untouched form: a different operation, or the Reset button. */
  #clear() {
    this.#values = { path: {}, query: {}, header: {}, body: '' };
    this.#result = null;
    this.#errors = {};
    this.#bodyDrafted = false;
  }

  render(state) {
    if (!this.operation) {
      replace(this, []);
      return;
    }
    // A different operation means the entered values belong to the old one.
    if (this.#operationId !== this.operation.id) {
      this.#operationId = this.operation.id;
      this.#clear();
      // The next operation gets a fresh field — that is aw-base-url's own
      // rule, and by then the question has usually been answered. Reset does
      // not do this: a base URL is not one of the fields it empties.
      this.#baseUrlField = null;
    }

    const op = this.operation;
    const doc = state.schema?.doc ?? {};
    const baseId = uid('try');
    // Seed before the preview is computed, so the URL under the button, the
    // curl block above it, and the dropdowns all say the same thing.
    seedDefaults(doc, op, this.#values);
    // Drafted once. An emptied box after that is an edit, not an absence.
    if (op.requestBody && !this.#bodyDrafted) {
      this.#values.body = draftBody(doc, op);
      this.#bodyDrafted = true;
    }
    const ctx = {
      baseId,
      doc,
      values: this.#values,
      errors: this.#errors,
      root: this,
      onEdit: () => this.#updatePreview(),
    };
    const preview = this.#preview(state);

    const params = op.parameters.filter((p) => p.in !== 'cookie');
    const authRequired = op.security.length > 0;
    const haveCredential = Boolean(state.auth.credential) && op.security.some((s) => s.schemeId === state.auth.schemeId);

    // Built rather than declared so the operation reaches it: an operation
    // with its own `servers` needs nothing here even when the document does.
    // Kept, like this panel is, so a host typed but not yet applied is still
    // there after a trip to another tab.
    this.#baseUrlField ??= el('aw-base-url', { variant: 'inline' });
    this.#baseUrlField.operation = op;

    replace(this, [
      this.#baseUrlField,

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
              el('span', { text: 'This operation asks for a credential and none is set. The request will go unauthenticated. ' }),
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
          ...params.map((param) => fieldFor(param, ctx)),
          op.requestBody ? bodyField(op, ctx) : null,
        ]),

        el('div', { class: 'tryit__actions' }, [
          el('button', {
            type: 'submit',
            class: 'btn btn--filled btn--lg',
            // The confirmation dialog hands focus back here, and the panel
            // will have re-rendered by then, so the button is findable by key
            // rather than by identity.
            dataset: { focusKey: 'tryit-send' },
            text: this.#sending ? 'Sending…' : `Send ${op.method}`,
            'aria-disabled': this.#sending ? 'true' : null,
          }),
          el('button', {
            type: 'button',
            class: 'btn btn--lg',
            text: 'Reset',
            onclick: () => {
              this.#clear();
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
    // Emptied in place: the form's fields hold a reference to this object.
    for (const stale of Object.keys(this.#errors)) delete this.#errors[stale];
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

    // A mutating verb is not undoable from here, and 3.3.6 asks for a
    // reversal, a check, or a confirmation before a submission like that. Only
    // the third is available to a client that does not own the API.
    if (MUTATING.has(this.operation.method)) {
      const sendButton = this.querySelector('[data-focus-key="tryit-send"]');
      if (!await confirmMutation(built, sendButton)) {
        announce('Nothing sent.');
        return;
      }
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
      this.#showResult();
    }
  }

  /**
   * Land on the status line, and no further.
   *
   * `focus()` scrolls its target into view on its own, and what "into view"
   * means for a box taller than the pane is the browser's business — a
   * forty-thousand-pixel response body can leave the reader somewhere in the
   * middle of it, past the one line that says whether the request worked. So
   * the scroll is taken over: focus lands on the result without moving
   * anything, and the head — a short row that cannot overshoot — is brought to
   * the top instead.
   *
   * Deliberately not smooth. A response renders in one go but the browser is
   * still laying out a very long `<pre>` behind it, and an animation running
   * across that is an animation that can be left somewhere in the middle.
   */
  #showResult() {
    const result = this.querySelector('.result');
    if (!result) return;
    result.focus({ preventScroll: true });
    const head = result.querySelector('.result__head') ?? result;
    head.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

}

define('aw-try-it', AwTryIt);
