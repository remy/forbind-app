/**
 * A very small observable store.
 *
 * Nothing here is persisted except the two presentation preferences (theme and
 * density) which are explicitly opted into by `persistKeys`. The parsed schema,
 * the filters and — above all — the credential live in memory for the lifetime
 * of the tab and nowhere else. No localStorage for state, no cookies, no
 * telemetry: the import screen promises "nothing leaves your browser" and the
 * auth sheet promises "credentials stay in this browser tab", and both are
 * meant literally.
 */

const PERSIST_KEY = 'allyway:prefs';
const PERSISTED = ['theme', 'density', 'showHints'];

/** @returns {object} the shape every screen reads from. */
export function initialState() {
  return {
    /** Parse result: { title, version, oasVersion, sourceName, operations, schemas, tags, servers, securitySchemes, report } */
    schema: null,
    /** 'idle' | 'loading' | 'ready' | 'error' */
    schemaState: 'idle',
    schemaError: null,

    filters: {
      query: '',
      tags: [],
      verbs: [],
      hideDeprecated: false,
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
    },

    /** Small screens push the detail as its own page. */
    mobileView: 'list',

    /* Presentation preferences — the only persisted state. */
    theme: 'auto',       // 'auto' | 'light' | 'dark'
    density: 'dense',    // 'dense' (1a) | 'roomy' (1b)
    showHints: true,     // the keyboard hint bar
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

function readPrefs() {
  try {
    const raw = globalThis.localStorage?.getItem(PERSIST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const out = {};
    for (const key of PERSISTED) {
      if (key in parsed) out[key] = parsed[key];
    }
    return out;
  } catch {
    // Private mode, disabled storage, corrupt value — all fine, use defaults.
    return {};
  }
}

function writePrefs(state) {
  try {
    const out = {};
    for (const key of PERSISTED) out[key] = state[key];
    globalThis.localStorage?.setItem(PERSIST_KEY, JSON.stringify(out));
  } catch {
    /* Preferences are a nicety; never let storage failure break the app. */
  }
}
