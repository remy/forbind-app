/**
 * Filtering and search.
 *
 * Deliberately plain: a scored substring match over the fields a person
 * actually types — path, summary, operationId, tag, parameter names, response
 * codes and schema names. No fuzzy matching, because a fuzzy miss in a list
 * that is being read aloud is much worse than a literal one.
 */

/** Fields, in the order that decides the score. */
function haystack(op) {
  return {
    path: op.path.toLowerCase(),
    method: op.method.toLowerCase(),
    summary: op.summary.toLowerCase(),
    description: op.description.toLowerCase(),
    operationId: (op.operationId ?? '').toLowerCase(),
    tags: op.tags.join(' ').toLowerCase(),
    params: op.parameters.map((p) => p.name).join(' ').toLowerCase(),
    schemas: [
      ...(op.requestBody?.schemaNames ?? [op.requestBody?.schemaName]),
      ...op.responses.flatMap((r) => r.schemaNames ?? [r.schemaName]),
    ].filter(Boolean).join(' ').toLowerCase(),
    codes: op.responses.map((r) => r.code).join(' '),
    scopes: op.scopes.join(' ').toLowerCase(),
  };
}

const cache = new WeakMap();
function fields(op) {
  let value = cache.get(op);
  if (!value) {
    value = haystack(op);
    cache.set(op, value);
  }
  return value;
}

/**
 * @returns {number} 0 for no match, higher is better.
 */
export function score(op, query) {
  if (!query) return 1;
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const f = fields(op);
  // A leading verb narrows first: "post book" means POST endpoints about books.
  const words = q.split(/\s+/);
  let total = 0;
  for (const word of words) {
    let best = 0;
    if (f.method === word) best = Math.max(best, 60);
    if (f.path.includes(word)) best = Math.max(best, f.path.startsWith(word) ? 100 : 80);
    if (f.operationId.includes(word)) best = Math.max(best, 70);
    if (f.summary.includes(word)) best = Math.max(best, 50);
    if (f.tags.includes(word)) best = Math.max(best, 40);
    if (f.params.includes(word)) best = Math.max(best, 30);
    if (f.schemas.includes(word)) best = Math.max(best, 25);
    if (f.scopes.includes(word)) best = Math.max(best, 20);
    if (f.codes.includes(word)) best = Math.max(best, 15);
    if (f.description.includes(word)) best = Math.max(best, 10);
    if (best === 0) return 0; // every word must match something
    total += best;
  }
  return total;
}

/**
 * Apply the whole filter set. Returns operations in document order (with the
 * query's score used only as a tiebreak when a query is present), so that the
 * list does not reshuffle under the cursor for no reason.
 *
 * @param {object[]} operations
 * @param {object} filters
 */
export function filterOperations(operations, filters) {
  const { query, tags, verbs, hideDeprecated, onlyDeprecated, scopes, statusCodes } = filters;
  const tagSet = new Set(tags);
  const verbSet = new Set(verbs);
  const scopeSet = new Set(scopes);
  const codeSet = new Set(statusCodes);

  const matched = [];
  for (const op of operations) {
    if (hideDeprecated && op.deprecated) continue;
    if (onlyDeprecated && !op.deprecated) continue;
    if (tagSet.size && !op.tags.some((tag) => tagSet.has(tag))) continue;
    if (verbSet.size && !verbSet.has(op.method)) continue;
    if (scopeSet.size && !op.scopes.some((scope) => scopeSet.has(scope))) continue;
    if (codeSet.size && !op.responses.some((r) => codeSet.has(r.code))) continue;
    const s = score(op, query);
    if (s === 0) continue;
    matched.push({ op, score: s });
  }
  if (query && query.trim()) matched.sort((a, b) => b.score - a.score);
  return matched.map((m) => m.op);
}

/** Group filtered operations by their first tag, preserving tag order. */
export function groupByTag(operations, tagOrder) {
  const groups = new Map();
  for (const op of operations) {
    const tag = op.tags[0] ?? 'Untagged';
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag).push(op);
  }
  const order = tagOrder?.length ? tagOrder.map((t) => t.name ?? t) : [...groups.keys()];
  const ordered = [
    ...order.filter((name) => groups.has(name)),
    ...[...groups.keys()].filter((name) => !order.includes(name)),
  ];
  return ordered.map((name) => ({ name, operations: groups.get(name) }));
}

/**
 * Type-ahead within the list: the next operation whose path starts with the
 * typed letters, wrapping around from the current index.
 */
export function typeAheadIndex(operations, buffer, fromIndex) {
  if (!buffer) return -1;
  const needle = buffer.toLowerCase();
  const total = operations.length;
  for (let step = 1; step <= total; step += 1) {
    const index = (fromIndex + step) % total;
    const op = operations[index];
    const path = op.path.toLowerCase().replace(/^\//, '');
    if (path.startsWith(needle) || op.path.toLowerCase().startsWith(needle) || op.method.toLowerCase().startsWith(needle)) {
      return index;
    }
  }
  return -1;
}

/** Every scope mentioned anywhere in the document, for the scope facet. */
export function allScopes(operations) {
  return [...new Set(operations.flatMap((op) => op.scopes))].sort();
}

/** Every response code used anywhere, for the status-code facet. */
export function allStatusCodes(operations) {
  return [...new Set(operations.flatMap((op) => op.responses.map((r) => r.code)))]
    .sort((a, b) => (Number.parseInt(a, 10) || 9999) - (Number.parseInt(b, 10) || 9999));
}
