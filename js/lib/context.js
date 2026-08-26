/**
 * The application context: the one store, the router, and the services the
 * components need. Components import `app()` rather than being handed props,
 * which keeps the custom elements usable in any order and in any nesting.
 */

let current = null;

/** @param {object} context */
export function setApp(context) {
  current = context;
}

/** @returns {{store: import('./store.js').Store, router: object, actions: object}} */
export function app() {
  if (!current) throw new Error('The app context was read before it was set.');
  return current;
}

export function hasApp() {
  return current !== null;
}
