/**
 * The base class for forbind's custom elements.
 *
 * Everything renders into the light DOM (see js/lib/dom.js for why) and
 * re-renders when one of the state keys it declares changes identity. The
 * store always replaces nested objects rather than mutating them, so an
 * identity check is enough and there is no diffing machinery to get wrong.
 */

import { app } from './context.js';

export class FbElement extends HTMLElement {
  /** @type {string[]} state keys that should trigger a re-render */
  static observes = [];

  #unsubscribe = null;
  #rendered = false;

  connectedCallback() {
    if (this.#rendered) {
      // Re-inserted after a move: state may have advanced while detached.
      this.render(app().store.state);
    } else {
      this.render(app().store.state);
      this.#rendered = true;
    }
    this.#unsubscribe = app().store.subscribe((state, prev) => {
      if (this.shouldRender(state, prev)) this.update(state, prev);
    });
  }

  disconnectedCallback() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  get state() {
    return app().store.state;
  }

  get actions() {
    return app().actions;
  }

  /** @returns {boolean} */
  shouldRender(state, prev) {
    const keys = /** @type {typeof FbElement} */ (this.constructor).observes;
    return keys.some((key) => !Object.is(state[key], prev[key]));
  }

  /** Override for a cheaper update path than a full re-render. */
  update(state, prev) {
    this.render(state, prev);
  }

  /** @abstract */
  render(_state, _prev) {}
}

/**
 * Queue a custom element for registration.
 *
 * Registration is deliberately not immediate: `customElements.define` upgrades
 * any matching element already in the document, which would run
 * `connectedCallback` — and therefore read the store — while the entry point
 * is still assembling it. Components declare themselves at module scope as
 * usual; `defineAll()` at the end of boot decides when they come alive.
 */
const pending = [];

export function define(name, ctor) {
  pending.push([name, ctor]);
}

/** Upgrade everything that has been declared. Safe to call more than once. */
export function defineAll() {
  for (const [name, ctor] of pending.splice(0)) {
    if (!customElements.get(name)) customElements.define(name, ctor);
  }
}
