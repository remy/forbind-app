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
 */

import { AwElement, define } from '../lib/element.js';
import { el, replace, uid } from '../lib/dom.js';
import { announce } from '../lib/announce.js';
import { buildRequest, sampleValue } from '../lib/request.js';
import { statusClass } from '../lib/openapi.js';

/** Verbs that change something and deserve a word of warning first. */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

class AwTryIt extends AwElement {
  static observes = ['schema', 'auth'];

  /** @type {object|null} */
  operation = null;

  /** { path: {}, query: {}, header: {}, body: string } */
  #values = { path: {}, query: {}, header: {}, body: '' };
  #result = null;
  #sending = false;
  #operationId = null;

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
    }

    const op = this.operation;
    const baseId = uid('try');
    const preview = this.#preview(state);

    const params = op.parameters.filter((p) => p.in !== 'cookie');
    const authRequired = op.security.length > 0;
    const haveCredential = Boolean(state.auth.credential) && op.security.some((s) => s.schemeId === state.auth.schemeId);

    replace(this, [
      MUTATING.has(op.method)
        ? el('p', { class: 'tryit__warning' }, [
            el('span', { class: 'word word--warn', text: 'LIVE' }),
            el('span', {
              text: `This sends a real ${op.method} to ${preview.host || 'the declared server'}. It is not a sandbox — whatever it changes, stays changed.`,
            }),
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

      el('div', { class: 'tryit__fields' }, [
        ...params.map((param) => this.#fieldFor(baseId, param)),
        op.requestBody ? this.#bodyField(baseId, state, op) : null,
      ]),

      el('div', { class: 'tryit__actions' }, [
        el('button', {
          type: 'button',
          class: 'btn btn--filled btn--lg',
          text: this.#sending ? 'Sending…' : `Send ${op.method}`,
          'aria-disabled': this.#sending ? 'true' : null,
          onclick: () => this.send(),
        }),
        el('button', {
          type: 'button',
          class: 'btn btn--lg',
          text: 'Reset',
          onclick: () => {
            this.#values = { path: {}, query: {}, header: {}, body: '' };
            this.#result = null;
            this.render(this.state);
            announce('Try-it fields reset.');
          },
        }),
        el('span', { class: 'tryit__status', text: preview.url }),
      ]),

      this.#result ? this.#renderResult(this.#result) : null,
    ]);
  }

  #preview(state) {
    try {
      const request = buildRequest({
        model: state.schema,
        operation: this.operation,
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

  #fieldFor(baseId, param) {
    const id = `${baseId}-${param.in}-${param.name}`;
    const hintId = `${id}-hint`;
    const hint = [param.type.label, param.required ? 'required' : 'optional', ...param.constraints, param.description]
      .filter(Boolean)
      .join(' · ');
    const placeholder = param.in === 'path' ? `{${param.name}}` : String(sampleValue(this.state.schema.doc, param.schema ?? {}) ?? '');

    return el('div', { class: 'field-row' }, [
      el('label', { for: id }, [
        el('span', { text: param.name }),
        el('span', { class: 'visually-hidden', text: ` (${param.in} parameter)` }),
      ]),
      el('input', {
        id,
        type: 'text',
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: placeholder === 'string' ? '' : placeholder,
        'aria-describedby': hintId,
        required: param.required ? 'required' : null,
        '.value': this.#values[param.in]?.[param.name] ?? '',
        oninput: (event) => {
          this.#values[param.in] ??= {};
          this.#values[param.in][param.name] = event.target.value;
          this.#updatePreview();
        },
      }),
      el('p', { class: 'hint', id: hintId, text: hint }),
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

  async send() {
    if (this.#sending || !this.operation) return;
    const state = this.state;
    const built = buildRequest({
      model: state.schema,
      operation: this.operation,
      auth: state.auth,
      values: this.#values,
      revealCredential: true,
    });

    if (!built.url || built.url.startsWith('/')) {
      this.#result = {
        kind: 'error',
        title: 'No server to send to',
        detail: 'This schema declares no server URL, so there is no host to send the request to. Add one to the document, or use the snippet with a base URL of your own.',
      };
      this.render(this.state);
      announce('Cannot send: this schema declares no server URL.', { assertive: true });
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
      this.#result = this.#explainFailure(error, built, elapsed);
      announce(`Request failed: ${this.#result.title}.`, { assertive: true });
    } finally {
      clearTimeout(timeout);
      this.#sending = false;
      this.render(this.state);
      this.querySelector('.result')?.focus();
    }
  }

  /**
   * `fetch` deliberately hides why a cross-origin request failed, so this is
   * the one place in the app that has to reason about a black box. It says
   * what the two possibilities are and how to tell them apart, rather than
   * asserting one.
   */
  #explainFailure(error, built, elapsed) {
    if (error?.name === 'AbortError') {
      return {
        kind: 'error',
        title: 'Timed out after 30 seconds',
        detail: 'The host accepted the connection but did not answer in time.',
        elapsed,
      };
    }
    let host = built.url;
    try { host = new URL(built.url).host; } catch { /* keep the raw string */ }
    return {
      kind: 'error',
      title: 'The browser could not read the response',
      detail:
        `Nothing came back that this page is allowed to see. There are only two ways that happens: ` +
        `${host} is unreachable, or it answered without an \`Access-Control-Allow-Origin\` header that permits this origin — ` +
        `a browser will not hand a cross-origin response to a page without one, whatever the status code was.`,
      hint:
        'The request may well have arrived and succeeded; the browser is refusing to show you the answer, not the server refusing to act. ' +
        'Your browser’s network panel will show the real status. To make this work from here, the API needs to send CORS headers for this origin — ' +
        'allyway does not proxy real requests, so that the credential never leaves your machine.',
      elapsed,
    };
  }

  #renderResult(result) {
    if (result.kind === 'error') {
      return el('div', { class: 'result result--error', tabindex: '-1', role: 'group', 'aria-label': 'Request result' }, [
        el('div', { class: 'result__head' }, [
          el('span', { class: 'word word--fail', text: 'FAILED' }),
          el('span', { text: result.title }),
          result.elapsed !== undefined ? el('span', { text: `${result.elapsed} ms` }) : null,
        ]),
        el('div', { class: 'result__body' }, [
          el('p', { class: 'result__note', text: result.detail }),
          result.hint ? el('p', { class: 'result__note', text: result.hint }) : null,
        ]),
      ]);
    }

    const klass = statusClass(String(result.status));
    return el('div', { class: 'result', tabindex: '-1', role: 'group', 'aria-label': 'Request result' }, [
      el('div', { class: 'result__head' }, [
        el('span', { class: `response-chip pill--${klass}`, text: `${result.status} ${result.statusText}`.trim() }),
        el('span', { text: `${result.elapsed} ms` }),
        el('span', { text: formatBytes(result.bytes) }),
      ]),
      el('div', { class: 'result__body' }, [
        ...result.warnings.map((warning) => el('p', { class: 'result__note', text: warning })),
        el('div', { class: 'result__section' }, [
          el('h4', { class: 'label', text: 'Body' }),
          el('pre', { class: 'code-block', tabindex: '0', text: prettify(result.body, result.contentType) || '(empty)' }),
        ]),
        el('div', { class: 'result__section' }, [
          el('h4', { class: 'label', text: `Response headers — ${result.headers.length} readable` }),
          result.headers.length
            ? el('dl', { class: 'kv' }, result.headers.map(([name, value]) =>
                el('div', {}, [el('dt', { text: name }), el('dd', { text: value })]),
              ))
            : el('p', { class: 'result__note', text: 'None readable.' }),
          el('p', {
            class: 'result__note',
            text: 'A browser only exposes a handful of response headers cross-origin unless the server lists more in `Access-Control-Expose-Headers`, so this is what is readable from here, not everything that was sent.',
          }),
        ]),
      ]),
    ]);
  }
}

function prettify(text, contentType) {
  if (!contentType.includes('json')) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

define('aw-try-it', AwTryIt);
