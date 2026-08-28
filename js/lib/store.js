/**
 * A very small observable store.
 *
 * The store itself only persists the display preferences; what else is
 * remembered, and in which storage, is decided in js/lib/persist.js and driven
 * from main.js. Nothing is ever sent anywhere — every one of those stores is on
 * the reader's own machine, which is the promise the import screen makes.
 */

import { readPrefs, writePrefs } from './persist.js';

/** @returns {object} the shape every screen reads from. */
export function initialState() {
  return {
    /** Parse result: { title, version, oasVersion, sourceName, operations, schemas, tags, servers, securitySchemes, report } */
    schema: null,
    /** 'idle' | 'loading' | 'ready' | 'error' */
    schemaState: 'idle',
    schemaError: null,
    /** A parsed schema shows its report first; this is the step past it. */
    browsing: false,

    filters: {
      query: '',
      tags: [],
      verbs: [],
      hideDeprecated: false,
      onlyDeprecated: false,
      scopes: [],
      statusCodes: [],
    },

    /** Drives the detail pane. Mirrored into the URL. */
    selectedOperationId: null,
    /** Drives the detail pane when a schema (rather than an operation) is open. */
    selectedSchemaName: null,
    /** Roving-tabindex cursor. Deliberately distinct from selection. */
    activeRowId: null,

    palette: { open: false, query: '', activeId: null },

    auth: {
      schemeId: null,
      credential: '',
      /** 'idle' | 'checking' | 'valid' | 'invalid' */
      verifyState: 'idle',
      message: '',
      scopes: [],
      expiresAt: null,
      /** false: this tab only (sessionStorage). true: this device. */
      remember: false,
    },

    /**
     * A base URL the reader supplied because the schema declares none (or
     * declares one nothing can be sent to). Empty when the document's own
     * `servers` are doing the job.
     */
    baseUrl: '',

    /** Overlays. Kept in the store so the palette can open them too. */
    authOpen: false,
    optionsOpen: false,

    /** Small screens push the detail as its own page. */
    mobileView: 'list',

    /* Presentation preferences — the only persisted state. */
    theme: 'auto',       // 'auto' | 'light' | 'dark'
    density: 'dense',    // 'dense' (1a) | 'roomy' (1b)
    showHints: true,     // the keyboard hint bar

    /*
     * Collapsed columns. Either navigation column can be folded away to give
     * the detail the room; with both folded the detail has the whole frame,
     * which is what "maximise" means here. Remembered like the other display
     * preferences, and ignored below the phone breakpoint, where the list and
     * the detail are already separate pages.
     */
    railCollapsed: false,
    listCollapsed: false,
  };
}

export class Store {
  #state;
  #listeners = new Set();

  constructor(state = initialState()) {
    this.#state = { ...state, ...readPrefs() };
  }

  get state() {
    return this.#state;
  }

  /**
   * Merge a patch into state and notify subscribers.
   * @param {object|((s: object) => object)} patch
   */
  set(patch) {
    const next = typeof patch === 'function' ? patch(this.#state) : patch;
    let changed = false;
    for (const key of Object.keys(next)) {
      if (!Object.is(this.#state[key], next[key])) changed = true;
    }
    if (!changed) return this.#state;
    const prev = this.#state;
    this.#state = { ...this.#state, ...next };
    writePrefs(this.#state);
    for (const fn of [...this.#listeners]) fn(this.#state, prev);
    return this.#state;
  }

  /** Merge into a nested object key (filters, auth, palette). */
  patch(key, patchObj) {
    return this.set({ [key]: { ...this.#state[key], ...patchObj } });
  }

  /**
   * @param {(state: object, prev: object) => void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
}
