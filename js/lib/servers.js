/**
 * Where a request would actually be sent.
 *
 * `servers` is optional in OpenAPI, and plenty of published documents leave it
 * out, describe it relatively (`/v1`), or leave a variable unfilled
 * (`https://{region}.api.example`). All three mean the same thing to a reader:
 * there is no host to send to, so a snippet is only half a command and Try it
 * has nowhere to go.
 *
 * Detection lives here, on its own, so the parser, the import report and Try
 * it all agree on what "no server URL" means, and so a base URL the reader
 * supplies is resolved by one rule rather than three.
 */

/** An unfilled `{variable}` left over from a server template. */
const PLACEHOLDER = /[{}]/;

/**
 * @typedef {object} ServerCheck
 * @property {boolean} present  the document named at least one server
 * @property {boolean} usable   one of them is an absolute http(s) URL
 * @property {string|null} url  the first usable one, trailing slash removed
 * @property {'missing'|'relative'|'placeholder'|null} reason set when unusable
 */

/**
 * @param {Array<{url?: string}>} [servers]
 * @returns {ServerCheck}
 */
export function inspectServers(servers = []) {
  const urls = (servers ?? []).map((server) => String(server?.url ?? '').trim()).filter(Boolean);
  if (!urls.length) return { present: false, usable: false, url: null, reason: 'missing' };

  const absolute = urls.find((url) => isAbsoluteBase(url));
  if (absolute) return { present: true, usable: true, url: stripTrailingSlash(absolute), reason: null };

  // Something was declared but it cannot be sent to. Which of the two it is
  // decides the sentence the reader gets, so it is carried, not flattened.
  const reason = urls.some((url) => PLACEHOLDER.test(url)) ? 'placeholder' : 'relative';
  return { present: true, usable: false, url: null, reason };
}

/**
 * Absolute in the sense that matters here: a URL a browser can fetch.
 * @param {string} url
 */
export function isAbsoluteBase(url) {
  return /^https?:\/\/[^/]/i.test(String(url ?? '')) && !PLACEHOLDER.test(String(url ?? ''));
}

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

/**
 * The origin of the address a document was fetched from.
 *
 * A schema pulled over the network was served by something, and that something
 * is very often the API it describes — `https://api.example.com/openapi.json`
 * describes paths that hang off `https://api.example.com`. It is a guess, not a
 * fact the document states, so it is offered as a starting value for the reader
 * to accept or correct and never applied on their behalf.
 *
 * @param {string} [url] the address the schema came from, if it came from one
 * @returns {string} the origin, or '' for a file, a bad URL, or a scheme
 *   nothing can be sent to
 */
export function originFrom(url) {
  try {
    const parsed = new URL(String(url ?? ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

/**
 * The base URL to build a request against.
 *
 * One supplied by the reader wins: they typed it after being told the schema
 * has none, and it is also the only way to point a document at staging.
 *
 * @param {object} options
 * @param {object} [options.model]      the normalised schema
 * @param {object} [options.operation]  its own `servers` win over the document's
 * @param {string} [options.baseUrl]    what the reader supplied, if anything
 * @returns {string} '' when there is still nothing to send to
 */
export function baseUrlFor({ model = null, operation = null, baseUrl = '' } = {}) {
  const supplied = String(baseUrl ?? '').trim();
  if (supplied) return stripTrailingSlash(supplied);
  const fromOperation = inspectServers(operation?.servers);
  if (fromOperation.usable) return fromOperation.url;
  const fromModel = inspectServers(model?.servers);
  if (fromModel.usable) return fromModel.url;
  // A relative server URL is still better than nothing in a snippet: it is
  // what the document says, and it is what the path is relative to.
  const declared = operation?.servers?.[0]?.url ?? model?.servers?.[0]?.url ?? '';
  return PLACEHOLDER.test(declared) ? '' : stripTrailingSlash(String(declared).trim());
}

/**
 * Turn what someone typed into a base URL, or say why it is not one.
 *
 * A bare host is the common case — people type `api.example.com` and mean
 * `https://api.example.com` — so that is completed rather than rejected. The
 * rest are refused with a sentence, because a base URL that is silently wrong
 * produces a request that fails somewhere far from here.
 *
 * @param {string} input
 * @returns {{url: string|null, error: string|null}}
 */
export function normaliseBaseUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { url: null, error: 'Enter a base URL, such as https://api.example.com.' };
  if (PLACEHOLDER.test(raw)) {
    return { url: null, error: 'A base URL cannot contain a {variable} — fill it in with the value you want to call.' };
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { url: null, error: `${raw} is not a URL. A base URL looks like https://api.example.com/v2.` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { url: null, error: `A base URL has to be http or https, and that one is ${parsed.protocol.replace(':', '')}.` };
  }
  if (!parsed.hostname) {
    return { url: null, error: 'That base URL has no host, so there is nowhere to send the request.' };
  }
  if (parsed.search || parsed.hash) {
    return { url: null, error: 'Leave the query string and fragment off the base URL — the operation supplies those.' };
  }
  return { url: stripTrailingSlash(parsed.origin + parsed.pathname), error: null };
}

/**
 * The sentence that describes a missing base URL, in the reader's terms.
 * @param {'missing'|'relative'|'placeholder'|null} reason
 * @param {string} [declared] the unusable URL, when there is one to quote
 */
export function describeServerGap(reason, declared = '') {
  if (reason === 'relative') {
    return `The only server URL this schema declares is relative${declared ? ` (${declared})` : ''}, so there is no host behind the path.`;
  }
  if (reason === 'placeholder') {
    return `The server URL this schema declares still has a variable in it${declared ? ` (${declared})` : ''} and no default to fill it with.`;
  }
  return 'This schema declares no server URL, so there is no host behind the path.';
}
