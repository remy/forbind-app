/**
 * The values a field is allowed to take.
 *
 * An `enum` is the document saying "one of these, and nothing else", and a
 * field like that has no business being a free text box: a dropdown carries
 * the same information, cannot be typed wrong, and is announced by screen
 * readers as a list with a position in it. The catch is that documents rarely
 * write the enum where the field is. They name it once, as a schema, and point
 * at it — often through an `allOf` wrapper so a description can sit alongside
 * the `$ref`. This follows those hops so the control is chosen on what the
 * field actually allows rather than on how the document happened to spell it.
 *
 * Only single values are resolved. An array of enums wants a multi-select and
 * a different validation story, so it stays the text field it is today.
 */

import { deref } from './openapi.js';

const MAX_DEPTH = 6;

/**
 * @param {object} doc         the raw document, for resolving `$ref`s
 * @param {object} schemaNode  a parameter or property schema
 * @returns {string[]|null} the allowed values, or null when it is not an enum
 */
export function enumValues(doc, schemaNode, depth = 0) {
  if (!schemaNode || typeof schemaNode !== 'object' || depth > MAX_DEPTH) return null;

  const node = deref(doc, schemaNode).value;
  if (!node || typeof node !== 'object') return null;

  if (Array.isArray(node.enum) && node.enum.length) return usable(node.enum);

  // `allOf: [{$ref: …}, {description: …}]` is how a document adds prose to a
  // named enum without redefining it; the values still come from the one
  // member that has them.
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    const branches = node[key];
    if (!Array.isArray(branches) || !branches.length) continue;
    const found = branches
      .map((branch) => enumValues(doc, branch, depth + 1))
      .filter(Boolean);
    // Two branches offering different sets is a choice this cannot make for
    // the reader, so it leaves them the text field.
    if (found.length === 1) return found[0];
    if (found.length > 1) return null;
  }

  return null;
}

/**
 * Values a `<select>` can actually carry. `null` inside an enum means "send
 * nothing", which the empty option already says, and an object or array in a
 * single-value field is not something a dropdown can express.
 */
function usable(values) {
  const out = values
    .filter((value) => value !== null && typeof value !== 'object')
    .map(String);
  return out.length ? [...new Set(out)] : null;
}
