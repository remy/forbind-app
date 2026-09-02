/**
 * Colouring a response body.
 *
 * The language is read off the response's own `Content-Type`, never guessed
 * from the text: what the server said it sent is the only claim about it that
 * is not us inventing one. A type nothing here handles — CSV, plain text, an
 * image, anything at all — is shown as plain text rather than coloured wrongly,
 * which is why this returns a `language` of `null` as a normal outcome.
 *
 * The colour is decoration on top of text that is already there and already
 * legible. Nothing in the app is said by highlighting: the body reads the same
 * with the stylesheet off, in forced colours, and to a screen reader, which is
 * why the spans carry no ARIA and no labels. What the palette *does* have to
 * do is clear 4.5:1 against the code surface, and every value in
 * `--syntax-*` was picked against that; see `css/tokens.css`.
 *
 * @see js/vendor/highlight/README.md for where the vendored library came from.
 */

import hljs from '../vendor/highlight/core.mjs';
import json from '../vendor/highlight/json.mjs';
import xml from '../vendor/highlight/xml.mjs';
import yaml from '../vendor/highlight/yaml.mjs';

hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

/**
 * Media types this can colour, longest-lived first.
 *
 * Matching is on the type alone — parameters like `; charset=utf-8` are cut off
 * before the lookup — and on the `+json` / `+xml` structured suffixes, which is
 * how `application/problem+json` and `image/svg+xml` announce what they really
 * are. A vendor type that says neither is not JSON just because most things
 * are.
 */
const TYPES = [
  [/^application\/(.*\+)?json$/, 'json'],
  [/^text\/json$/, 'json'],
  [/^(application|text|image)\/(.*\+)?xml$/, 'xml'],
  [/^text\/html$/, 'xml'],
  [/^(application|text)\/(x-)?yaml$/, 'yaml'],
];

/**
 * Which language a `Content-Type` header names, if it is one we can colour.
 *
 * @param {string} contentType the raw header, parameters and all
 * @returns {string|null} an hljs language name, or null to leave it plain
 */
export function languageFor(contentType) {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!type) return null;
  for (const [pattern, language] of TYPES) {
    if (pattern.test(type)) return language;
  }
  return null;
}

/**
 * Colour `code` as `language`, into an element the caller puts on the page.
 *
 * The text is set first and the markup only replaces it if highlighting
 * succeeds, so a grammar that throws — or a body long enough that we do not
 * try — degrades to exactly the plain block that was there before.
 *
 * @param {string} code the body as it is shown, already pretty-printed
 * @param {string|null} language from `languageFor`
 * @param {HTMLElement} target the element to fill
 * @returns {boolean} whether it ended up coloured
 */
export function highlightInto(code, language, target) {
  target.textContent = code;
  if (!language || !code) return false;
  // Highlighting is a synchronous parse on the main thread, and a response can
  // be megabytes. Past this the colour is not worth the pause, and the block is
  // just as readable without it.
  if (code.length > MAX_CHARS) return false;
  try {
    const { value } = hljs.highlight(code, { language, ignoreIllegals: true });
    // hljs escapes the text it is given, so what comes back is markup made of
    // `<span class="hljs-…">` around escaped source and nothing else.
    target.innerHTML = value;
    return true;
  } catch {
    return false;
  }
}

/** Big enough for any response worth reading in a pane this size. */
const MAX_CHARS = 200_000;
