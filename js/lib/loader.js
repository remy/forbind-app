/**
 * Getting a schema into the browser.
 *
 * Three routes, in order of how much they involve anyone else:
 *
 *  1. A local file — read with FileReader, nothing leaves the machine.
 *  2. A URL fetched straight from the browser — works when the host sends
 *     CORS headers, which most published schemas do.
 *  3. The same URL via allyway's one server-side endpoint, used only when (2)
 *     is blocked. This is the whole reason there is a server at all, and the
 *     UI says which route it used so nobody has to guess.
 */

import { SchemaError } from './openapi.js';

/** The Netlify function. Relative, so it works on any deploy preview too. */
const RELAY_ENDPOINT = '/api/fetch-schema';

const MAX_BYTES = 8 * 1024 * 1024;

/** @param {File} file @returns {Promise<{text: string, name: string, via: 'file'}>} */
export async function loadFromFile(file) {
  if (!file) throw new SchemaError('No file was chosen.');
  if (file.size > MAX_BYTES) {
    throw new SchemaError(`That file is ${formatBytes(file.size)}, which is larger than the ${formatBytes(MAX_BYTES)} limit.`);
  }
  const text = await file.text();
  return { text, name: file.name || 'schema', via: 'file' };
}

/**
 * @param {string} rawUrl
 * @param {{fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<{text: string, name: string, via: 'direct'|'relay', note: string|null}>}
 */
export async function loadFromUrl(rawUrl, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const url = normaliseUrl(rawUrl);

  let directError = null;
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json, application/yaml, text/yaml, text/plain, */*' } });
    if (response.ok) {
      const text = await response.text();
      return { text, name: fileNameFromUrl(url), via: 'direct', note: null };
    }
    directError = `The server answered ${response.status} ${response.statusText}.`;
  } catch (error) {
    // A cross-origin block and a dead host are indistinguishable from here —
    // fetch reports both as an opaque TypeError. Say so honestly.
    directError = describeFetchFailure(error);
  }

  // Fall back to the relay, which is not subject to the browser's same-origin
  // rules. If the relay is not deployed (running from a plain static server)
  // this 404s and we surface the original problem, not a confusing second one.
  try {
    const relayUrl = `${RELAY_ENDPOINT}?url=${encodeURIComponent(url)}`;
    const response = await fetchImpl(relayUrl);
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.text) {
      return {
        text: payload.text,
        name: fileNameFromUrl(url),
        via: 'relay',
        note: `Your browser could not fetch that URL directly (${directError}) so allyway fetched it server-side instead.`,
      };
    }
    if (payload?.error) {
      throw new SchemaError(`Could not fetch that URL. ${payload.error}`, { directError });
    }
  } catch (error) {
    if (error instanceof SchemaError) throw error;
    // Relay unavailable — fall through to the direct error below.
  }

  throw new SchemaError(`Could not fetch that URL. ${directError}`, {
    hint: 'If the server does not send an `Access-Control-Allow-Origin` header, a browser cannot read the response. Download the file and drop it in instead.',
  });
}

/** Same-origin sample, so no CORS story at all. */
export async function loadSample(path, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const response = await fetchImpl(path);
  if (!response.ok) throw new SchemaError(`The bundled sample could not be loaded (${response.status}).`);
  return { text: await response.text(), name: path.split('/').pop(), via: 'file', note: null };
}

/**
 * A fetch rejection carries no detail by design. Rather than guessing, name
 * the two things it can be and tell the reader how to tell them apart.
 */
export function describeFetchFailure(error) {
  const message = String(error?.message ?? error ?? '');
  if (/aborted|timeout/i.test(message)) return 'The request timed out.';
  return (
    'The browser blocked the response or could not reach the host. ' +
    'That is almost always a missing `Access-Control-Allow-Origin` header on the other server (CORS) — ' +
    'a browser cannot read a cross-origin response without it.'
  );
}

export function normaliseUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) throw new SchemaError('Enter a URL first.');
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    throw new SchemaError(`“${value}” is not a URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SchemaError('Only http and https URLs can be fetched.');
  }
  return url.toString();
}

function fileNameFromUrl(url) {
  try {
    const { pathname, hostname } = new URL(url);
    const last = pathname.split('/').filter(Boolean).pop();
    return last || hostname;
  } catch {
    return 'schema';
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
