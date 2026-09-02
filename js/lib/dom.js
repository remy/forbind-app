/**
 * DOM helpers.
 *
 * forbind's custom elements render into the *light* DOM on purpose. Shadow
 * roots would put boundaries between the things that have to reference each
 * other by id — `aria-describedby`, `aria-controls`, `aria-activedescendant`,
 * `<label for>` — and those relationships are the whole accessibility story
 * here. Cross-root ARIA delegation is still not something you can rely on, so
 * we keep one document and one id space. "Web components" is about custom
 * elements and their lifecycle, not about shadow encapsulation.
 */

/**
 * Build an element. Attributes are set with setAttribute so that ARIA states
 * land where assistive tech reads them; `.` prefixed keys set properties.
 *
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {Array<Node|string|null|undefined|false>} [children]
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key.startsWith('.')) node[key.slice(1)] = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

/** @param {Node} parent @param {Array<Node|string|null|undefined|false>} children */
export function append(parent, children) {
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return parent;
}

/** Replace all children of `node` with `children`. */
export function replace(node, children) {
  node.replaceChildren();
  append(node, children);
  return node;
}

/** A `·`-separated run of spans, the meta-line pattern used across the design. */
export function dotted(parts, attrs = {}) {
  const out = [];
  parts.filter(Boolean).forEach((part, i) => {
    if (i > 0) out.push(el('span', { class: 'dot', 'aria-hidden': 'true', text: '·' }));
    out.push(typeof part === 'string' ? el('span', { text: part }) : part);
  });
  return el('span', attrs, out);
}

/** Fragment helper. */
export function frag(children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

let idSeq = 0;
/** Stable-enough unique id for aria-* wiring. */
export function uid(prefix = 'fb') {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

/** Elements that can take focus, in document order, excluding hidden ones. */
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', 'summary', '[tabindex]:not([tabindex="-1"])',
].join(',');

/** @param {ParentNode} root */
export function focusable(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node.getClientRects().length > 0,
  );
}

/** Escape a string for use in a text node built from a template. */
export function text(value) {
  return document.createTextNode(String(value));
}

/**
 * Re-render a subtree without throwing focus away.
 *
 * Rebuilding a panel replaces the element the keyboard was on, and the browser
 * drops focus to the body — which, inside a dialog, is how someone ends up
 * unable to reach the control they just used. This records enough to find the
 * same control again (its id, or a `data-focus-key`), plus the caret position
 * in a text field, and restores both afterwards.
 *
 * @param {ParentNode} root the subtree about to be replaced
 * @param {() => void} render
 */
export function preserveFocus(root, render) {
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && root.contains(active);
  const key = inside ? (active.id || active.dataset.focusKey || null) : null;
  const selection = inside && typeof active.selectionStart === 'number'
    ? [active.selectionStart, active.selectionEnd]
    : null;

  render();

  if (!key) return;
  const restored = root.querySelector(`#${CSS.escape(key)}`)
    ?? root.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
  if (!restored) return;
  restored.focus({ preventScroll: true });
  if (selection && typeof restored.setSelectionRange === 'function') {
    try {
      restored.setSelectionRange(selection[0], selection[1]);
    } catch {
      /* Not every input type supports a selection range. */
    }
  }
}
