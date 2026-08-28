/**
 * The document title, derived from the route.
 *
 * Four screens share one address bar — import, parse report, the browser, and
 * a component schema — and until this existed they shared one title too. The
 * title is the tab, the history entry, and one of the few things a screen
 * reader can be asked to re-read after a route change, so it has to name which
 * of the four is on screen.
 *
 * Most specific part first: a tab truncated to a few characters still says
 * which endpoint you are on.
 */

const SITE = 'allyway';

/**
 * @param {object} state the store's state
 * @returns {string} what document.title should be for it
 */
export function documentTitle(state) {
  if (state.schemaState === 'loading') return `Loading a schema — ${SITE}`;
  if (state.schemaState === 'error') return `Could not load the schema — ${SITE}`;
  // Replacing a schema returns to the import screen without dropping the
  // parsed document, so the state — not the presence of a schema — decides.
  if (state.schemaState !== 'ready' || !state.schema) return `Load a schema — ${SITE}`;

  const api = state.schema.title;
  if (!state.browsing) return `Parse report — ${api} — ${SITE}`;
  if (state.selectedSchemaName) return `${state.selectedSchemaName} — ${api} — ${SITE}`;

  const op = state.schema.operations?.find((candidate) => candidate.id === state.selectedOperationId);
  if (op) return `${op.method} ${op.path} — ${api} — ${SITE}`;
  return `${api} — ${SITE}`;
}
