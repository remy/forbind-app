/**
 * The base URL field, for a schema that does not carry one.
 *
 * `servers` is optional in OpenAPI. When it is absent — or relative, or still
 * holding a `{variable}` — the document describes paths with nothing in front
 * of them, and the reader is the only one who knows the host.
 *
 * It asks **once**. On the parse report, before anything is browsed; in Try it,
 * on the operation where the missing half is about to stop a request; and in
 * Settings, which is where it lives afterwards. What it does not do is ask
 * again on every operation you open: a question already answered is noise on
 * screen and, read aloud before the parameters of every single endpoint, it is
 * worse than noise.
 *
 * Once it has offered itself for an operation it stays for that operation, so
 * the answer can be corrected and so the keyboard is never standing on a
 * control that vanishes underneath it. The next operation gets a fresh element,
 * and by then there is nothing to ask.
 *
 * Supplying one is never a condition of reading the schema. The report keeps
 * its "Browse" button beside this, and this element says so in words, because
 * browsing an API you cannot call is a perfectly ordinary thing to want.
 */

import { AwElement, define } from '../lib/element.js';
import { el, replace, preserveFocus, uid } from '../lib/dom.js';
import { announce } from '../lib/announce.js';
import { describeServerGap, inspectServers } from '../lib/servers.js';

/**
 * What the block leads with, per variant. The report is a page of its own so
 * it takes an `<h2>`; the sheet already has one, so it takes an `<h3>`; the
 * try-it panel is a run of fields, where a heading would be a level out of
 * nowhere.
 */
const HEADING = { report: 'h2', settings: 'h3', inline: 'p' };

class AwBaseUrl extends AwElement {
  static observes = ['schema', 'baseUrl', 'baseUrlHint'];

  /**
   * 'report' leads with a heading and the reason and is the first-run face;
   * 'settings' is the same thing where it lives permanently; 'inline' is the
   * terser one inside Try it, which asks only while there is something to ask.
   */
  get variant() {
    const declared = this.getAttribute('variant');
    return declared === 'inline' || declared === 'settings' ? declared : 'report';
  }

  /**
   * Set by Try it, so the panel for an operation that carries its own
   * `servers` is not asked for a base URL it does not need.
   * @type {object|null}
   */
  operation = null;

  #error = null;
  #ids = null;
  /** Whether this element has already put the question on screen. */
  #offered = false;
  /**
   * What has been typed and not yet applied. The field is rebuilt on every
   * render — a tab switch, a credential arriving — and a host half-typed into
   * it is work, not noise, so it is remembered rather than replaced by the
   * suggestion the field started on.
   */
  #draft = null;

  /** The gap this element is offering to fill, or null when there is none. */
  #gap(state) {
    const report = state.schema?.report?.baseUrl;
    if (!report) return null;

    if (this.variant === 'inline') {
      const check = inspectServers(this.operation?.servers);
      // This operation has a host of its own: nothing to ask, ever.
      if (check.usable) return null;
      // Answered already, somewhere else. Stay only if this element is the
      // one that was answered — the keyboard may still be in it.
      if (state.baseUrl && !this.#offered) return null;
      this.#offered = true;
      return { needed: true, reason: check.reason, declared: this.operation?.servers?.[0]?.url ?? null };
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
    // Where the schema was fetched from, offered as a starting value. It fills
    // the field but is not the base URL: the heading still says one is needed,
    // the button still says "Use this", and the sentence below says where the
    // value came from — a field that quietly pre-fills itself with a guess is
    // a request sent to a host nobody chose.
    const suggested = current ? '' : (state.baseUrlHint ?? '');
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
      oninput: (event) => { this.#draft = event.target.value; },
      '.value': current || this.#draft || suggested,
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

    return el('div', { class: `baseurl baseurl--${this.variant}` }, [
      el(HEADING[this.variant], {
        class: inline ? 'baseurl__title' : 'label',
        text: current ? 'Base URL' : 'This schema needs a base URL',
      }),
      el('p', { class: 'baseurl__lede', id: helpId }, [
        el('span', {
          text: current
            ? `Requests and snippets are built against ${current}. It is kept in this browser for this schema only, and can be changed or cleared at any time. `
            : `${describeServerGap(gap.reason, gap.declared ?? '')} ${suggested
              ? `The field starts at ${suggested}, the origin this schema was fetched from — a guess rather than something the document says, so check it before you send. Accept it, change it, or leave it: the paths are still yours to read either way. `
              : 'Add one and every snippet and request is complete; leave it and the paths are still yours to read. '}`,
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
              this.#draft = null;
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
      // Applied, so the store holds it now and the draft has nothing to say.
      this.#draft = null;
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
