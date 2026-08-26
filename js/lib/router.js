/**
 * Hash routing.
 *
 * Every operation and every schema is addressable, so a link to one can be
 * pasted into a ticket, and the browser's back button does what it looks like
 * it does. Filters ride along in the query part so a filtered view is
 * shareable too.
 *
 *   #/op/post-v2-bookings?tag=Bookings&verb=POST&q=book&deprecated=hide
 *   #/schema/Booking
 *   #/import
 */

/** @returns {{view: string, id: string|null, filters: object}} */
export function parseHash(hash = globalThis.location?.hash ?? '') {
  const raw = String(hash).replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(queryPart ?? '');

  const filters = {
    query: params.get('q') ?? '',
    tags: params.getAll('tag'),
    verbs: params.getAll('verb').map((v) => v.toUpperCase()),
    scopes: params.getAll('scope'),
    statusCodes: params.getAll('status'),
    hideDeprecated: params.get('deprecated') === 'hide',
  };

  if (segments[0] === 'op' && segments[1]) {
    return { view: 'operation', id: decodeURIComponent(segments[1]), filters };
  }
  if (segments[0] === 'schema' && segments[1]) {
    return { view: 'schema', id: decodeURIComponent(segments[1]), filters };
  }
  if (segments[0] === 'import') return { view: 'import', id: null, filters };
  return { view: 'browse', id: null, filters };
}

/** Build a hash for a target plus the current filters. */
export function buildHash({ view, id, filters }) {
  const params = new URLSearchParams();
  if (filters?.query) params.set('q', filters.query);
  for (const tag of filters?.tags ?? []) params.append('tag', tag);
  for (const verb of filters?.verbs ?? []) params.append('verb', verb);
  for (const scope of filters?.scopes ?? []) params.append('scope', scope);
  for (const code of filters?.statusCodes ?? []) params.append('status', code);
  if (filters?.hideDeprecated) params.set('deprecated', 'hide');
  const query = params.toString();

  let path = '/';
  if (view === 'operation' && id) path = `/op/${encodeURIComponent(id)}`;
  else if (view === 'schema' && id) path = `/schema/${encodeURIComponent(id)}`;
  else if (view === 'import') path = '/import';

  return `#${path}${query ? `?${query}` : ''}`;
}

export class Router {
  #handler;
  #suppress = false;

  /** @param {(route: object) => void} handler */
  constructor(handler) {
    this.#handler = handler;
    globalThis.addEventListener('hashchange', () => {
      if (this.#suppress) {
        this.#suppress = false;
        return;
      }
      this.#handler(parseHash());
    });
  }

  /** Read the URL now. */
  start() {
    this.#handler(parseHash());
  }

  /**
   * Push a new URL without re-entering the handler — the caller has already
   * applied the state change that prompted it.
   * @param {{view: string, id?: string|null, filters?: object}} target
   * @param {{replace?: boolean}} [options]
   */
  go(target, options = {}) {
    const hash = buildHash(target);
    if (hash === globalThis.location.hash) return;
    this.#suppress = true;
    if (options.replace) {
      globalThis.history.replaceState(null, '', hash);
      this.#suppress = false;
    } else {
      globalThis.location.hash = hash;
    }
  }
}
