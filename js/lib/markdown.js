/**
 * Descriptions, as the documents actually write them.
 *
 * `description` is CommonMark everywhere in OpenAPI, and real documents use it:
 * lists of allowed values, a fenced example, a link to the guide, a `code`
 * span naming another field. Rendered as plain text that reads as litter —
 * asterisks, backticks and pipes across a sentence — so it is parsed here and
 * turned into the elements it was describing.
 *
 * What it will not do:
 *
 * - **Raw HTML never renders.** `html: false`, so a `<script>` in a schema is
 *   escaped and shown as the text it is. The schema is someone else's file and
 *   is treated as such; there is no sanitiser here to get wrong.
 * - **Headings are pushed down, and renumbered.** A description sits inside a
 *   section of a page that already has an `<h1>` and an `<h2>`, so its own
 *   headings start at `<h3>` and stop at `<h6>` — and they are renumbered to
 *   run in sequence, because a document that opens its description with `###`
 *   would otherwise skip a level on the way in. The page's outline belongs to
 *   the page.
 * - **Images become links.** The CSP allows images from this origin only, so an
 *   `![…](https://elsewhere)` would render as a broken image; it renders as a
 *   link carrying the alt text instead, which says the same thing and always
 *   works.
 * - **Links say where they go.** External links open in a new tab — losing a
 *   half-filled try-it form to a documentation link would be its own bug — and
 *   because that is a surprise unless it is said, each one carries "(opens in a
 *   new tab)" in its accessible name.
 *
 * Somewhere a single line is all there is room for — a table cell, a row
 * summary, an accessible name — `markdownToText` strips the syntax rather than
 * showing it. Markup that cannot be rendered should be removed, not displayed.
 */

import markdownit from '../vendor/markdown-it.mjs';

/** The level a description's own first heading is rewritten to. */
const HEADING_BASE = 3;

const md = markdownit({
  html: false,
  linkify: true,
  breaks: false,
  // Smart quotes would rewrite the punctuation inside prose about an API, and
  // an API's prose is often about exact characters.
  typographer: false,
});

/* --- renderer rules ------------------------------------------------------ */

/*
 * Renumber the headings before anything renders them. Relative depth is kept —
 * a subheading stays under its heading — but the run starts at HEADING_BASE
 * and never climbs by more than one, so no level is skipped whatever the
 * document did. Skipping one is a real reading problem, and it is also the
 * thing axe fails the page for.
 */
md.core.ruler.push('aw_heading_levels', (state) => {
  let previousSource = 0;
  let previousOut = HEADING_BASE;
  for (const token of state.tokens) {
    if (token.type !== 'heading_open' && token.type !== 'heading_close') continue;
    const source = Number(token.tag.slice(1));
    if (token.type === 'heading_open') {
      let out;
      if (!previousSource) out = HEADING_BASE;
      else if (source > previousSource) out = Math.min(6, previousOut + 1);
      else if (source < previousSource) out = Math.max(HEADING_BASE, previousOut - (previousSource - source));
      else out = previousOut;
      previousSource = source;
      previousOut = out;
    }
    token.tag = `h${previousOut}`;
  }
});

md.renderer.rules.heading_open = (tokens, idx) => `<${tokens[idx].tag} class="md__h">`;
md.renderer.rules.heading_close = (tokens, idx) => `</${tokens[idx].tag}>`;

const defaultLinkOpen = md.renderer.rules.link_open
  ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

md.renderer.rules.link_close = () => '<span class="visually-hidden"> (opens in a new tab)</span></a>';

md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx];
  const src = token.attrGet('src') ?? '';
  const alt = token.content || src;
  if (!src) return md.utils.escapeHtml(alt);
  return `<a href="${md.utils.escapeHtml(src)}" target="_blank" rel="noopener noreferrer">`
    + `${md.utils.escapeHtml(alt)} (image<span class="visually-hidden">, opens in a new tab</span>)</a>`;
};

/* --- the API ------------------------------------------------------------- */

/**
 * @param {string} text
 * @param {{inline?: boolean}} [options] inline: no wrapping `<p>`, no blocks
 * @returns {string} HTML with no raw markup from the document in it
 */
export function markdownToHtml(text, { inline = false } = {}) {
  const source = String(text ?? '').trim();
  if (!source) return '';
  return inline ? md.renderInline(source) : md.render(source);
}

/**
 * The same description with its syntax removed rather than rendered, for the
 * places that are one line of text and nothing else.
 * @param {string} text
 * @returns {string}
 */
export function markdownToText(text) {
  const source = String(text ?? '').trim();
  if (!source) return '';
  const blocks = [];
  for (const token of md.parse(source, {})) {
    if (token.type === 'fence' || token.type === 'code_block') blocks.push(token.content.trim());
    else if (token.type === 'inline') blocks.push(inlineText(token.children));
  }
  return blocks.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * One run of inline tokens, concatenated rather than joined: the text either
 * side of a `**bold**` already carries its own spaces, and putting more in
 * leaves punctuation stranded — "newest first ." instead of "newest first."
 */
function inlineText(children = []) {
  let out = '';
  for (const token of children) {
    if (token.type === 'text' || token.type === 'code_inline') out += token.content;
    else if (token.type === 'softbreak' || token.type === 'hardbreak') out += ' ';
    else if (token.children) out += inlineText(token.children);
  }
  return out;
}

/**
 * The rendered description as nodes, ready to append.
 *
 * A fragment rather than a string so the caller keeps using `el()` and nothing
 * anywhere in the app assigns `innerHTML` to something already on screen.
 *
 * @param {string} text
 * @param {{inline?: boolean}} [options]
 * @returns {DocumentFragment}
 */
export function renderMarkdown(text, options = {}) {
  const template = document.createElement('template');
  template.innerHTML = markdownToHtml(text, options);
  return template.content;
}

/**
 * A `<div class="md">` holding the rendered description, or null when there is
 * nothing to say. The wrapper is what the stylesheet hangs the prose rules on.
 *
 * @param {string} text
 * @param {{inline?: boolean, class?: string}} [options]
 * @returns {HTMLElement|null}
 */
export function markdownBlock(text, { inline = false, class: className = '' } = {}) {
  const html = markdownToHtml(text, { inline });
  if (!html) return null;
  const node = document.createElement(inline ? 'span' : 'div');
  node.className = ['md', inline ? 'md--inline' : null, className].filter(Boolean).join(' ');
  node.innerHTML = html;
  return node;
}
