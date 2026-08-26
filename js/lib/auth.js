/**
 * Credential handling.
 *
 * Two things happen here and nothing else: the credential is tidied up, and —
 * when it happens to be a JWT — its public claims are read locally so the
 * sheet can say how long it is good for without asking anybody. Nothing is
 * written anywhere. The value lives in the store, in memory, for the lifetime
 * of the tab.
 */

/**
 * "Paste a token or an `Authorization` header — we'll strip the prefix for
 * you." That sentence is in the UI, so it has to be true.
 */
export function normaliseCredential(raw) {
  let value = String(raw ?? '').trim();
  value = value.replace(/^authorization\s*:\s*/i, '').trim();
  value = value.replace(/^(bearer|token|basic)\s+/i, '').trim();
  // Paste from a terminal often brings quotes along.
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value;
}

/** Never show the whole thing; the last four characters are enough to tell two apart. */
export function maskCredential(value) {
  const str = String(value ?? '');
  if (!str) return '';
  if (str.length <= 4) return '•'.repeat(str.length);
  return `${'•'.repeat(Math.min(20, str.length - 4))}${str.slice(-4)}`;
}

function base64UrlDecode(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Read a JWT's payload. This is a *local* read of a public, unencrypted claim
 * set — it proves nothing about whether the token is accepted, only what it
 * says about itself, and the UI is careful to word it that way.
 *
 * @returns {{claims: object, scopes: string[], expiresAt: number|null, issuer: string|null}|null}
 */
export function readJwt(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(base64UrlDecode(parts[1]));
    if (!claims || typeof claims !== 'object') return null;
    const scopeClaim = claims.scope ?? claims.scp ?? claims.scopes ?? null;
    const scopes = Array.isArray(scopeClaim)
      ? scopeClaim.map(String)
      : typeof scopeClaim === 'string'
        ? scopeClaim.split(/[\s,]+/).filter(Boolean)
        : [];
    return {
      claims,
      scopes,
      expiresAt: typeof claims.exp === 'number' ? claims.exp * 1000 : null,
      issuer: typeof claims.iss === 'string' ? claims.iss : null,
      subject: typeof claims.sub === 'string' ? claims.sub : null,
    };
  } catch {
    return null;
  }
}

/** "expires in 51 min", "expired 3 min ago", "no expiry claim". */
export function describeExpiry(expiresAt, now = Date.now()) {
  if (!expiresAt) return null;
  const deltaMinutes = Math.round((expiresAt - now) / 60000);
  if (deltaMinutes === 0) return 'expires now';
  if (deltaMinutes < 0) {
    const ago = Math.abs(deltaMinutes);
    return ago < 60 ? `expired ${ago} min ago` : `expired ${Math.round(ago / 60)} h ago`;
  }
  if (deltaMinutes < 60) return `expires in ${deltaMinutes} min`;
  const hours = Math.round(deltaMinutes / 60);
  return hours < 48 ? `expires in ${hours} h` : `expires in ${Math.round(hours / 24)} days`;
}

/**
 * Pick the cheapest operation to probe with: a GET that needs this scheme, has
 * no required path parameters to invent, and preferably no required query
 * parameters either. If nothing qualifies we do not guess — the sheet says so
 * and offers the local read instead.
 */
export function pickProbeOperation(operations, schemeId) {
  const candidates = operations.filter(
    (op) =>
      op.method === 'GET' &&
      !op.deprecated &&
      op.security.some((s) => s.schemeId === schemeId) &&
      op.parameters.every((p) => p.in !== 'path') ,
  );
  if (!candidates.length) return null;
  const noRequiredQuery = candidates.find((op) => op.parameters.every((p) => !p.required));
  return noRequiredQuery ?? candidates[0];
}

/**
 * Turn an HTTP status into the sentence the verify block shows. A 401/403 is a
 * real answer — the token was understood and rejected — while anything else is
 * reported as what it is rather than being dressed up as a verdict.
 */
export function interpretProbe(status) {
  if (status === 401) return { state: 'invalid', word: 'REJECTED', text: `The API returned 401 Unauthorized — the token was not accepted.` };
  if (status === 403) return { state: 'invalid', word: 'FORBIDDEN', text: `The API returned 403 Forbidden — the token is understood but lacks the scope for this call.` };
  if (status >= 200 && status < 300) return { state: 'valid', word: 'VERIFIED', text: `The API accepted the token (HTTP ${status}).` };
  if (status === 404) return { state: 'valid', word: 'ACCEPTED', text: `The API returned 404 for the probe path, which still means the token passed authentication.` };
  if (status >= 500) return { state: 'idle', word: 'UNKNOWN', text: `The API returned ${status}, so this says nothing about the token.` };
  return { state: 'idle', word: 'UNKNOWN', text: `The API returned ${status}, which is not a clear answer either way.` };
}
