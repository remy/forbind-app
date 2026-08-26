/**
 * allyway — entry point.
 *
 * Wires the store to the router, defines the actions the components call, and
 * installs the global keyboard model. Everything below this file is either a
 * pure function or a custom element; this is the only place that knows about
 * all of them at once.
 */

import yaml from './vendor/js-yaml.mjs';

import { Store } from './lib/store.js';
import { setApp } from './lib/context.js';
import { defineAll } from './lib/element.js';
import { Router, buildHash, parseHash } from './lib/router.js';
import { announce } from './lib/announce.js';
import { normalise, parseText, SchemaError, describeScheme } from './lib/openapi.js';
import { filterOperations, allScopes, allStatusCodes } from './lib/search.js';
import { readJwt } from './lib/auth.js';
import { loadFromFile, loadFromUrl, loadSample } from './lib/loader.js';
import {
  readSchema, writeSchema, clearSchema,
  readAuth, writeAuth, clearAuth,
} from './lib/persist.js';

import './components/aw-app.js';
import './components/aw-topbar.js';
import './components/aw-tag-rail.js';
import './components/aw-endpoint-list.js';
import './components/aw-detail.js';
import './components/aw-code-block.js';
import './components/aw-schema-tree.js';
import './components/aw-try-it.js';
import './components/aw-palette.js';
import './components/aw-auth-sheet.js';
import './components/aw-options.js';
import './components/aw-import.js';

const store = new Store();

/* Extra keys the components read that are not part of the base state shape. */
store.set({ importNote: null, schemaError: null });

let lastInvoker = null;
let visibleCache = { key: null, value: [] };
let paletteAnnounceTimer = null;

/* -------------------------------------------------------------------------
   Derived state
------------------------------------------------------------------------- */

function visibleOperations() {
  const { schema, filters } = store.state;
  if (!schema) return [];
  // Filtering forty-seven operations is cheap, but it happens on every render
  // of every pane, so the result is memoised on the inputs that decide it.
  const key = `${schema.sourceName}|${JSON.stringify(filters)}`;
  if (visibleCache.key === key) return visibleCache.value;
  const value = filterOperations(schema.operations, filters);
  visibleCache = { key, value };
  return value;
}

function currentFilters() {
  return store.state.filters;
}

function hashFor(target) {
  return buildHash({ ...target, filters: currentFilters(), src: schemaSource });
}

/* -------------------------------------------------------------------------
   Navigation
------------------------------------------------------------------------- */

let pendingSelection = null;
let schemaSource = null;

const router = new Router((route) => {
  if (route.src && route.src !== schemaSource) {
    // The URL names a schema this tab has not loaded. Fetch it, then land on
    // whatever the rest of the URL asked for.
    pendingSelection = { view: route.view, id: route.id };
    actions.loadUrl(route.src);
  }
  applyRoute(route);
});

function applyRoute(route) {
  const patch = { filters: { ...store.state.filters, ...route.filters } };

  if (route.view === 'operation') {
    patch.selectedOperationId = route.id;
    patch.selectedSchemaName = null;
    patch.activeRowId = route.id;
    patch.mobileView = 'detail';
  } else if (route.view === 'schema') {
    patch.selectedSchemaName = route.id;
    patch.selectedOperationId = null;
    patch.mobileView = 'detail';
  } else if (route.view === 'import') {
    patch.schemaState = 'idle';
    patch.selectedOperationId = null;
    patch.selectedSchemaName = null;
  } else {
    patch.selectedOperationId = null;
    patch.selectedSchemaName = null;
    patch.mobileView = 'list';
  }
  store.set(patch);
}

function go(target, options) {
  router.go({ ...target, filters: currentFilters(), src: schemaSource }, options);
}

/** Push the current filters into the URL without changing what is open. */
function syncFilterHash() {
  const state = store.state;
  const view = state.selectedSchemaName ? 'schema' : state.selectedOperationId ? 'operation' : 'browse';
  const id = state.selectedSchemaName ?? state.selectedOperationId ?? null;
  router.go({ view, id, filters: state.filters, src: schemaSource }, { replace: true });
}

/* -------------------------------------------------------------------------
   Announcing filter results
------------------------------------------------------------------------- */

let announceTimer = null;
function announceResultCount() {
  clearTimeout(announceTimer);
  // Wait for typing to settle: announcing on every keystroke is unusable.
  announceTimer = setTimeout(() => {
    const count = visibleOperations().length;
    const total = store.state.schema?.operations.length ?? 0;
    announce(`${count} of ${total} ${total === 1 ? 'endpoint' : 'endpoints'} shown.`);
  }, 450);
}

/* -------------------------------------------------------------------------
   Schema loading
------------------------------------------------------------------------- */

async function ingest(promise, { note = null, restoring = false } = {}) {
  store.set({ schemaState: 'loading', schemaError: null, importNote: null });
  try {
    const source = await promise;
    const doc = parseText(source.text, { loadYaml: (text) => yaml.load(text) });
    const model = normalise(doc, source.name);
    visibleCache = { key: null, value: [] };
    schemaSource = source.url ?? null;

    // Remembered so a reload lands back where it left off rather than on an
    // empty file picker.
    if (!restoring) writeSchema({ name: source.name, url: source.url ?? null, text: source.text });

    // A credential belongs to the API it was issued for, so it comes back only
    // for the schema it was entered against.
    const restoredAuth = readAuth(schemaKeyFor(source));

    store.set({
      schema: model,
      schemaState: 'ready',
      // A link that named the schema in the URL knows where it is going, so it
      // goes straight there. Anyone who loaded a file by hand gets the parse
      // report first, because that is where the warnings are.
      browsing: Boolean(pendingSelection) || restoring,
      schemaError: null,
      importNote: source.note ?? note,
      selectedOperationId: null,
      selectedSchemaName: null,
      activeRowId: null,
      filters: { ...store.state.filters, query: '', tags: [], verbs: [], scopes: [], statusCodes: [], onlyDeprecated: false },
      auth: {
        ...store.state.auth,
        schemeId: restoredAuth?.schemeId ?? Object.keys(model.securitySchemes)[0] ?? null,
        credential: restoredAuth?.credential ?? '',
        remember: restoredAuth?.remember ?? false,
        verifyState: 'idle',
        message: '',
        scopes: [],
        expiresAt: null,
      },
    });

    // Re-read the claims of a restored token so the sheet is not blank about
    // a credential it is already holding.
    if (restoredAuth?.credential) {
      const claims = readJwt(restoredAuth.credential);
      if (claims) store.patch('auth', { scopes: claims.scopes, expiresAt: claims.expiresAt });
    }
    const { counts } = model.report;
    announce(
      `${source.name} parsed. ${counts.endpoints} endpoints, ${counts.tags} tags, ${counts.schemas} schemas, ` +
      `${counts.deprecated} deprecated. ${model.report.notes.length} things worth knowing.`,
    );

    // A link that named both a schema and an operation lands on the operation
    // rather than on the parse report.
    const target = pendingSelection;
    pendingSelection = null;
    if (target?.id) {
      if (target.view === 'schema') actions.selectSchema(target.id);
      else actions.selectOperation(target.id);
    }
  } catch (error) {
    const schemaError = error instanceof SchemaError
      ? { message: error.message, detail: error.detail }
      : { message: 'That schema could not be read.', detail: { message: String(error?.message ?? error) } };
    store.set({ schemaState: 'error', schemaError });
    announce(`Could not load the schema. ${schemaError.message}`, { assertive: true });
  }
}

/* -------------------------------------------------------------------------
   Actions
------------------------------------------------------------------------- */

const actions = {
  visibleOperations,
  hashFor,
  allScopes: () => allScopes(store.state.schema?.operations ?? []),
  allStatusCodes: () => allStatusCodes(store.state.schema?.operations ?? []),
  lastInvoker: () => lastInvoker,

  schemeLabel(schemeId) {
    const scheme = store.state.schema?.securitySchemes[schemeId];
    return scheme ? describeScheme(scheme) : schemeId;
  },

  /* --- filters -------------------------------------------------------- */
  setQuery(query) {
    store.patch('filters', { query });
    syncFilterHash();
    announceResultCount();
  },

  setTags(tags) {
    store.patch('filters', { tags });
    syncFilterHash();
    announceResultCount();
  },

  toggleTag(tag, { additive = false } = {}) {
    const current = store.state.filters.tags;
    let next;
    if (additive) {
      next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
    } else {
      next = current.length === 1 && current[0] === tag ? [] : [tag];
    }
    actions.setTags(next);
  },

  setVerbs(verbs) {
    store.patch('filters', { verbs, onlyDeprecated: false });
    syncFilterHash();
    announceResultCount();
  },

  toggleVerb(verb) {
    const current = store.state.filters.verbs;
    actions.setVerbs(current.includes(verb) ? current.filter((v) => v !== verb) : [...current, verb]);
  },

  toggleScope(scope) {
    const current = store.state.filters.scopes;
    store.patch('filters', {
      scopes: current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope],
    });
    syncFilterHash();
    announceResultCount();
  },

  toggleStatusCode(code) {
    const current = store.state.filters.statusCodes;
    store.patch('filters', {
      statusCodes: current.includes(code) ? current.filter((c) => c !== code) : [...current, code],
    });
    syncFilterHash();
    announceResultCount();
  },

  toggleHideDeprecated() {
    const next = !store.state.filters.hideDeprecated;
    store.patch('filters', { hideDeprecated: next, onlyDeprecated: false });
    syncFilterHash();
    announce(next ? 'Deprecated endpoints hidden.' : 'Deprecated endpoints shown.');
    announceResultCount();
  },

  toggleOnlyDeprecated() {
    const next = !store.state.filters.onlyDeprecated;
    store.patch('filters', { onlyDeprecated: next, hideDeprecated: false, verbs: [] });
    syncFilterHash();
    announce(next ? 'Showing deprecated endpoints only.' : 'Showing all endpoints.');
    announceResultCount();
  },

  clearFilters() {
    store.patch('filters', {
      query: '', tags: [], verbs: [], scopes: [], statusCodes: [], hideDeprecated: false, onlyDeprecated: false,
    });
    syncFilterHash();
    announce('Filters cleared.');
    announceResultCount();
  },

  /* --- selection ------------------------------------------------------ */
  selectOperation(id, { focusRow = false } = {}) {
    // The palette searches the whole document, so it can land on something the
    // current filters hide. Relax them rather than opening an operation whose
    // row is nowhere on screen — and say so, because filters vanishing without
    // explanation is worse than the filters staying.
    if (store.state.schema && !visibleOperations().some((op) => op.id === id)) {
      const op = store.state.schema.operations.find((candidate) => candidate.id === id);
      if (op) {
        store.patch('filters', {
          query: '', tags: [], verbs: [], scopes: [], statusCodes: [],
          hideDeprecated: false, onlyDeprecated: false,
        });
        announce(`Filters cleared so ${op.method} ${op.path} can be shown.`);
      }
    }
    go({ view: 'operation', id });
    store.set({ selectedOperationId: id, selectedSchemaName: null, activeRowId: id, mobileView: 'detail' });
    if (focusRow) {
      requestAnimationFrame(() => {
        const row = document.querySelector(`a.row[data-op-id="${CSS.escape(id)}"]`);
        if (row && document.contains(row)) row.focus({ preventScroll: true });
      });
    }
  },

  selectSchema(name) {
    go({ view: 'schema', id: name });
    store.set({ selectedSchemaName: name, selectedOperationId: null, mobileView: 'detail' });
    requestAnimationFrame(() => document.querySelector('#detail')?.focus({ preventScroll: true }));
  },

  setActiveRow(id) {
    if (store.state.activeRowId !== id) store.set({ activeRowId: id });
  },

  backToList() {
    store.set({ mobileView: 'list' });
    go({ view: 'browse' });
    requestAnimationFrame(() => {
      const row = document.querySelector('a.row[tabindex="0"]') ?? document.querySelector('a.row');
      row?.focus({ preventScroll: false });
    });
  },

  focusList() {
    const row = document.querySelector('a.row[tabindex="0"]') ?? document.querySelector('a.row');
    row?.focus();
  },

  focusSearch() {
    const block = document.querySelector('aw-search-block') ?? document.querySelector('aw-topbar');
    if (block?.focusSearch) block.focusSearch();
    else document.querySelector('#search')?.focus();
  },

  focusVerbs() {
    const bar = document.querySelector('#verb-filters button');
    if (bar) {
      bar.focus();
      announce('Method filters.');
    } else {
      announce('The method filters are not available in this layout.');
    }
  },

  /* --- overlays -------------------------------------------------------- */
  openPalette() {
    lastInvoker = document.activeElement;
    store.patch('palette', { open: true, query: '' });
  },
  closePalette() {
    if (store.state.palette.open) store.patch('palette', { open: false });
  },
  announcePaletteCount(count) {
    clearTimeout(paletteAnnounceTimer);
    paletteAnnounceTimer = setTimeout(() => {
      announce(`${count} ${count === 1 ? 'result' : 'results'}.`);
    }, 350);
  },

  openAuth() {
    lastInvoker = document.activeElement;
    store.set({ authOpen: true });
  },

  /** "Set up auth first" from the parse report: authorise, then browse. */
  authThenBrowse() {
    store.set({ browsing: true, authOpen: true });
    lastInvoker = document.activeElement;
  },
  closeAuth() {
    if (store.state.authOpen) store.set({ authOpen: false });
  },
  setAuth(patch) {
    store.patch('auth', patch);
    const { credential, schemeId, remember } = store.state.auth;
    const schema = store.state.schema;
    if (!schema) return;
    writeAuth({
      credential,
      schemeId,
      remember,
      schemaKey: schemaSource ?? `file:${schema.sourceName}`,
    });
  },

  forgetAuth() {
    clearAuth();
    store.patch('auth', {
      credential: '', remember: false, verifyState: 'idle', message: '', scopes: [], expiresAt: null,
    });
    announce('Credential forgotten, and removed from this browser\u2019s storage.');
  },

  openOptions() {
    lastInvoker = document.activeElement;
    store.set({ optionsOpen: true });
  },
  closeOptions() {
    if (store.state.optionsOpen) store.set({ optionsOpen: false });
  },

  /* --- preferences ----------------------------------------------------- */
  setTheme(theme) {
    store.set({ theme });
    applyTheme(theme);
  },
  setDensity(density) {
    store.set({ density });
  },
  setShowHints(showHints) {
    store.set({ showHints });
  },

  /* --- schema ---------------------------------------------------------- */
  loadFile(file) {
    return ingest(loadFromFile(file));
  },
  loadUrl(url) {
    return ingest(loadFromUrl(url));
  },
  loadSample(path) {
    return ingest(loadSample(path), { note: 'This is the example schema bundled with allyway. It describes an imaginary service.' });
  },
  replaceSchema() {
    clearSchema();
    clearAuth();
    schemaSource = null;
    store.set({ schemaState: 'idle', browsing: false, schemaError: null, importNote: null });
    go({ view: 'import' });
    requestAnimationFrame(() => document.querySelector('#schema-file')?.focus());
    announce('Load a different schema.');
  },
  enterBrowser() {
    store.set({ browsing: true });
    const first = visibleOperations()[0];
    if (first) actions.selectOperation(first.id, { focusRow: true });
    else go({ view: 'browse' });
  },

  /* --- snippets -------------------------------------------------------- */
  copyCurl(operation, button) {
    const block = document.querySelector('aw-code-block');
    if (block && block.operation?.id === operation?.id) return block.copy(button);
    // No block on screen (a narrow layout on another tab, say): make one.
    const temporary = document.createElement('aw-code-block');
    temporary.operation = operation ?? currentOperation();
    document.body.appendChild(temporary);
    const done = temporary.copy(button);
    return Promise.resolve(done).finally(() => temporary.remove());
  },

  openTryIt(id) {
    const panel = document.querySelector('aw-try-it');
    if (panel) {
      const detail = document.querySelector('aw-detail');
      // In the tabbed layouts, Try it is a tab rather than a section below.
      if (detail?.showTab) detail.showTab('tryit');
      requestAnimationFrame(() => {
        const target = document.querySelector('aw-try-it input, aw-try-it textarea, aw-try-it button');
        target?.focus();
        target?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      });
      return;
    }
    actions.selectOperation(id);
  },

  /** The palette's command list. */
  commands() {
    const state = store.state;
    return [
      { kind: 'command', label: 'Copy the request as curl', shortcut: '⇧⌘C', detail: null, run: () => actions.copyCurl(currentOperation()) },
      { kind: 'command', label: 'Replace the schema', shortcut: '⇧⌘U', detail: null, run: () => actions.replaceSchema() },
      { kind: 'command', label: 'Authorise requests', detail: null, run: () => actions.openAuth() },
      { kind: 'command', label: 'Display options', detail: null, run: () => actions.openOptions() },
      {
        kind: 'command',
        label: state.density === 'dense' ? 'Switch to the roomy layout' : 'Switch to the dense layout',
        detail: null,
        run: () => {
          actions.setDensity(state.density === 'dense' ? 'roomy' : 'dense');
          announce(`Layout set to ${store.state.density}.`);
        },
      },
      {
        kind: 'command',
        label: state.filters.hideDeprecated ? 'Show deprecated endpoints' : 'Hide deprecated endpoints',
        detail: null,
        run: () => actions.toggleHideDeprecated(),
      },
      { kind: 'command', label: 'Clear all filters', detail: null, run: () => actions.clearFilters() },
      { kind: 'command', label: 'Jump to the endpoint list', detail: null, run: () => actions.focusList() },
    ];
  },
};

/** Identifies the document a credential was entered against. */
function schemaKeyFor(source) {
  return source.url ?? `file:${source.name}`;
}

function currentOperation() {
  const state = store.state;
  return state.schema?.operations.find((op) => op.id === state.selectedOperationId) ?? null;
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/* -------------------------------------------------------------------------
   Theme
------------------------------------------------------------------------- */

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else root.removeAttribute('data-theme');
}

/* -------------------------------------------------------------------------
   The global keyboard model
------------------------------------------------------------------------- */

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function installShortcuts() {
  document.addEventListener('keydown', (event) => {
    // A component that has already acted on this key has said so; do not act
    // on it twice.
    if (event.defaultPrevented) return;
    const mod = event.metaKey || event.ctrlKey;

    // ⌘K opens the palette from anywhere, including from inside a field.
    if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      actions.openPalette();
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      const op = currentOperation();
      if (op) actions.copyCurl(op);
      else announce('Select an endpoint first.');
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === 'u') {
      event.preventDefault();
      actions.replaceSchema();
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      actions.focusVerbs();
      return;
    }

    // Single-key shortcuts must never fire while someone is typing.
    if (isTypingTarget(event.target) || mod || event.altKey) return;

    if (event.key === '/') {
      event.preventDefault();
      actions.focusSearch();
    }
  });
}

/* -------------------------------------------------------------------------
   Boot
------------------------------------------------------------------------- */

setApp({ store, router, actions });
applyTheme(store.state.theme);

// Only now that the context exists may the elements upgrade and start reading
// from it.
defineAll();

// Reflect the density on the root as well as on the shell, so a preference is
// visible to CSS before the shell has rendered.
store.subscribe((state, prev) => {
  if (state.density !== prev.density) document.documentElement.dataset.density = state.density;
});
document.documentElement.dataset.density = store.state.density;

installShortcuts();

/**
 * A reload should land where it left off. A `src` in the URL always wins — that
 * link is being explicit about which document it means — and otherwise the last
 * one loaded here comes back: re-fetched if it came from a URL, or from the
 * copy kept on this machine if it came from a file.
 */
function restoreSchema() {
  if (parseHash().src) return false;
  const stored = readSchema();
  if (!stored) return false;
  if (stored.url) {
    ingest(loadFromUrl(stored.url), { restoring: true });
    return true;
  }
  ingest(Promise.resolve({ text: stored.text, name: stored.name, via: 'file', note: null }), { restoring: true });
  return true;
}

restoreSchema();
router.start();
/* A handle for tests and for poking at state in a console. Reading it is
   harmless; the app itself never uses it. */
globalThis.__aw = { store, actions };

export { store, actions };
