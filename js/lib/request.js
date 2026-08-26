/**
 * Turning an operation into a request — and into a snippet.
 *
 * One request model feeds both the `curl` block and the try-it sender, so what
 * the snippet shows is exactly what the button sends. The one deliberate
 * difference is the credential: `buildRequest` takes a `revealCredential` flag
 * and the snippet path always leaves it false, so a copied command carries
 * `$TOKEN` and never the real value. That is a promise the auth sheet makes in
 * so many words, so it is enforced here rather than at the call site.
 */

import { deref } from './openapi.js';

/** A placeholder that reads as a placeholder in a shell. */
function credentialPlaceholder(scheme) {
  if (!scheme) return '$TOKEN';
  if (scheme.type === 'http' && scheme.scheme === 'basic') return '$BASIC_CREDENTIALS';
  if (scheme.type === 'apiKey') return '$API_KEY';
  return '$TOKEN';
}

/**
 * An example value for a schema node, used to fill path params and to draft a
 * request body. Prefers what the document actually says (`example`, `default`,
 * the first `enum`) and only invents a value as a last resort.
 */
export function sampleValue(doc, node, depth = 0) {
  const { value: schema, name } = deref(doc, node);
  if (!schema || typeof schema !== 'object') return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (depth > 4) return name ? `{${name}}` : null;

  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce((acc, part) => {
      const sub = sampleValue(doc, part, depth + 1);
      return sub && typeof sub === 'object' && !Array.isArray(sub) ? { ...acc, ...sub } : acc;
    }, {});
  }
  for (const key of ['oneOf', 'anyOf']) {
    if (Array.isArray(schema[key]) && schema[key].length) {
      return sampleValue(doc, schema[key][0], depth + 1);
    }
  }

  const type = Array.isArray(schema.type)
    ? schema.type.find((t) => t !== 'null') ?? 'null'
    : schema.type;

  switch (type) {
    case 'array':
      return [sampleValue(doc, schema.items ?? {}, depth + 1)].filter((v) => v !== null || schema.items);
    case 'integer':
      return typeof schema.minimum === 'number' ? schema.minimum : 1;
    case 'number':
      return typeof schema.minimum === 'number' ? schema.minimum : 1.0;
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'string':
      return sampleString(schema);
    case 'object':
    default: {
      if (!schema.properties) return type === 'object' ? {} : sampleString(schema);
      const out = {};
      const required = new Set(Array.isArray(schema.required) ? schema.required : []);
      for (const [key, child] of Object.entries(schema.properties)) {
        const childSchema = deref(doc, child).value;
        // Keep the draft to what you have to send: required fields, plus any
        // optional one the document bothered to give an example for.
        if (!required.has(key) && childSchema.example === undefined && childSchema.default === undefined) continue;
        if (childSchema.readOnly) continue;
        out[key] = sampleValue(doc, child, depth + 1);
      }
      return out;
    }
  }
}

function sampleString(schema) {
  switch (schema.format) {
    case 'date': return '2026-01-31';
    case 'date-time': return '2026-01-31T18:30:00Z';
    case 'email': return 'a@rae.dev';
    case 'uuid': return '9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f';
    case 'uri':
    case 'url': return 'https://example.com';
    case 'byte': return 'ZXhhbXBsZQ==';
    case 'password': return '••••••••';
    default: return 'string';
  }
}

/** The value a path/query parameter should carry in a snippet. */
export function parameterExample(doc, param, override) {
  if (override !== undefined && override !== '') return override;
  const sample = sampleValue(doc, param.schema ?? {});
  if (sample === null || sample === undefined) return `{${param.name}}`;
  if (typeof sample === 'object') return `{${param.name}}`;
  if (sample === 'string') return `{${param.name}}`;
  return String(sample);
}

/**
 * @typedef {object} BuiltRequest
 * @property {string} method
 * @property {string} url          fully substituted, query string included
 * @property {Array<[string, string]>} headers
 * @property {string|null} body
 * @property {string[]} warnings   things the caller should say out loud
 * @property {boolean} credentialRevealed
 */

/**
 * @param {object} options
 * @param {object} options.model      the normalised schema
 * @param {object} options.operation
 * @param {string} [options.serverUrl]
 * @param {object} [options.auth]     { schemeId, credential }
 * @param {object} [options.values]   { path: {}, query: {}, header: {}, body: string }
 * @param {boolean} [options.revealCredential] false for snippets — always.
 * @returns {BuiltRequest}
 */
export function buildRequest({
  model,
  operation,
  serverUrl,
  auth = null,
  values = {},
  revealCredential = false,
}) {
  const doc = model?.doc ?? {};
  const warnings = [];
  const base = (serverUrl ?? operation.servers?.[0]?.url ?? model?.servers?.[0]?.url ?? '').replace(/\/+$/, '');
  if (!base) warnings.push('No server URL is declared in the schema, so the path is shown on its own.');

  const pathValues = values.path ?? {};
  let path = operation.path;
  for (const param of operation.parameters.filter((p) => p.in === 'path')) {
    const value = parameterExample(doc, param, pathValues[param.name]);
    path = path.replaceAll(`{${param.name}}`, encodeURIComponent(value).replace(/%7B|%7D/g, (m) => (m === '%7B' ? '{' : '}')));
  }

  const query = new URLSearchParams();
  const queryValues = values.query ?? {};
  for (const param of operation.parameters.filter((p) => p.in === 'query')) {
    const provided = queryValues[param.name];
    if (provided === undefined || provided === '') {
      if (!param.required) continue;
      query.append(param.name, parameterExample(doc, param));
      continue;
    }
    query.append(param.name, provided);
  }
  const qs = query.toString();
  const url = `${base}${path}${qs ? `?${qs}` : ''}`;

  /* --- headers --------------------------------------------------------- */
  const headers = [];
  const headerValues = values.header ?? {};

  const requirement = operation.security?.[0] ?? null;
  const scheme = requirement?.scheme ?? null;
  if (scheme) {
    const placeholder = credentialPlaceholder(scheme);
    const real = auth?.schemeId === requirement.schemeId ? (auth.credential ?? '').trim() : '';
    const secret = revealCredential && real ? real : placeholder;
    if (revealCredential && !real) {
      warnings.push('No credential is set for this operation\u2019s security scheme, so the request will be sent unauthenticated.');
    }
    if (scheme.type === 'http' && scheme.scheme === 'bearer') {
      headers.push(['Authorization', `Bearer ${secret}`]);
    } else if (scheme.type === 'http' && scheme.scheme === 'basic') {
      headers.push(['Authorization', `Basic ${secret}`]);
    } else if (scheme.type === 'apiKey' && scheme.in === 'header') {
      headers.push([scheme.name ?? 'X-API-Key', secret]);
    } else if (scheme.type === 'apiKey' && scheme.in === 'query') {
      const separator = url.includes('?') ? '&' : '?';
      return finish({
        method: operation.method,
        url: `${url}${separator}${encodeURIComponent(scheme.name ?? 'api_key')}=${secret}`,
        headers,
        operation,
        model,
        values,
        warnings,
        revealCredential,
      });
    } else if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
      headers.push(['Authorization', `Bearer ${secret}`]);
    }
  }

  for (const param of operation.parameters.filter((p) => p.in === 'header')) {
    const provided = headerValues[param.name];
    if (provided === undefined || provided === '') {
      if (!param.required) continue;
      headers.push([param.name, parameterExample(doc, param)]);
      continue;
    }
    headers.push([param.name, provided]);
  }

  return finish({ method: operation.method, url, headers, operation, model, values, warnings, revealCredential });
}

function finish({ method, url, headers, operation, model, values, warnings, revealCredential }) {
  const doc = model?.doc ?? {};
  let body = null;
  if (operation.requestBody) {
    const contentType = operation.requestBody.contentType ?? 'application/json';
    if (typeof values.body === 'string' && values.body.trim() !== '') {
      body = values.body;
    } else if (operation.requestBody.example !== undefined) {
      body = JSON.stringify(operation.requestBody.example, null, 2);
    } else if (operation.requestBody.schema) {
      const sample = sampleValue(doc, operation.requestBody.schema);
      body = contentType.includes('json')
        ? JSON.stringify(sample, null, 2)
        : new URLSearchParams(flattenForForm(sample)).toString();
    }
    if (body !== null && !headers.some(([name]) => name.toLowerCase() === 'content-type')) {
      headers.push(['Content-Type', contentType]);
    }
  }
  return { method, url, headers, body, warnings, credentialRevealed: revealCredential };
}

function flattenForForm(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]),
  );
}

/* -------------------------------------------------------------------------
   Snippets
------------------------------------------------------------------------- */

/** POSIX single-quote escaping. */
function shellQuote(value) {
  const str = String(value);
  // Leave `$TOKEN`-style placeholders interpolating: double quotes, not single.
  if (/^[A-Za-z0-9_./:@%+=-]+$/.test(str)) return str;
  return `"${str.replace(/(["\\`])/g, '\\$1')}"`;
}

/**
 * @param {BuiltRequest} request
 * @returns {string}
 */
export function toCurl(request) {
  const lines = [];
  const needsQuoting = /[{}?&\s]/.test(request.url);
  lines.push(`curl -X ${request.method} ${needsQuoting ? `"${request.url}"` : request.url}`);
  for (const [name, value] of request.headers) {
    lines.push(`  -H "${name}: ${String(value).replace(/"/g, '\\"')}"`);
  }
  if (request.body !== null && request.body !== undefined) {
    const compact = compactJson(request.body);
    lines.push(`  -d '${compact.replace(/'/g, `'\\''`)}'`);
  }
  return lines.join(' \\\n');
}

/** Body JSON is pretty-printed for editing but compact in the snippet. */
function compactJson(body) {
  try {
    const parsed = JSON.parse(body);
    const compact = JSON.stringify(parsed);
    return compact.length <= 160 ? compact : JSON.stringify(parsed, null, 2);
  } catch {
    return body;
  }
}

/** @param {BuiltRequest} request */
export function toFetch(request) {
  const lines = [`await fetch(${JSON.stringify(request.url)}, {`];
  lines.push(`  method: ${JSON.stringify(request.method)},`);
  if (request.headers.length) {
    lines.push('  headers: {');
    for (const [name, value] of request.headers) {
      lines.push(`    ${JSON.stringify(name)}: ${JSON.stringify(value)},`);
    }
    lines.push('  },');
  }
  if (request.body !== null && request.body !== undefined) {
    lines.push(`  body: JSON.stringify(${compactJson(request.body)}),`);
  }
  lines.push('});');
  return lines.join('\n');
}

/** @param {BuiltRequest} request */
export function toPython(request) {
  const lines = ['import requests', ''];
  if (request.headers.length) {
    lines.push('headers = {');
    for (const [name, value] of request.headers) {
      lines.push(`    ${JSON.stringify(name)}: ${JSON.stringify(value)},`);
    }
    lines.push('}');
  }
  if (request.body !== null && request.body !== undefined) {
    lines.push(`payload = ${pythonLiteral(request.body)}`);
  }
  const args = [JSON.stringify(request.url)];
  if (request.headers.length) args.push('headers=headers');
  if (request.body !== null && request.body !== undefined) args.push('json=payload');
  lines.push('');
  lines.push(`response = requests.${request.method.toLowerCase()}(${args.join(', ')})`);
  lines.push('response.raise_for_status()');
  return lines.join('\n');
}

function pythonLiteral(body) {
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify(parsed, null, 4)
      .replace(/\btrue\b/g, 'True')
      .replace(/\bfalse\b/g, 'False')
      .replace(/\bnull\b/g, 'None');
  } catch {
    return JSON.stringify(body);
  }
}

/** @type {Record<string, {label: string, render: (r: BuiltRequest) => string}>} */
export const SNIPPET_LANGUAGES = {
  curl: { label: 'curl', render: toCurl },
  fetch: { label: 'fetch', render: toFetch },
  python: { label: 'python', render: toPython },
};

/** Used by the copy announcement: "curl command copied, 5 lines". */
export function lineCount(snippet) {
  return snippet.split('\n').length;
}
