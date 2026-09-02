/**
 * forbind — entry point.
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
import { Router, buildHash, parseHash, foldQuerySchema } from './lib/router.js';
import { announce } from './lib/announce.js';
import { documentTitle } from './lib/title.js';
import { normalise, parseText, SchemaError, describeScheme } from './lib/openapi.js';
import { filterOperations, allScopes, allStatusCodes } from './lib/search.js';
import { readJwt } from './lib/auth.js';
import { loadFromFile, loadFromUrl, loadSample } from './lib/loader.js';
import {
  readSchema, writeSchema, clearSchema,
  readAuth, writeAuth, clearAuth,
  readBaseUrl, writeBaseUrl, clearBaseUrl as dropStoredBaseUrl,
} from './lib/persist.js';
import { normaliseBaseUrl, originFrom } from './lib/servers.js';

import './components/fb-app.js';
import './components/fb-topbar.js';
import './components/fb-tag-rail.js';
import './components/fb-endpoint-list.js';
import './components/fb-detail.js';
import './components/fb-code-block.js';
import './components/fb-schema-tree.js';
import './components/fb-try-it.js';
import './components/fb-palette.js';
import './components/fb-auth-sheet.js';
import './components/fb-options.js';
import './components/fb-import.js';
import './components/fb-base-url.js';

const store = new Store();

/* Extra keys the components read that are not part of the base state shape. */
store.set({ importNote: null, schemaError: null });

let lastInvoker = null;
let optionsFocus = null;
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
/**
 * Filters the address asked for, held across a schema load.
 *
 * A document arriving clears the filters, because the ones on screen were
 * chosen for the document before it. But an address can carry filters as well
 * as a schema, and it always arrives first — the fetch has not even started
 * when `applyRoute` sets them — so clearing on the far side of the load throws
 * away the half of the link that says what to show. These are set aside
 * instead, and put back once the document they describe is there.
 */
let pendingFilters = null;
let schemaSource = null;

const router = new Router((route) => {
  if (route.src && route.src !== schemaSource) {
    // The URL names a schema this tab has not loaded. Fetch it, then land on
    // whatever the rest of the URL asked for.
    pendingSelection = { view: route.view, id: route.id };
    pendingFilters = route.filters;
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

async function ingest(promise, { note = null, restoring = false, url = '' } = {}) {
  // Claimed before the first await: whatever the address asked for belongs to
  // this load, and a load that fails must not leave it lying around for the
  // next schema someone opens by hand.
  const arrivingFilters = pendingFilters;
  pendingFilters = null;
  store.set({ schemaState: 'loading', schemaError: null, importNote: null, importUrl: url });
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
    // A base URL typed for this schema last time is not a preference — it is
    // the missing half of the document — so it comes back with it.
    const restoredBaseUrl = model.report.baseUrl.needed ? readBaseUrl(schemaKeyFor(source)) : '';
    // Nothing was remembered, but the schema came from somewhere, and where it
    // came from is usually where the API is. That is offered as the field's
    // starting value — a guess the reader accepts, edits or ignores — rather
    // than set as the base URL behind their back.
    const suggestedBaseUrl = model.report.baseUrl.needed && !restoredBaseUrl
      ? originFrom(source.url)
      : '';

    store.set({
      schema: model,
      schemaState: 'ready',
      // A link that named the schema in the URL knows where it is going, so it
      // goes straight there. Anyone who loaded a file by hand gets the parse
      // report first, because that is where the warnings are.
      browsing: Boolean(pendingSelection) || restoring,
      schemaError: null,
      importNote: source.note ?? note,
      // The form is behind us now; the address has nothing left to correct.
      importUrl: '',
      selectedOperationId: null,
      selectedSchemaName: null,
      activeRowId: null,
      baseUrl: restoredBaseUrl,
      baseUrlHint: suggestedBaseUrl,
      // A new document does not inherit the last one's filters — except the
      // ones the address it was named in asked for, which are about this
      // document and not the one before.
      filters: {
        ...store.state.filters,
        query: '', tags: [], verbs: [], scopes: [], statusCodes: [], onlyDeprecated: false,
        ...arrivingFilters,
      },
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
    // Landing straight on an operation means the report — and its warnings —
    // were never on screen, so the one warning that stops Try it working is
    // said out loud instead of waiting to be discovered at send time.
    const missingServer = model.report.baseUrl.needed && !restoredBaseUrl
      ? ' No server URL is declared, so requests need a base URL you supply.'
        + (suggestedBaseUrl ? ` The field starts at ${suggestedBaseUrl}, the origin this schema was fetched from.` : '')
      : '';
    // A link can name filters as well as a document, and the report's totals
    // then describe a list that is not the one on screen. Say what the list is
    // actually showing, so the narrowing is not something to discover.
    const shown = visibleOperations().length;
    const narrowed = shown === counts.endpoints
      ? ''
      : ` Filters from the link are applied: ${shown} of ${counts.endpoints} shown.`;
    announce(
      `${source.name} parsed. ${counts.endpoints} endpoints, ${counts.tags} tags, ${counts.schemas} schemas, ` +
      `${counts.deprecated} deprecated. ${model.report.notes.length} `
      + `${model.report.notes.length === 1 ? 'thing' : 'things'} worth knowing.${missingServer}${narrowed}`,
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

    // On a phone the list and the detail are separate pages, so opening a row
    // takes that row off screen — and the keyboard standing on it goes to
    // <body>. Send focus after the content the way selectSchema() already
    // does, and name what opened, because a pane arriving is otherwise
    // silent. On every wider layout the row is still there and focus belongs
    // on it: moving it would be the regression.
    if (isPhoneLayout()) {
      const op = store.state.schema?.operations.find((candidate) => candidate.id === id);
      requestAnimationFrame(() => document.querySelector('#detail')?.focus({ preventScroll: true }));
      if (op) announce(`${op.method} ${op.path}${op.summary ? `, ${op.summary}` : ''}. Detail open.`);
      return;
    }

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
    actions.showList();
    store.set({ mobileView: 'list' });
    go({ view: 'browse' });
    requestAnimationFrame(() => {
      const row = document.querySelector('a.row[tabindex="0"]') ?? document.querySelector('a.row');
      row?.focus({ preventScroll: false });
    });
  },

  focusList() {
    // The rows are still in the document when the column is folded away, so
    // focusing one would silently fail. Bring the list back first: being sent
    // to a list you cannot see is worse than the shortcut doing nothing.
    actions.showList();
    const row = document.querySelector('a.row[tabindex="0"]') ?? document.querySelector('a.row');
    row?.focus();
  },

  focusSearch() {
    const block = document.querySelector('fb-search-block') ?? document.querySelector('fb-topbar');
    if (block?.focusSearch) block.focusSearch();
    else document.querySelector('#search')?.focus();
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

  /**
   * "Set up auth first" from the parse report: authorise, then browse.
   *
   * In two steps, and the order is the point. The button that started this is
   * on the report, and the report is gone the moment browsing begins — so a
   * sheet opened in the same breath has no invoker left to hand the keyboard
   * back to, and closing it drops focus to the body. Browsing first puts the
   * top bar on screen; the Authorise button there is the same control in the
   * place it lives from now on, so that is what the sheet returns to.
   */
  authThenBrowse() {
    store.set({ browsing: true });
    lastInvoker = document.querySelector('#open-auth');
    store.set({ authOpen: true });
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

  /* --- base URL --------------------------------------------------------- */

  /**
   * Take the base URL someone typed for a schema that declares none.
   *
   * Refusing a URL is not a silent no-op: the sentence saying why comes back
   * to the caller so it can be shown beside the field and announced, because
   * a base URL that quietly did not stick is a request sent somewhere else.
   *
   * @param {string} input
   * @returns {{ok: boolean, url: string|null, error: string|null}}
   */
  setBaseUrl(input) {
    const { url, error } = normaliseBaseUrl(input);
    if (error) return { ok: false, url: null, error };
    store.set({ baseUrl: url });
    const schema = store.state.schema;
    if (schema) writeBaseUrl({ url, schemaKey: schemaSource ?? `file:${schema.sourceName}` });
    announce(`Base URL set to ${url}. Requests and snippets will use it.`);
    return { ok: true, url, error: null };
  },

  clearBaseUrl() {
    if (!store.state.baseUrl) return;
    // The suggestion goes with it. Clearing is a deliberate act of removal, and
    // an emptied field that refills itself with the guess the reader just threw
    // away is a field arguing with them.
    store.set({ baseUrl: '', baseUrlHint: '' });
    dropStoredBaseUrl();
    announce('Base URL cleared. Paths are shown on their own again.');
  },

  forgetAuth() {
    clearAuth();
    store.patch('auth', {
      credential: '', remember: false, verifyState: 'idle', message: '', scopes: [], expiresAt: null,
    });
    announce('Credential forgotten, and removed from this browser\u2019s storage.');
  },

  /**
   * @param {'base-url'|null} [focus] which control the sheet should open on.
   * Settings normally opens on the theme it is already set to; a command that
   * names one thing in it should land on that thing instead.
   */
  openOptions(focus = null) {
    lastInvoker = document.activeElement;
    optionsFocus = focus;
    store.set({ optionsOpen: true });
  },
  /** Read once by the sheet as it opens, and forgotten. */
  takeOptionsFocus() {
    const focus = optionsFocus;
    optionsFocus = null;
    return focus;
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

  /* --- columns ---------------------------------------------------------- */

  /**
   * Fold a navigation column away, or bring it back.
   *
   * Both are disclosures rather than a mode: the buttons that drive them stay
   * on screen with `aria-expanded` saying which way round it is, so a column
   * that is gone is never gone without a way back. Below the phone breakpoint
   * the flags are ignored — the list and the detail are already separate
   * pages there, and hiding the list would leave nothing to navigate with.
   */
  setRailCollapsed(collapsed) {
    setColumn('railCollapsed', collapsed);
    announce(collapsed ? 'Tag rail hidden.' : 'Tag rail shown.');
  },
  toggleRail() {
    actions.setRailCollapsed(!store.state.railCollapsed);
  },
  showRail() {
    if (store.state.railCollapsed) store.set({ railCollapsed: false });
  },

  setListCollapsed(collapsed) {
    setColumn('listCollapsed', collapsed);
    announce(collapsed ? 'Endpoint list hidden. The detail fills the frame.' : 'Endpoint list shown.');
  },
  toggleList() {
    actions.setListCollapsed(!store.state.listCollapsed);
  },
  showList() {
    if (store.state.listCollapsed) store.set({ listCollapsed: false });
  },

  /**
   * One step to the widest reading of an operation, and one step back.
   *
   * Maximised is not a third state — it is both columns folded — so the two
   * toggles keep telling the truth about what is on screen while it is on.
   */
  toggleMaximiseDetail() {
    const maximised = actions.detailMaximised();
    setColumn('railCollapsed', !maximised);
    setColumn('listCollapsed', !maximised);
    announce(maximised
      ? 'Columns restored.'
      : 'Detail maximised. The columns beside it are hidden.');
  },

  /**
   * Whether the detail already has the frame to itself.
   *
   * The roomy IA has no rail to fold, so its flag does not get a say there —
   * otherwise "maximise" would appear to do nothing the first time it is
   * pressed in a layout where the list was already the only column.
   */
  detailMaximised: () => store.state.listCollapsed
    && (store.state.density === 'roomy' || store.state.railCollapsed),

  /* --- schema ---------------------------------------------------------- */
  loadFile(file) {
    return ingest(loadFromFile(file));
  },
  loadUrl(url) {
    return ingest(loadFromUrl(url), { url });
  },
  loadSample(path) {
    return ingest(loadSample(path), { note: 'This is the example schema bundled with forbind. It describes an imaginary service.' });
  },
  replaceSchema() {
    clearSchema();
    clearAuth();
    dropStoredBaseUrl();
    schemaSource = null;
    // The filters go with the document they were chosen for — including out of
    // the address, which `go` rebuilds from them. Leaving them there would
    // make a reload restore a filter for a schema that is no longer loaded.
    store.set({
      schemaState: 'idle', browsing: false, schemaError: null, importNote: null, importUrl: '',
      baseUrl: '', baseUrlHint: '',
      filters: { ...store.state.filters, query: '', tags: [], verbs: [], scopes: [], statusCodes: [], onlyDeprecated: false },
    });
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
    const block = document.querySelector('fb-code-block');
    if (block && block.operation?.id === operation?.id) return block.copy(button);
    // No block on screen (a narrow layout on another tab, say): make one.
    const temporary = document.createElement('fb-code-block');
    temporary.operation = operation ?? currentOperation();
    document.body.appendChild(temporary);
    const done = temporary.copy(button);
    return Promise.resolve(done).finally(() => temporary.remove());
  },

  /**
   * Take the reader to the form, from wherever they asked.
   *
   * Try it is a tab, so the panel only exists while that tab is the open one
   * — and the phone's sticky "Try this request" is pressed from the tabs that
   * are not it. Asking the detail pane for the tab first is what makes the
   * button do something; testing for the panel first made it do nothing at
   * all on every tab but the one it was already on.
   */
  openTryIt(id) {
    if (id && store.state.selectedOperationId !== id) actions.selectOperation(id);
    const detail = document.querySelector('fb-detail');
    if (!detail?.showTab) return;
    detail.showTab('tryit');
    requestAnimationFrame(() => {
      const target = document.querySelector('fb-try-it input, fb-try-it textarea, fb-try-it select, fb-try-it button');
      target?.focus();
      target?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });
  },

  /** The palette's command list. */
  commands() {
    const state = store.state;
    return [
      { kind: 'command', label: 'Copy the request as curl', shortcut: '⇧⌘C', detail: null, run: () => actions.copyCurl(currentOperation()) },
      { kind: 'command', label: 'Replace the schema', shortcut: '⇧⌘U', detail: null, run: () => actions.replaceSchema() },
      { kind: 'command', label: 'Authorise requests', detail: null, run: () => actions.openAuth() },
      { kind: 'command', label: 'Settings', detail: null, run: () => actions.openOptions() },
      // Only worth offering for a document that left the gap — and it is the
      // way back to a base URL once Try it has stopped asking about it.
      ...(state.schema?.report?.baseUrl?.needed || state.baseUrl
        ? [{
            kind: 'command',
            label: state.baseUrl ? 'Change the base URL' : 'Set a base URL',
            detail: state.baseUrl || null,
            run: () => actions.openOptions('base-url'),
          }]
        : []),
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
        label: actions.detailMaximised() ? 'Restore the columns' : 'Maximise the detail',
        shortcut: '⇧⌘M',
        detail: null,
        run: () => actions.toggleMaximiseDetail(),
      },
      {
        kind: 'command',
        label: state.railCollapsed ? 'Show the tag rail' : 'Hide the tag rail',
        detail: null,
        run: () => actions.toggleRail(),
      },
      {
        kind: 'command',
        label: state.listCollapsed ? 'Show the endpoint list' : 'Hide the endpoint list',
        detail: null,
        run: () => actions.toggleList(),
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

/**
 * Set one of the column flags, and keep focus somewhere real.
 *
 * A column is hidden with CSS rather than removed, so anything focused inside
 * it does not vanish — it stops being focusable, and the browser drops focus
 * to the body. Where that would happen, focus goes to the button that folded
 * the column away, which is both where the keyboard now is and the way back.
 *
 * @param {'railCollapsed'|'listCollapsed'} key
 * @param {boolean} collapsed
 */
function setColumn(key, collapsed) {
  const rail = key === 'railCollapsed';
  const pane = document.querySelector(rail ? '#tag-nav' : '#endpoint-list');
  const active = document.activeElement;
  const losingFocus = collapsed && active instanceof HTMLElement && Boolean(pane?.contains(active));

  store.set({ [key]: collapsed });

  if (!losingFocus) return;
  const fallback = document.querySelector(rail ? '#toggle-rail' : '#toggle-list')
    ?? document.querySelector('#detail');
  fallback?.focus({ preventScroll: true });
}

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

/**
 * The width below which the list and the detail stop sharing the frame and
 * become separate pages. The same query as fb-app's SMALL_SCREEN: what the
 * layout does and what focus has to do about it are one decision.
 */
function isPhoneLayout() {
  return globalThis.matchMedia?.('(max-width: 48rem)').matches ?? false;
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
    if (mod && event.shiftKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      actions.toggleMaximiseDetail();
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

// The title names the route, so it is kept in step with the state the route
// is mirrored into rather than being set at each of the places that navigate.
store.subscribe((state) => {
  const next = documentTitle(state);
  if (document.title !== next) document.title = next;
});
document.title = documentTitle(store.state);

installShortcuts();

/**
 * A reload should land where it left off. A `src` in the URL always wins — that
 * link is being explicit about which document it means — and otherwise the last
 * one loaded here comes back: re-fetched if it came from a URL, or from the
 * copy kept on this machine if it came from a file.
 */
function restoreSchema() {
  const route = parseHash();
  if (route.src) return false;
  const stored = readSchema();
  if (!stored) return false;
  // The address is being honoured rather than replaced here, so a filter in it
  // belongs to the document coming back — same as one arriving with a `src`.
  pendingFilters = route.filters;
  if (stored.url) {
    ingest(loadFromUrl(stored.url), { restoring: true });
    return true;
  }
  ingest(Promise.resolve({ text: stored.text, name: stored.name, via: 'file', note: null }), { restoring: true });
  return true;
}

// `?url=…` is rewritten to the `#…?src=…` the router reads, before anything
// looks at the address — including `restoreSchema`, which stands aside for a
// URL that names a document.
const folded = foldQuerySchema(globalThis.location?.href ?? '');
if (folded) globalThis.history?.replaceState(null, '', folded);

restoreSchema();
router.start();
/* A handle for tests and for poking at state in a console. Reading it is
   harmless; the app itself never uses it. */
globalThis.__fb = { store, actions };

export { store, actions };
