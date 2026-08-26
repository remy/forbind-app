/**
 * The polite live region.
 *
 * One region for the whole app, owned here. Two rules make it actually work:
 *
 *  1. The region exists in the DOM from first paint. A live region created and
 *     populated in the same tick is frequently missed entirely.
 *  2. Repeating the same string still announces. Screen readers dedupe
 *     identical text, so an identical message is nudged with a trailing
 *     zero-width space that alternates.
 *
 * Assertive is available but deliberately rare — it interrupts. Only genuine
 * errors use it.
 */

let politeNode = null;
let assertiveNode = null;
let flip = false;

/** @param {HTMLElement} polite @param {HTMLElement} assertive */
export function registerRegions(polite, assertive) {
  politeNode = polite;
  assertiveNode = assertive;
}

/**
 * @param {string} message
 * @param {{assertive?: boolean}} [options]
 */
export function announce(message, options = {}) {
  const node = options.assertive ? assertiveNode : politeNode;
  if (!node || !message) return;
  flip = !flip;
  // Clear first so a repeat of the previous string is re-announced.
  node.textContent = '';
  const value = flip ? `${message}​` : message;
  // A frame's gap is enough for the change to register as a mutation.
  requestAnimationFrame(() => {
    node.textContent = value;
  });
}

/** Announcements that describe a result count, phrased once and consistently. */
export function announceCount(count, noun, suffix = '') {
  const label = count === 1 ? noun : `${noun}s`;
  announce(`${count} ${label}${suffix}`);
}
