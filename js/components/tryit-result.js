/**
 * Reading what came back — and what it means when nothing did.
 *
 * The try-it panel builds and sends; this draws the answer. It is a separate
 * subject and a separate file because the interesting part is not the happy
 * path: `fetch` deliberately hides *why* a cross-origin request failed, so
 * this is the one place in the app that has to reason about a black box, and
 * it says what the two possibilities are rather than asserting one of them.
 *
 * A body that came back is a body worth keeping, so it carries a copy button —
 * on the same terms as the snippet's: what is copied is exactly what is shown,
 * and the confirmation is spoken as well as drawn.
 */

import { el } from '../lib/dom.js';
import { statusClass } from '../lib/openapi.js';
import { lineCount } from '../lib/request.js';
import { writeClipboard, selectContents } from '../lib/clipboard.js';
import { announce } from '../lib/announce.js';

/** How long the button wears its "Copied" label. */
const COPIED_MS = 2000;

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
      `Nothing came back that this page is allowed to see. ` +
      `Either ${host} is unreachable, or its answer carried no \`Access-Control-Allow-Origin\` header for this origin. ` +
      `A browser withholds the whole response when that header is missing. The status code makes no difference.`,
    hint:
      'The request may well have arrived and succeeded; the browser is refusing to show you the answer, not the server refusing to act. ' +
      'Your browser’s network panel will show the real status. ' +
      'To make this work from here, the API has to send CORS headers for this origin. ' +
      'allyway does not proxy real requests, so the credential never leaves your machine.',
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
  // Exactly what is on screen, so what lands on the clipboard is what was
  // read — pretty-printed if it was JSON, verbatim if it was not.
  const body = prettify(result.body, result.contentType);
  const pre = el('pre', { class: 'code-block', tabindex: '0', text: body || '(empty)' });

  return el('div', { class: 'result', tabindex: '-1', role: 'group', 'aria-label': 'Request result' }, [
    el('div', { class: 'result__head' }, [
      el('span', { class: `response-chip pill--${klass}`, text: `${result.status} ${result.statusText}`.trim() }),
      el('span', { text: `${result.elapsed} ms` }),
      el('span', { text: formatBytes(result.bytes) }),
    ]),
    el('div', { class: 'result__body' }, [
      ...result.warnings.map((warning) => el('p', { class: 'result__note', text: warning })),
      el('div', { class: 'result__section' }, [
        el('div', { class: 'result__section-head' }, [
          el('h3', { class: 'label', text: 'Body' }),
          // A response with nothing in it — a 204, or a HEAD — has nothing to
          // put on the clipboard, so it does not get a button that would do
          // nothing.
          body ? copyButton(body, pre) : null,
        ]),
        pre,
      ]),
      el('div', { class: 'result__section' }, [
        el('h3', { class: 'label', text: `Response headers — ${result.headers.length} readable` }),
        result.headers.length
          ? el('dl', { class: 'kv' }, result.headers.map(([name, value]) =>
              el('div', {}, [el('dt', { text: name }), el('dd', { text: value })]),
            ))
          : el('p', { class: 'result__note', text: 'None readable.' }),
        el('p', {
          class: 'result__note',
          text: 'These are the headers this page can read, not all the headers that were sent. '
            + 'A browser hides the rest on a cross-origin response. '
            + 'The server can expose more by naming them in `Access-Control-Expose-Headers`.',
        }),
      ]),
    ]),
  ]);
}

/**
 * Copy the response body.
 *
 * The same bargain the snippet's copy button makes: the label flips for two
 * seconds *and* a live region says what was copied and how much of it, because
 * a label that changed somewhere off screen is not a confirmation. If the
 * clipboard refuses — it needs a secure context and can be denied outright —
 * the body is selected instead and that is said out loud, rather than the
 * button claiming a copy that never happened.
 *
 * @param {string} body the text as it is shown
 * @param {HTMLElement} pre the block to fall back to selecting
 */
function copyButton(body, pre) {
  let timer = null;
  const button = el('button', {
    type: 'button',
    class: 'btn btn--sm result__copy',
    text: 'Copy response',
    onclick: async () => {
      const ok = await writeClipboard(body);
      if (!ok) {
        announce(
          'Could not reach the clipboard. The response body is selected instead — press Command C, or Control C, to copy it.',
          { assertive: true },
        );
        selectContents(pre);
        return;
      }
      const lines = lineCount(body);
      announce(`Response body copied, ${lines} ${lines === 1 ? 'line' : 'lines'}.`);
      button.textContent = 'Copied ✓';
      button.dataset.copied = 'true';
      clearTimeout(timer);
      timer = setTimeout(() => {
        button.textContent = 'Copy response';
        delete button.dataset.copied;
      }, COPIED_MS);
    },
  });
  return button;
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
