/**
 * The only server-side code in allyway.
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
          'User-Agent': 'allyway-schema-fetch/1.0',
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

class BlockedUrlError extends Error {}

/**
 * Reject anything that is not a plain public http(s) URL. Hostnames that are
 * not literal IPs are allowed through — resolving them here would still race
 * the fetch's own lookup, so the real containment is that the response is
 * returned as inert text and never interpreted, and that no credential is ever
 * sent to it.
 */
function assertFetchable(raw) {
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

function isPrivateHost(host) {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  if (host === '::1' || host === '0.0.0.0') return true;
  // IPv4-mapped IPv6, e.g. ::ffff:169.254.169.254
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  const candidate = mapped ? mapped[1] : host;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(candidate);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;         // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }
  // Unique-local and link-local IPv6.
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
  return false;
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
