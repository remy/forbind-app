/**
 * The base URL field, for a schema that does not carry one.
 *
 * `servers` is optional in OpenAPI. When it is absent — or relative, or still
 * holding a `{variable}` — the document describes paths with nothing in front
 * of them, and the reader is the only one who knows the host. So this asks,
 * once, at the two moments it matters: on the parse report, before anything is
 * browsed, and in Try it, where the missing half is about to stop a request.
 *
 * Supplying one is never a condition of reading the schema. The report keeps
 * its "Browse" button beside this, and this element says so in words, because
 * browsing an API you cannot call is a perfectly ordinary thing to want.
 *
 * It renders nothing at all when the schema declares a server that works.
 */

import { AwElement, define } from '../lib/element.js';
import { el, replace, preserveFocus, uid } from '../lib/dom.js';
import { announce } from '../lib/announce.js';
import { describeServerGap, inspectServers } from '../lib/servers.js';

class AwBaseUrl extends AwElement {
  static observes = ['schema', 'baseUrl'];

  /**
   * 'report' leads with the heading and the reason; 'inline' is the terser
   * face used inside Try it, where the panel around it has already said what
   * is being built.
   */
  get variant() {
    return this.getAttribute('variant') === 'inline' ? 'inline' : 'report';
  }

  /**
   * Set by Try it, so the panel for an operation that carries its own
   * `servers` is not asked for a base URL it does not need.
   * @type {object|null}
   */
  operation = null;

  #error = null;
  #ids = null;

  /**
   * The gap this element is offering to fill, or null when there is none.
   * A base URL already in force still gets the field, wherever it applies, so
   * that it is never in effect somewhere it cannot be changed.
   */
  #gap(state) {
    const report = state.schema?.report?.baseUrl;
    if (!report) return null;
    if (this.operation) {
      const check = inspectServers(this.operation.servers);
      if (check.usable) return state.baseUrl ? { needed: true, reason: null, declared: check.url } : null;
      return { needed: true, reason: check.reason, declared: this.operation.servers?.[0]?.url ?? null };
    }
    return report.needed || state.baseUrl ? { ...report, needed: true } : null;
  }

  render(state) {
    const gap = this.#gap(state);
    if (!gap) {
      this.#error = null;
      replace(this, []);
      return;
    }
    if (!this.#ids) {
      const base = uid('baseurl');
      this.#ids = { input: `${base}-input`, help: `${base}-help`, error: `${base}-error` };
    }
    preserveFocus(this, () => replace(this, [this.#build(state, gap)]));
  }

  #build(state, gap) {
    const { input: inputId, help: helpId, error: errorId } = this.#ids;
    const current = state.baseUrl;
    const inline = this.variant === 'inline';

    const field = el('input', {
      type: 'url',
      id: inputId,
      class: 'baseurl__input',
      // A URL keyboard, and no autocorrect mangling a hostname.
      inputmode: 'url',
      autocomplete: 'url',
      spellcheck: 'false',
      placeholder: 'https://api.example.com',
      '.value': current,
      'aria-describedby': this.#error ? `${errorId} ${helpId}` : helpId,
      'aria-invalid': this.#error ? 'true' : null,
      onkeydown: (event) => {
        if (event.key !== 'Enter') return;
        // Inside Try it this field sits in the panel's own form, whose Enter
        // means "send". Setting a base URL is not sending, so it is claimed.
        event.preventDefault();
        this.#apply(event.target.value);
      },
    });

    return el('div', { class: `baseurl baseurl--${inline ? 'inline' : 'report'}` }, [
      el(inline ? 'p' : 'h2', {
        class: inline ? 'baseurl__title' : 'label',
        text: current ? 'Base URL' : 'This schema needs a base URL',
      }),
      el('p', { class: 'baseurl__lede', id: helpId }, [
        el('span', {
          text: current
            ? `Requests and snippets are built against ${current}. It is kept in this browser for this schema only, and can be changed or cleared at any time. `
            : `${describeServerGap(gap.reason, gap.declared ?? '')} Add one and every snippet and request is complete; leave it and the paths are still yours to read. `,
        }),
      ]),

      el('div', { class: 'urlrow' }, [
        el('label', { class: 'visually-hidden', for: inputId, text: 'Base URL' }),
        field,
        el('button', {
          type: 'button',
          dataset: { focusKey: 'baseurl-apply' },
          text: current ? 'Update' : 'Use this',
          onclick: () => this.#apply(field.value),
        }),
      ]),

      this.#error
        ? el('p', { class: 'baseurl__error', id: errorId }, [
            el('span', { class: 'word word--fail', text: 'NO' }),
            el('span', { text: this.#error }),
          ])
        : null,

      current
        ? el('button', {
            type: 'button',
            class: 'link-quiet baseurl__clear',
            dataset: { focusKey: 'baseurl-clear' },
            text: 'Clear the base URL',
            onclick: () => {
              this.#error = null;
              this.actions.clearBaseUrl();
              // Nothing else re-renders this when it was already empty.
              this.render(this.state);
              this.querySelector(`#${CSS.escape(this.#ids.input)}`)?.focus();
            },
          })
        : null,
    ]);
  }

  /** @param {string} value */
  #apply(value) {
    const result = this.actions.setBaseUrl(value);
    this.#error = result.ok ? null : result.error;
    if (result.ok) {
      // The store change re-renders every copy of this element; this one is
      // re-rendered here as well so the message under the field is right even
      // when the value did not actually change.
      this.render(this.state);
      return;
    }
    this.render(this.state);
    announce(result.error, { assertive: true });
    this.querySelector(`#${CSS.escape(this.#ids.input)}`)?.focus();
  }
}

define('aw-base-url', AwBaseUrl);
