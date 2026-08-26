import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from '../js/vendor/js-yaml.mjs';
import { normalise, parseText } from '../js/lib/openapi.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const yamlDeps = { loadYaml: (text) => yaml.load(text) };

let cached = null;
/** The bundled sample, parsed once. */
export function sampleModel() {
  if (cached) return cached;
  const text = fs.readFileSync(path.join(root, 'samples/bookings-api.v2.yaml'), 'utf8');
  cached = normalise(parseText(text, yamlDeps), 'bookings-api.v2.yaml');
  return cached;
}

export function op(model, method, apiPath) {
  const found = model.operations.find((o) => o.method === method && o.path === apiPath);
  if (!found) throw new Error(`No ${method} ${apiPath} in the model`);
  return found;
}

export const emptyFilters = {
  query: '', tags: [], verbs: [], hideDeprecated: false, onlyDeprecated: false, scopes: [], statusCodes: [],
};
