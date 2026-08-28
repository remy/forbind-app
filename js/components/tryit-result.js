/**
 * Reading what came back — and what it means when nothing did.
 *
 * The try-it panel builds and sends; this draws the answer. It is a separate
 * subject and a separate file because the interesting part is not the happy
 * path: `fetch` deliberately hides *why* a cross-origin request failed, so
 * this is the one place in the app that has to reason about a black box, and
 * it says what the two possibilities are rather than asserting one of them.
 */

import { el } from '../lib/dom.js';
import { statusClass } from '../lib/openapi.js';

/**
 * Why a request produced nothing readable.
 *
 * @param {Error|null} error
 * @param {{url: string}} built
 * @param {number} elapsed  milliseconds
 * @returns {object} a result the renderer below understands
 */
export function explainFailure(error, built, elapsed) {
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

/** @param {object} result @returns {HTMLElement} */
export function renderResult(result) {
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

function prettify(text, contentType) {
  if (!contentType.includes('json')) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Used by the announcement as well as by the head line, so it is exported. */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
