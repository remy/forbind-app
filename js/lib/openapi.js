/**
 * OpenAPI / Swagger normalisation.
 *
 * Takes a raw document (OpenAPI 3.0/3.1 or Swagger 2.0, from JSON or YAML) and
 * flattens it into the one shape the rest of the app renders. Everything the UI
 * needs is computed once, here: operation ids, tag counts, verb counts, the
 * parse report, and the `$ref` names that make "jump to schema" possible.
 *
 * `$ref`s are resolved against the document itself. External refs are reported
 * as a warning rather than fetched — following them would mean network calls
 * from a screen that promises nothing leaves the browser.
 */

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Verb column order in the filter bar. */
export const VERB_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE'];

/** DELETE is shown as DEL in the narrow pill column, as in the design. */
export function verbLabel(method) {
  return method === 'DELETE' ? 'DEL' : method;
}

export function verbClass(method) {
  const key = String(method).toLowerCase();
  if (key === 'get') return 'get';
  if (key === 'post') return 'post';
  if (key === 'patch' || key === 'put') return 'patch';
  if (key === 'delete') return 'delete';
  return 'other';
}

/** 2xx success, 3xx info, 4xx warn, 5xx error — plus `default`. */
export function statusClass(code) {
  const n = Number.parseInt(code, 10);
  if (!Number.isFinite(n)) return 'neutral';
  if (n >= 200 && n < 300) return 'success';
  if (n >= 300 && n < 400) return 'info';
  if (n === 422 || n >= 500) return 'error';
  if (n >= 400) return 'warn';
  return 'neutral';
}

/* -------------------------------------------------------------------------
   Ref resolution
------------------------------------------------------------------------- */

/** Decode one JSON-Pointer segment (RFC 6901). */
function unescapePointer(segment) {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Resolve a local JSON pointer such as `#/components/schemas/Booking`.
 * @returns {unknown} the referenced node, or undefined if it does not resolve.
 */
export function resolvePointer(doc, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let node = doc;
  for (const raw of ref.slice(2).split('/')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[unescapePointer(raw)];
  }
  return node;
}

/**
 * The `$ref` a node points at, if it points at one — the value that makes a
 * branch recognisable as one already open further up.
 */
export function refOf(schemaNode) {
  return schemaNode && typeof schemaNode === 'object' && typeof schemaNode.$ref === 'string'
    ? schemaNode.$ref
    : null;
}

/**
 * The `$ref` a payload is really about, looking through an array wrapper.
 *
 * `children: Node[]` is the same shape as `parent: Node`, but only the second
 * carries the `$ref` at the top. Without looking through the array, a list of
 * a self-referencing type unrolls level after level of the same fields.
 */
export function payloadRef(doc, node) {
  const direct = refOf(node);
  if (direct) return direct;
  const { value } = deref(doc, node);
  if (value && (value.type === 'array' || value.items)) return refOf(value.items);
  return null;
}

/** The trailing name of a ref, used as the display name for a schema. */
export function refName(ref) {
  if (typeof ref !== 'string') return null;
  const parts = ref.split('/');
  return unescapePointer(parts[parts.length - 1]);
}

/**
 * Follow `$ref` chains one level at a time until a concrete node is reached.
 * Records the *first* ref name seen so the UI can link to the named schema
 * rather than showing an inlined blob.
 *
 * @returns {{value: object, name: string|null, external: boolean, missing: boolean}}
 */
export function deref(doc, node, seen = new Set()) {
  let current = node;
  let name = null;
  let external = false;
  while (current && typeof current === 'object' && typeof current.$ref === 'string') {
    const ref = current.$ref;
    if (!ref.startsWith('#')) return { value: {}, name: refName(ref), external: true, missing: false };
    if (seen.has(ref)) return { value: {}, name: name ?? refName(ref), external, missing: false };
    seen.add(ref);
    if (name === null) name = refName(ref);
    const next = resolvePointer(doc, ref);
    if (next === undefined) return { value: {}, name, external, missing: true };
    // A sibling-keyword $ref (allowed in 3.1) keeps the local annotations.
    const siblings = { ...current };
    delete siblings.$ref;
    current = Object.keys(siblings).length ? { ...next, ...siblings } : next;
  }
  return { value: current ?? {}, name, external, missing: false };
}

/* -------------------------------------------------------------------------
   Type description
------------------------------------------------------------------------- */

/**
 * A one-word-ish human type for a schema node: `string`, `integer`,
 * `Customer`, `Booking[]`, `string | null`, `oneOf`.
 *
 * @returns {{label: string, ref: string|null}} `ref` names a component schema
 *   the label points at, which is what makes the type cell a link.
 */
export function describeType(doc, node, depth = 0) {
  if (!node || typeof node !== 'object') return { label: 'any', ref: null };
  if (typeof node.$ref === 'string') {
    const name = refName(node.$ref);
    return { label: name ?? 'ref', ref: node.$ref.startsWith('#') ? name : null };
  }
  if (depth > 6) return { label: 'object', ref: null };

  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(node[key]) && node[key].length) {
      const parts = node[key].map((child) => describeType(doc, child, depth + 1));
      const nonNull = parts.filter((part) => part.label !== 'null');
      if (key === 'allOf' && nonNull.length === 1) return nonNull[0];
      if (nonNull.length === 1 && parts.length === 2) {
        return { label: `${nonNull[0].label} | null`, ref: nonNull[0].ref };
      }
      return { label: parts.map((part) => part.label).join(key === 'allOf' ? ' & ' : ' | '), ref: null };
    }
  }

  // 3.1 allows `type` to be an array, e.g. ["string", "null"].
  const type = Array.isArray(node.type) ? node.type.filter((t) => t !== 'null') : node.type;
  const nullable = Array.isArray(node.type) ? node.type.includes('null') : node.nullable === true;
  const base = Array.isArray(type) ? type[0] : type;

  if (base === 'array') {
    const item = describeType(doc, node.items ?? {}, depth + 1);
    return { label: `${item.label}[]${nullable ? ' | null' : ''}`, ref: item.ref };
  }
  if (!base) {
    if (node.properties) return { label: nullable ? 'object | null' : 'object', ref: null };
    if (node.enum) return { label: 'enum', ref: null };
    return { label: 'any', ref: null };
  }
  return { label: nullable ? `${base} | null` : base, ref: null };
}

/**
 * The Notes column: the constraints that actually change how you call the
 * endpoint, in the order a reader wants them.
 * @returns {string[]}
 */
export function describeConstraints(node) {
  if (!node || typeof node !== 'object') return [];
  const out = [];
  if (node.format) out.push(node.format);
  if (Array.isArray(node.enum)) {
    const values = node.enum.map((v) => String(v));
    out.push(values.length > 4 ? `one of ${values.length}: ${values.slice(0, 3).join(', ')}…` : `one of ${values.join(', ')}`);
  }
  const min = node.minimum ?? node.exclusiveMinimum;
  const max = node.maximum ?? node.exclusiveMaximum;
  if (typeof min === 'number' && typeof max === 'number') out.push(`${min}–${max}`);
  else if (typeof min === 'number') out.push(`min ${min}`);
  else if (typeof max === 'number') out.push(`max ${max}`);
  if (typeof node.minLength === 'number' && typeof node.maxLength === 'number') {
    out.push(`${node.minLength}–${node.maxLength} chars`);
  } else if (typeof node.maxLength === 'number') out.push(`max ${node.maxLength} chars`);
  else if (typeof node.minLength === 'number') out.push(`min ${node.minLength} chars`);
  if (typeof node.pattern === 'string') out.push(`pattern ${node.pattern}`);
  if (node.default !== undefined) out.push(`default ${JSON.stringify(node.default)}`);
  if (node.readOnly) out.push('read-only');
  if (node.writeOnly) out.push('write-only');
  return out;
}

/**
 * Flatten an object schema into displayable field rows. One level deep: nested
 * objects are shown by name and link to their own schema, because an
 * arbitrarily deep inline tree is exactly the thing that becomes unreadable.
 *
 * @returns {Array<{name: string, type: {label: string, ref: string|null}, required: boolean, notes: string, description: string}>}
 */
export function fieldRows(doc, schemaNode) {
  const { value } = deref(doc, schemaNode);
  let target = value;
  // allOf composition is common for "base + extras"; merge the properties.
  if (Array.isArray(value.allOf)) {
    target = value.allOf.reduce((acc, part) => {
      const resolved = deref(doc, part).value;
      return {
        ...acc,
        ...resolved,
        properties: { ...(acc.properties ?? {}), ...(resolved.properties ?? {}) },
        required: [...(acc.required ?? []), ...(resolved.required ?? [])],
      };
    }, {});
  }
  if (target.type === 'array' || target.items) {
    const item = deref(doc, target.items ?? {}).value;
    if (item.properties) target = item;
  }
  const properties = target.properties;
  if (!properties || typeof properties !== 'object') return [];
  const required = new Set(Array.isArray(target.required) ? target.required : []);

  return Object.entries(properties).map(([name, raw]) => {
    const resolved = deref(doc, raw);
    const node = typeof raw === 'object' && raw && raw.$ref ? { ...resolved.value, ...raw } : raw;
    const type = describeType(doc, raw);
    const constraints = describeConstraints(resolved.value.$ref ? resolved.value : node);
    const description = String(resolved.value.description ?? node?.description ?? '').trim();
    return {
      name,
      type,
      required: required.has(name),
      notes: constraints.join(' · '),
      description,
      deprecated: Boolean(resolved.value.deprecated ?? node?.deprecated),
      /** The field's own schema, so a caller can walk into it. */
      schema: raw,
      /** Enum members, which read better as a list than as a `notes` string. */
      values: Array.isArray(resolved.value.enum) ? resolved.value.enum.map(String) : null,
    };
  });
}

/**
 * Everything one level below a payload node, whatever shape that level takes.
 *
 * A body is usually an object with fields, but it is just as often a `oneOf`
 * or `anyOf` of several shapes — an array of three different kinds of unit,
 * say. Those have no fields of their own, so asking only for `fieldRows` says
 * "no named fields" about a payload that plainly has some. This returns
 * whichever of the two a node actually has, so the caller can render one
 * without having to know which it will get.
 *
 * @returns {{kind: 'fields'|'variants', items: object[]}|null}
 */
export function payloadChildren(doc, node, depth = 0) {
  if (depth > 4) return null;
  const rows = fieldRows(doc, node);
  if (rows.length) return { kind: 'fields', items: rows };

  const variants = unionVariants(doc, node);
  if (variants.length > 1) return { kind: 'variants', items: variants };
  // A one-member union, or `X | null`, is just X wearing a wrapper.
  if (variants.length === 1) return payloadChildren(doc, variants[0].schema, depth + 1);
  return null;
}

/**
 * The meaningful members of a `oneOf`/`anyOf`, unwrapping an array first so
 * that "an array of one of three things" reads as the three things.
 *
 * A bare `null` member is dropped: `describeType` already folds that into
 * "string | null", and offering it as a branch to open would be noise.
 */
function unionVariants(doc, node) {
  const { value } = deref(doc, node);
  let target = value;
  if (!target.oneOf && !target.anyOf && (target.type === 'array' || target.items)) {
    const item = deref(doc, target.items ?? {}).value;
    if (item.oneOf || item.anyOf) target = item;
  }

  const members = target.oneOf ?? target.anyOf;
  if (!Array.isArray(members)) return [];

  return members
    .filter((member) => {
      const resolved = deref(doc, member).value;
      const type = Array.isArray(resolved.type) ? resolved.type : [resolved.type];
      return !(type.length === 1 && type[0] === 'null');
    })
    .map((member, index) => {
      const resolved = deref(doc, member).value;
      const named = refName(refOf(member) ?? '') || resolved.title;
      // Untitled variants are told apart by what they carry, which is the only
      // thing that distinguishes them in most real documents.
      const keys = Object.keys(resolved.properties ?? {}).slice(0, 4);
      return {
        name: named || `Option ${index + 1}`,
        type: describeType(doc, member),
        required: false,
        notes: named || !keys.length ? '' : keys.join(', '),
        description: String(resolved.description ?? '').trim(),
        deprecated: Boolean(resolved.deprecated),
        schema: member,
        values: null,
        variant: true,
      };
    });
}

/**
 * Whether a schema has a level below it worth opening.
 *
 * Used to decide which rows in a payload get a disclosure and which are leaves,
 * so a field that expands to nothing never offers a control that does nothing.
 *
 * @param {object} doc
 * @param {unknown} schemaNode
 * @param {Set<string>} [seen] refs already open on this branch — a schema that
 *   contains itself is legal and must not be treated as infinitely deep.
 */
export function hasChildren(doc, schemaNode, seen = new Set()) {
  if (!schemaNode || typeof schemaNode !== 'object') return false;
  // Array-aware, so a list of a type counts as the type for cycle purposes.
  const ref = payloadRef(doc, schemaNode);
  if (ref && seen.has(ref)) return false;
  return payloadChildren(doc, schemaNode) !== null;
}



/* -------------------------------------------------------------------------
   Operation ids
------------------------------------------------------------------------- */

/**
 * URL-safe, human-readable, stable across reloads: `post-v2-bookings`.
 *
 * Derived from the method and path rather than from `operationId`, because the
 * id ends up in a URL somebody pastes into a ticket and `postV2Bookings` reads
 * far worse there than `post-v2-bookings` — and plenty of documents have no
 * `operationId` at all. The document's own id is kept on the operation and is
 * searchable; it just is not the address.
 */
export function makeOperationId(method, path) {
  const slug = `${method} ${path}`
    .replace(/[{}]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || 'operation';
}

/* -------------------------------------------------------------------------
   Normalisation
------------------------------------------------------------------------- */

function pickContent(doc, content) {
  if (!content || typeof content !== 'object') return null;
  const keys = Object.keys(content);
  if (!keys.length) return null;
  const preferred =
    keys.find((k) => k.includes('application/json')) ??
    keys.find((k) => k.includes('json')) ??
    keys[0];
  const media = content[preferred] ?? {};
  const named = namedSchema(doc, media.schema);
  return {
    contentType: preferred,
    schema: media.schema ?? null,
    schemaName: named.name,
    // Everything reachable a couple of levels in, so that searching for a
    // schema name finds the operations that return it inside an envelope.
    schemaNames: named.all,
    example: media.example ?? (media.examples ? Object.values(media.examples)[0]?.value : undefined),
  };
}

/**
 * The schema a payload is "of".
 *
 * A response is very often not a bare `$ref` but an array of one, or a paging
 * envelope with the interesting type nested inside. Reporting `null` for those
 * would mean `Booking` matching nothing when someone searches for it, and no
 * link to jump to, so the wrapper is looked through.
 *
 * @returns {{name: string|null, all: string[]}}
 */
function namedSchema(doc, node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 2) return { name: null, all: [] };
  const direct = deref(doc, node);
  if (direct.name) return { name: direct.name, all: [direct.name] };

  const schema = direct.value;
  const nested = [];
  let primary = null;
  const candidates = [
    schema.items,
    ...(schema.properties ? Object.values(schema.properties) : []),
    ...(Array.isArray(schema.oneOf) ? schema.oneOf : []),
    ...(Array.isArray(schema.anyOf) ? schema.anyOf : []),
    ...(Array.isArray(schema.allOf) ? schema.allOf : []),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const found = namedSchema(doc, candidate, depth + 1);
    if (found.name && primary === null) primary = found.name;
    nested.push(...found.all);
  }
  return { name: primary, all: [...new Set(nested)] };
}

function normaliseServers(doc) {
  if (Array.isArray(doc.servers) && doc.servers.length) {
    return doc.servers.map((server) => ({
      url: applyServerVariables(String(server.url ?? ''), server.variables),
      description: server.description ?? '',
    }));
  }
  // Swagger 2.0
  if (doc.host || doc.basePath) {
    const scheme = Array.isArray(doc.schemes) && doc.schemes.length ? doc.schemes[0] : 'https';
    const host = doc.host ?? '';
    const base = doc.basePath ?? '';
    return [{ url: host ? `${scheme}://${host}${base}` : base, description: '' }];
  }
  return [];
}

function applyServerVariables(url, variables) {
  if (!variables || typeof variables !== 'object') return url;
  return url.replace(/\{([^}]+)\}/g, (match, name) => {
    const variable = variables[name];
    if (!variable) return match;
    return String(variable.default ?? (Array.isArray(variable.enum) ? variable.enum[0] : match));
  });
}

/** Swagger 2.0 `securityDefinitions` use the same shape as 3.x schemes. */
function normaliseSecuritySchemes(doc) {
  const source = doc.components?.securitySchemes ?? doc.securityDefinitions ?? {};
  const out = {};
  for (const [id, raw] of Object.entries(source)) {
    const scheme = deref(doc, raw).value;
    let type = scheme.type;
    let httpScheme = scheme.scheme;
    // 2.0 spelled bearer auth as `type: basic` or an apiKey in a header.
    if (type === 'basic') { type = 'http'; httpScheme = 'basic'; }
    out[id] = {
      id,
      type,
      scheme: httpScheme,
      bearerFormat: scheme.bearerFormat,
      name: scheme.name,
      in: scheme.in,
      flows: scheme.flows ?? (scheme.flow ? { [scheme.flow]: { scopes: scheme.scopes } } : undefined),
      description: scheme.description ?? '',
      openIdConnectUrl: scheme.openIdConnectUrl,
    };
  }
  return out;
}

/** A short human label: `http bearer`, `apiKey in header (X-Api-Key)`. */
export function describeScheme(scheme) {
  if (!scheme) return '';
  if (scheme.type === 'http') return `http ${scheme.scheme ?? ''}`.trim();
  if (scheme.type === 'apiKey') return `apiKey in ${scheme.in ?? 'header'}`;
  if (scheme.type === 'oauth2') return 'oauth2';
  if (scheme.type === 'openIdConnect') return 'openIdConnect';
  return String(scheme.type ?? 'unknown');
}

/** The qualifier shown after the scheme name in the auth sheet. */
export function describeSchemeDetail(scheme) {
  if (!scheme) return '';
  if (scheme.type === 'http' && scheme.scheme === 'bearer') {
    return `— ${scheme.bearerFormat ?? 'token'}, header \`Authorization\``;
  }
  if (scheme.type === 'http' && scheme.scheme === 'basic') return '— header `Authorization`';
  if (scheme.type === 'apiKey') return `— ${scheme.in ?? 'header'} \`${scheme.name ?? ''}\``;
  if (scheme.type === 'oauth2') {
    const flows = Object.keys(scheme.flows ?? {});
    return flows.length ? `— flows: ${flows.join(', ')}` : '';
  }
  return '';
}

function securityToList(security, schemes) {
  if (!Array.isArray(security)) return [];
  const out = [];
  for (const requirement of security) {
    if (!requirement || typeof requirement !== 'object') continue;
    for (const [schemeId, scopes] of Object.entries(requirement)) {
      out.push({
        schemeId,
        scopes: Array.isArray(scopes) ? scopes : [],
        scheme: schemes[schemeId] ?? null,
      });
    }
  }
  return out;
}

/** Swagger 2.0 put the body in `parameters`; 3.x has `requestBody`. */
function splitSwagger2Parameters(doc, parameters) {
  const params = [];
  let body = null;
  let formFields = [];
  for (const raw of parameters) {
    const param = deref(doc, raw).value;
    if (param.in === 'body') {
      body = {
        required: Boolean(param.required),
        description: param.description ?? '',
        contentType: 'application/json',
        schema: param.schema ?? null,
        schemaName: namedSchema(doc, param.schema).name,
        schemaNames: namedSchema(doc, param.schema).all,
      };
    } else if (param.in === 'formData') {
      formFields.push(param);
    } else {
      params.push(param);
    }
  }
  if (formFields.length && !body) {
    body = {
      required: formFields.some((f) => f.required),
      description: '',
      contentType: 'application/x-www-form-urlencoded',
      schema: {
        type: 'object',
        required: formFields.filter((f) => f.required).map((f) => f.name),
        properties: Object.fromEntries(formFields.map((f) => [f.name, f])),
      },
      schemaName: null,
    };
  }
  return { params, body };
}

/**
 * @param {object} doc a parsed OpenAPI/Swagger document
 * @param {string} sourceName the filename or URL it came from
 * @returns {object} the normalised model the UI renders
 */
export function normalise(doc, sourceName = 'schema') {
  if (!doc || typeof doc !== 'object') {
    throw new SchemaError('That file did not contain an object at the top level.');
  }

  const oasVersion = doc.openapi ?? doc.swagger ?? null;
  if (!oasVersion) {
    throw new SchemaError(
      'No `openapi` or `swagger` version field found — this does not look like an OpenAPI document.',
    );
  }
  const isV2 = String(oasVersion).startsWith('2');

  const notes = [];
  const securitySchemes = normaliseSecuritySchemes(doc);
  const servers = normaliseServers(doc);
  const globalSecurity = securityToList(doc.security, securitySchemes);

  const schemaSource = doc.components?.schemas ?? doc.definitions ?? {};
  const schemas = Object.entries(schemaSource).map(([name, node]) => ({
    name,
    node,
    ref: isV2 ? `#/definitions/${name}` : `#/components/schemas/${name}`,
  }));

  const paths = doc.paths ?? {};
  const operations = [];
  const seenIds = new Map();
  let missingSummaries = 0;
  let externalRefs = 0;
  let brokenRefs = 0;

  for (const [path, pathItemRaw] of Object.entries(paths)) {
    if (!pathItemRaw || typeof pathItemRaw !== 'object') continue;
    const pathItem = deref(doc, pathItemRaw).value;
    const sharedParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const method of HTTP_METHODS) {
      const raw = pathItem[method];
      if (!raw || typeof raw !== 'object') continue;
      const op = deref(doc, raw).value;
      const verb = method.toUpperCase();

      const allParamsRaw = [...sharedParams, ...(Array.isArray(op.parameters) ? op.parameters : [])];
      let parameters = [];
      let requestBody = null;

      if (isV2) {
        const split = splitSwagger2Parameters(doc, allParamsRaw);
        parameters = split.params;
        requestBody = split.body;
      } else {
        parameters = allParamsRaw.map((p) => {
          const resolved = deref(doc, p);
          if (resolved.external) externalRefs += 1;
          if (resolved.missing) brokenRefs += 1;
          return resolved.value;
        });
        if (op.requestBody) {
          const body = deref(doc, op.requestBody).value;
          const picked = pickContent(doc, body.content);
          requestBody = picked
            ? {
                required: Boolean(body.required),
                description: body.description ?? '',
                ...picked,
              }
            : null;
        }
      }

      // De-duplicate parameters: an operation-level one wins over a path-level
      // one with the same name and location.
      const paramKey = (p) => `${p.in}:${p.name}`;
      const paramMap = new Map();
      for (const p of parameters) {
        if (!p || !p.name) continue;
        paramMap.set(paramKey(p), p);
      }
      parameters = [...paramMap.values()].map((p) => {
        const schemaNode = p.schema ?? (isV2 ? { type: p.type, format: p.format, enum: p.enum, items: p.items, default: p.default } : {});
        return {
          name: p.name,
          in: p.in ?? 'query',
          required: p.in === 'path' ? true : Boolean(p.required),
          description: String(p.description ?? '').trim(),
          deprecated: Boolean(p.deprecated),
          schema: schemaNode,
          type: describeType(doc, schemaNode),
          constraints: describeConstraints(deref(doc, schemaNode).value),
        };
      });

      const responseEntries = Object.entries(op.responses ?? {});
      const responses = responseEntries
        .map(([code, responseRaw]) => {
          const response = deref(doc, responseRaw).value;
          let picked = null;
          if (isV2 && response.schema) {
            const named = namedSchema(doc, response.schema);
            picked = {
              contentType: 'application/json',
              schema: response.schema,
              schemaName: named.name,
              schemaNames: named.all,
            };
          } else if (!isV2) {
            picked = pickContent(doc, response.content);
          }
          return {
            code,
            description: String(response.description ?? '').trim(),
            headers: response.headers ?? null,
            ...(picked ?? {}),
          };
        })
        .sort((a, b) => statusSort(a.code) - statusSort(b.code));

      const summary = String(op.summary ?? '').trim();
      if (!summary) missingSummaries += 1;

      let id = makeOperationId(verb, path);
      if (seenIds.has(id)) {
        const n = seenIds.get(id) + 1;
        seenIds.set(id, n);
        id = `${id}-${n}`;
      } else {
        seenIds.set(id, 1);
      }

      const security = op.security !== undefined
        ? securityToList(op.security, securitySchemes)
        : globalSecurity;

      operations.push({
        id,
        operationId: op.operationId ?? null,
        method: verb,
        path,
        summary,
        description: String(op.description ?? '').trim(),
        tags: Array.isArray(op.tags) && op.tags.length ? op.tags.map(String) : ['Untagged'],
        deprecated: Boolean(op.deprecated),
        parameters,
        requestBody,
        responses,
        security,
        scopes: [...new Set(security.flatMap((s) => s.scopes))],
        servers: Array.isArray(op.servers) && op.servers.length
          ? op.servers.map((s) => ({ url: applyServerVariables(String(s.url ?? ''), s.variables), description: s.description ?? '' }))
          : servers,
        externalDocs: op.externalDocs ?? null,
        /* Vendor extensions the detail pane surfaces as facts when present.
           Absent ones simply do not render a row — nothing is invented. */
        extensions: {
          rateLimit: op['x-rate-limit'] ?? op['x-ratelimit'] ?? null,
          idempotent: op['x-idempotent'] ?? null,
          since: op['x-since'] ?? null,
        },
      });
    }
  }

  /* --- tags --------------------------------------------------------------
     Declared order first (the document's own `tags` array is an authored
     running order), then anything else alphabetically. */
  const counts = new Map();
  for (const op of operations) {
    for (const tag of op.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const declared = Array.isArray(doc.tags) ? doc.tags.map((t) => String(t.name)) : [];
  const tagNames = [
    ...declared.filter((name) => counts.has(name)),
    ...[...counts.keys()].filter((name) => !declared.includes(name)).sort((a, b) => a.localeCompare(b)),
  ];
  const tagDescriptions = new Map(
    (Array.isArray(doc.tags) ? doc.tags : []).map((t) => [String(t.name), String(t.description ?? '')]),
  );
  const tags = tagNames.map((name) => ({
    name,
    count: counts.get(name) ?? 0,
    description: tagDescriptions.get(name) ?? '',
  }));

  const deprecatedCount = operations.filter((op) => op.deprecated).length;

  /* --- the parse report -------------------------------------------------
     Framed as "things worth knowing", not errors: a schema with loose docs is
     still perfectly browsable. Every row is led by a word, never a colour or
     an icon. */
  if (missingSummaries > 0) {
    notes.push({
      level: 'WARN',
      parts: [
        `${missingSummaries} operation${missingSummaries === 1 ? ' has' : 's have'} no `,
        { code: 'summary' },
        missingSummaries === 1 ? ' — it will list by path only.' : ' — they will list by path only.',
      ],
    });
  }

  const looseFormats = findLooseFormats(doc, schemas);
  if (looseFormats.length) {
    const first = looseFormats[0];
    notes.push({
      level: 'WARN',
      parts: [
        { code: first },
        looseFormats.length > 1
          ? ` and ${looseFormats.length - 1} other field${looseFormats.length > 2 ? 's' : ''} have no format — try-it validation will be loose.`
          : ' has no format — try-it validation will be loose.',
      ],
    });
  }

  const schemeIds = Object.keys(securitySchemes);
  if (schemeIds.length === 0) {
    notes.push({
      level: 'INFO',
      parts: ['No security scheme is declared, so requests are sent unauthenticated.'],
    });
  } else if (schemeIds.length === 1) {
    const only = securitySchemes[schemeIds[0]];
    notes.push({
      level: 'INFO',
      parts: [
        'One security scheme found: ',
        { code: describeScheme(only) },
        only.type === 'http' && only.scheme === 'bearer'
          ? ' — auth setup will ask for a token only.'
          : ' — auth setup will ask for that credential only.',
      ],
    });
  } else {
    notes.push({
      level: 'INFO',
      parts: [`${schemeIds.length} security schemes found — auth setup will let you pick between them.`],
    });
  }

  if (!servers.length) {
    notes.push({
      level: 'WARN',
      parts: ['No server URL is declared — snippets and requests will need a base URL you supply.'],
    });
  }
  if (externalRefs > 0) {
    notes.push({
      level: 'WARN',
      parts: [`${externalRefs} reference${externalRefs === 1 ? ' points' : 's point'} at another file and was not followed — those fields will show as empty.`],
    });
  }
  if (brokenRefs > 0) {
    notes.push({
      level: 'FAIL',
      parts: [`${brokenRefs} `, { code: '$ref' }, `${brokenRefs === 1 ? ' does' : ' do'} not resolve inside this document.`],
    });
  }
  if (!operations.length) {
    notes.push({ level: 'FAIL', parts: ['No paths were found, so there is nothing to browse.'] });
  }

  return {
    doc,
    sourceName,
    title: String(doc.info?.title ?? sourceName),
    version: String(doc.info?.version ?? ''),
    description: String(doc.info?.description ?? '').trim(),
    oasVersion: String(oasVersion),
    oasLabel: isV2 ? `Swagger ${oasVersion}` : `OpenAPI ${oasVersion}`,
    servers,
    securitySchemes,
    globalSecurity,
    operations,
    schemas,
    tags,
    verbCounts: countVerbs(operations),
    report: {
      counts: {
        endpoints: operations.length,
        tags: tags.length,
        schemas: schemas.length,
        deprecated: deprecatedCount,
      },
      notes,
      ok: !notes.some((n) => n.level === 'FAIL'),
    },
  };
}

function statusSort(code) {
  const n = Number.parseInt(code, 10);
  return Number.isFinite(n) ? n : 9999;
}

function countVerbs(operations) {
  const counts = new Map();
  for (const op of operations) counts.set(op.method, (counts.get(op.method) ?? 0) + 1);
  return VERB_ORDER.filter((verb) => counts.has(verb)).map((verb) => ({ verb, count: counts.get(verb) }));
}

/** String fields with no `format`, which is what makes validation loose. */
function findLooseFormats(doc, schemas) {
  const out = [];
  // Only names for which a standard `format` actually exists — flagging a
  // field nobody can annotate correctly is noise, not a warning.
  const hintNames = /(^|[._-])(email|url|uri|date|datetime|uuid|password)($|[._-])/i;
  for (const { name, node } of schemas) {
    const resolved = deref(doc, node).value;
    const properties = resolved.properties;
    if (!properties) continue;
    for (const [field, raw] of Object.entries(properties)) {
      const prop = deref(doc, raw).value;
      if (prop.type === 'string' && !prop.format && hintNames.test(field)) {
        out.push(`${name}.${field}`);
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------
   Text -> document
------------------------------------------------------------------------- */

export class SchemaError extends Error {
  constructor(message, detail = null) {
    super(message);
    this.name = 'SchemaError';
    this.detail = detail;
  }
}

/**
 * Parse raw text as JSON or YAML. JSON is tried first when the text looks like
 * JSON, because a JSON syntax error message is far more precise than the YAML
 * parser's take on the same file.
 *
 * @param {string} raw
 * @param {{loadYaml: (text: string) => unknown}} deps
 */
export function parseText(raw, deps) {
  const trimmed = raw.replace(/^﻿/, '').trim();
  if (!trimmed) throw new SchemaError('That file is empty.');

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new SchemaError('That file starts like JSON but is not valid JSON.', {
        message: error.message,
        ...locateJsonError(trimmed, error),
      });
    }
  }

  try {
    return deps.loadYaml(trimmed);
  } catch (error) {
    const mark = error.mark ?? {};
    throw new SchemaError('That file is not valid YAML.', {
      message: String(error.reason ?? error.message ?? error),
      line: typeof mark.line === 'number' ? mark.line + 1 : null,
      column: typeof mark.column === 'number' ? mark.column + 1 : null,
      snippet: typeof mark.line === 'number' ? lineAt(trimmed, mark.line) : null,
    });
  }
}

/**
 * Turn a JSON.parse message into a place in the file.
 *
 * V8 phrases this two ways depending on where the parse gave up: sometimes
 * "at position 11 (line 3 column 1)", sometimes just the offending token and a
 * quoted excerpt. Both are handled, and neither is required — a message with
 * no location still produces a usable error, just without the line.
 */
function locateJsonError(source, error) {
  const message = error.message ?? '';

  const lineColumn = /line (\d+) column (\d+)/.exec(message);
  if (lineColumn) {
    const line = Number(lineColumn[1]);
    return { line, column: Number(lineColumn[2]), snippet: lineAt(source, line - 1) };
  }

  const position = /position (\d+)/.exec(message);
  if (position) {
    const offset = Number(position[1]);
    const before = source.slice(0, offset);
    const line = before.split('\n').length;
    return { line, column: offset - before.lastIndexOf('\n'), snippet: lineAt(source, line - 1) };
  }

  // "Unexpected token 'x', \"…excerpt…\" is not valid JSON": find the excerpt.
  const excerpt = /"((?:[^"\\]|\\.)*)" is not valid JSON/.exec(message);
  if (excerpt) {
    const needle = excerpt[1].replace(/\\(.)/g, '$1').replace(/\.\.\.$/, '');
    const offset = source.indexOf(needle.slice(0, 40));
    if (offset >= 0) {
      const before = source.slice(0, offset);
      const line = before.split('\n').length;
      return { line, column: offset - before.lastIndexOf('\n'), snippet: lineAt(source, line - 1) };
    }
  }

  return { line: null, column: null, snippet: null };
}

function lineAt(source, index) {
  const lines = source.split('\n');
  return index >= 0 && index < lines.length ? lines[index] : null;
}
