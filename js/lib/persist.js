/**
 * Everything allyway remembers, and where.
 *
 * One module so the rules are in one place and can be read at a glance:
 *
 * | What              | Where            | Lifetime                        |
 * |-------------------|------------------|---------------------------------|
 * | Settings          | localStorage     | until changed                   |
 * | The loaded schema | localStorage     | until another one is loaded     |
 * | A credential      | sessionStorage   | this tab, unless you ask for... |
 * | ...if remembered  | localStorage     | until you forget it             |
 *
 * The credential defaults to sessionStorage, which is per-tab and dies with
 * it. "Remember on this device" is an explicit, labelled opt-in — never a
 * default, and never silent, because the sheet tells the reader which of the
 * two is happening.
 *
 * Nothing here is sent anywhere. Storage is on the reader's own machine, which
 * is the same promise the import screen makes about the schema itself.
 */

const PREFS_KEY = 'allyway:prefs';
const SCHEMA_KEY = 'allyway:schema';
const AUTH_KEY = 'allyway:auth';

const PERSISTED_PREFS = ['theme', 'density', 'showHints', 'railCollapsed', 'listCollapsed'];

/**
 * A schema much larger than this is not worth pushing through localStorage —
 * quotas are commonly 5 MB and a write that throws mid-way is worse than not
 * trying. Above it, only the source is kept, so a URL can still be re-fetched
 * and a file can at least be named.
 */
const MAX_STORED_SCHEMA = 3 * 1024 * 1024;

function local() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Blocked entirely by a privacy setting; the app works without it.
    return null;
  }
}

function session() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function read(storage, key) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota, private mode, disabled storage. Remembering is a convenience;
    // failing to remember must never break the session in front of you.
    return false;
  }
}

function drop(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

/* -------------------------------------------------------------------------
   Settings
------------------------------------------------------------------------- */

export function readPrefs() {
  const stored = read(local(), PREFS_KEY);
  if (!stored) return {};
  const out = {};
  for (const key of PERSISTED_PREFS) {
    if (key in stored) out[key] = stored[key];
  }
  return out;
}

export function writePrefs(state) {
  const out = {};
  for (const key of PERSISTED_PREFS) out[key] = state[key];
  write(local(), PREFS_KEY, out);
}

/* -------------------------------------------------------------------------
   The loaded schema
------------------------------------------------------------------------- */

/**
 * @typedef {object} StoredSchema
 * @property {string} name      the filename or URL it came from
 * @property {string|null} url  set when it can simply be fetched again
 * @property {string|null} text the document itself, when it is small enough
 * @property {number} savedAt
 */

/**
 * @param {{name: string, url?: string|null, text: string}} source
 * @returns {StoredSchema|null} what was actually kept
 */
export function writeSchema(source) {
  const fits = typeof source.text === 'string' && source.text.length <= MAX_STORED_SCHEMA;
  const record = {
    name: source.name,
    url: source.url ?? null,
    // A URL can always be fetched again, so there is no reason to spend the
    // quota on a copy of it as well.
    text: fits && !source.url ? source.text : null,
    savedAt: Date.now(),
  };
  if (!record.url && !record.text) return null;
  return write(local(), SCHEMA_KEY, record) ? record : null;
}

/** @returns {StoredSchema|null} */
export function readSchema() {
  const stored = read(local(), SCHEMA_KEY);
  if (!stored || typeof stored.name !== 'string') return null;
  if (!stored.url && typeof stored.text !== 'string') return null;
  return stored;
}

export function clearSchema() {
  drop(local(), SCHEMA_KEY);
}

/* -------------------------------------------------------------------------
   The credential
------------------------------------------------------------------------- */

/**
 * A credential belongs to the API it was issued for, so it is stored against
 * the schema it was entered for and is not handed to a different one.
 *
 * @param {{credential: string, schemeId: string|null, remember: boolean, schemaKey: string}} auth
 */
export function writeAuth(auth) {
  // Whichever way round it is, clear the other store first, so switching
  // "remember" off actually removes the copy that was written to disk.
  drop(local(), AUTH_KEY);
  drop(session(), AUTH_KEY);
  if (!auth.credential) return;
  write(auth.remember ? local() : session(), AUTH_KEY, {
    credential: auth.credential,
    schemeId: auth.schemeId ?? null,
    remember: Boolean(auth.remember),
    schemaKey: auth.schemaKey,
  });
}

/**
 * @param {string} schemaKey the schema now loaded
 * @returns {{credential: string, schemeId: string|null, remember: boolean}|null}
 */
export function readAuth(schemaKey) {
  const stored = read(local(), AUTH_KEY) ?? read(session(), AUTH_KEY);
  if (!stored || typeof stored.credential !== 'string' || !stored.credential) return null;
  if (stored.schemaKey !== schemaKey) return null;
  return {
    credential: stored.credential,
    schemeId: stored.schemeId ?? null,
    remember: Boolean(stored.remember),
  };
}

export function clearAuth() {
  drop(local(), AUTH_KEY);
  drop(session(), AUTH_KEY);
}

/** Whether a remembered credential is sitting on disk right now. */
export function hasRememberedAuth() {
  return Boolean(read(local(), AUTH_KEY));
}
