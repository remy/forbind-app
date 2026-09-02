/**
 * The snippet block: language tabs, a copy button, and the `<pre>`.
 *
 * All three languages are generated from the same request model rather than
 * from per-language string templates, so they cannot drift apart — the handoff
 * asked which of the two it should be, and this is the answer.
 *
 * The copy button never relies on its label changing: the label flips to
 * "Copied ✓" for two seconds *and* a polite live region says what was copied
 * and how long it is.
 */

import { FbElement, define } from '../lib/element.js';
import { el, replace, uid } from '../lib/dom.js';
import { announce } from '../lib/announce.js';
import { buildRequest, SNIPPET_LANGUAGES, lineCount } from '../lib/request.js';
import { writeClipboard, selectContents } from '../lib/clipboard.js';

const COPIED_MS = 2000;

class FbCodeBlock extends FbElement {
  static observes = ['schema', 'auth', 'baseUrl'];

  /** @type {object|null} set by the parent before insertion */
  operation = null;

  #lang = 'curl';
  #copyTimer = null;

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this.#copyTimer);
  }

  /** The snippet as it currently stands, used by the ⇧⌘C shortcut too. */
  get snippet() {
    if (!this.operation) return '';
    const request = buildRequest({
      model: this.state.schema,
      operation: this.operation,
      // A base URL the reader supplied stands in for the `servers` block the
      // document does not have, so the snippet is a command and not a path.
      serverUrl: this.state.baseUrl,
      // Never the real credential. A copied command is pasted into chat logs,
      // tickets and shell history; it carries a placeholder.
      revealCredential: false,
    });
    return SNIPPET_LANGUAGES[this.#lang].render(request);
  }

  render() {
    if (!this.operation) {
      replace(this, []);
      return;
    }
    const snippet = this.snippet;
    const baseId = uid('code');
    const preId = `${baseId}-pre`;

    const tabs = el(
      'div',
      {
        class: 'lang-tabs',
        role: 'tablist',
        'aria-label': 'Snippet language',
        onkeydown: (event) => this.#onTabKey(event),
      },
      Object.entries(SNIPPET_LANGUAGES).map(([key, lang]) =>
        el('button', {
          type: 'button',
          class: 'lang-tab',
          role: 'tab',
          id: `${baseId}-tab-${key}`,
          dataset: { lang: key },
          'aria-selected': String(this.#lang === key),
          'aria-controls': preId,
          tabindex: this.#lang === key ? '0' : '-1',
          text: lang.label,
          onclick: () => {
            this.#lang = key;
            this.render();
            this.querySelector(`[data-lang="${key}"]`)?.focus();
          },
        }),
      ),
    );

    const copyButton = el('button', {
      type: 'button',
      class: 'btn btn--sm codeblock__copy',
      text: 'Copy',
      onclick: (event) => this.copy(event.currentTarget),
    });

    replace(this, [
      el('div', { class: 'codeblock__head' }, [tabs, copyButton]),
      el('pre', {
        class: 'code-block',
        id: preId,
        role: 'tabpanel',
        'aria-labelledby': `${baseId}-tab-${this.#lang}`,
        tabindex: '0',
        text: snippet,
      }),
    ]);
  }

  #onTabKey(event) {
    const keys = Object.keys(SNIPPET_LANGUAGES);
    const index = keys.indexOf(this.#lang);
    let next = null;
    if (event.key === 'ArrowRight') next = (index + 1) % keys.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + keys.length) % keys.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = keys.length - 1;
    if (next === null) return;
    event.preventDefault();
    this.#lang = keys[next];
    this.render();
    this.querySelector(`[data-lang="${this.#lang}"]`)?.focus();
  }

  /** @param {HTMLElement} [button] */
  async copy(button) {
    const snippet = this.snippet;
    const lines = lineCount(snippet);
    const label = SNIPPET_LANGUAGES[this.#lang].label;
    const ok = await writeClipboard(snippet);

    if (!ok) {
      announce(`Could not reach the clipboard. The ${label} snippet is selected instead — press Command C, or Control C, to copy it.`, { assertive: true });
      selectContents(this.querySelector('pre'));
      return;
    }

    announce(`${label} command copied, ${lines} ${lines === 1 ? 'line' : 'lines'}.`);
    const target = button ?? this.querySelector('.codeblock__copy');
    if (!target) return;
    target.textContent = 'Copied ✓';
    target.dataset.copied = 'true';
    clearTimeout(this.#copyTimer);
    this.#copyTimer = setTimeout(() => {
      target.textContent = 'Copy';
      delete target.dataset.copied;
    }, COPIED_MS);
  }
}

define('fb-code-block', FbCodeBlock);
