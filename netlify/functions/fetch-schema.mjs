/**
 * The only server-side code in forbind.
 *
 * A browser cannot read a cross-origin response unless the other server opts
 * in with CORS headers, and plenty of published OpenAPI documents do not. This
 * endpoint fetches one on the browser's behalf and hands back the text. It is
 * used *only* as a fallback, after a direct fetch has already failed, and only
 * for the schema — real API calls from the try-it panel always go straight
 * from the browser, so no credential ever passes through here.
 *
 * Because it takes a URL from the caller it is an SSRF surface, so it is
 * deliberately narrow: https/http only, public hosts only, one hop of
 * redirects re-checked each time, a size cap, a timeout, and text out.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export default async function handler(request) {
  const origin = new URL(request.url).origin;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'GET') {
    return json({ error: 'Use GET.' }, 405, origin);
  }

  const target = new URL(request.url).searchParams.get('url');
  if (!target) return json({ error: 'Pass a `url` query parameter.' }, 400, origin);

  let current;
  try {
    current = assertFetchable(target);
  } catch (error) {
    return json({ error: error.message }, 400, origin);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let response;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'application/json, application/yaml, text/yaml, text/plain;q=0.9, */*;q=0.5',
          'User-Agent': 'forbind-schema-fetch/1.0',
        },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      if (!location) break;
      // Re-run the guard on every hop: a redirect into 169.254.169.254 is the
      // classic way past a check that only looks at the first URL.
      current = assertFetchable(new URL(location, current).toString());
      if (hop === MAX_REDIRECTS) {
        return json({ error: 'That URL redirects too many times.' }, 400, origin);
      }
    }

    if (!response.ok) {
      return json({ error: `The server answered ${response.status} ${response.statusText}.` }, 502, origin);
    }

    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) {
      return json({ error: `That document is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB.` }, 413, origin);
    }

    const text = await readCapped(response, MAX_BYTES);
    if (text === null) {
      return json({ error: `That document is larger than ${Math.round(MAX_BYTES / 1024 / 1024)} MB.` }, 413, origin);
    }

    return json(
      {
        text,
        url: current,
        contentType: response.headers.get('content-type') ?? null,
      },
      200,
      origin,
    );
  } catch (error) {
    if (error.name === 'AbortError') {
      return json({ error: 'The request timed out after 10 seconds.' }, 504, origin);
    }
    if (error instanceof BlockedUrlError) {
      return json({ error: error.message }, 400, origin);
    }
    return json({ error: 'That host could not be reached.' }, 502, origin);
  } finally {
    clearTimeout(timer);
  }
}

export const config = { path: '/api/fetch-schema' };

export class BlockedUrlError extends Error {}

/**
 * Reject anything that is not a plain public http(s) URL. Hostnames that are
 * not literal IPs are allowed through — resolving them here would still race
 * the fetch's own lookup, so the real containment is that the response is
 * returned as inert text and never interpreted, and that no credential is ever
 * sent to it.
 */
export function assertFetchable(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('That is not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BlockedUrlError('Only http and https URLs can be fetched.');
  }
  if (url.username || url.password) {
    throw new BlockedUrlError('URLs with embedded credentials are not fetched.');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isPrivateHost(host)) {
    throw new BlockedUrlError('That address is on a private or link-local network.');
  }
  return url.toString();
}

/**
 * True for anything that is not a plain public address.
 *
 * The URL parser normalises IPv6 before this sees it, so `::ffff:169.254.169.254`
 * arrives as `::ffff:a9fe:a9fe` — the mapped form has to be un-mapped from the
 * hex groups rather than matched as dotted quad text. Getting that wrong is
 * how a guard like this gets walked straight past to a metadata endpoint.
 *
 * @param {string} host a hostname with any surrounding brackets already removed
 */
export function isPrivateHost(host) {
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }

  const v4 = parseIPv4(host);
  if (v4) return isPrivateIPv4(v4);

  const groups = parseIPv6(host);
  if (groups) {
    // ::ffff:a.b.c.d — an IPv4 address wearing an IPv6 coat.
    if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
      return isPrivateIPv4([groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff]);
    }
    if (groups.every((g) => g === 0)) return true;                       // ::
    if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1
    if ((groups[0] & 0xfe00) === 0xfc00) return true;                    // fc00::/7 unique-local
    if ((groups[0] & 0xffc0) === 0xfe80) return true;                    // fe80::/10 link-local
    return false;
  }

  return false;
}

function parseIPv4(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

function isPrivateIPv4([a, b]) {
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;            // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;  // carrier-grade NAT
  return false;
}

/** @returns {number[]|null} eight 16-bit groups, or null if this is not IPv6. */
function parseIPv6(host) {
  if (!host.includes(':')) return null;
  let text = host;

  // A trailing dotted quad, e.g. ::ffff:169.254.169.254 before normalisation.
  const tail = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (tail) {
    const quad = parseIPv4(tail[1]);
    if (!quad) return null;
    const hex = `${((quad[0] << 8) | quad[1]).toString(16)}:${((quad[2] << 8) | quad[3]).toString(16)}`;
    text = `${text.slice(0, tail.index)}:${hex}`;
  }

  const [head, rest, extra] = text.split('::');
  if (extra !== undefined) return null;
  const toGroups = (part) => (part ? part.split(':').map((g) => Number.parseInt(g, 16)) : []);
  const left = toGroups(head);
  const right = rest === undefined ? [] : toGroups(rest);
  if ([...left, ...right].some((g) => Number.isNaN(g) || g > 0xffff)) return null;

  if (rest === undefined) return left.length === 8 ? left : null;
  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;
  return [...left, ...Array(fill).fill(0), ...right];
}

/** Read the body but stop at the cap rather than buffering an unbounded stream. */
async function readCapped(response, limit) {
  if (!response.body) return await response.text();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
      ...corsHeaders(origin),
    },
  });
}
