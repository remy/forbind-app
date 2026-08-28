/**
 * Getting text onto the clipboard, and what to do when that is refused.
 *
 * `navigator.clipboard` needs a secure context and a user gesture, and can be
 * denied outright by a permission prompt or a browser setting. Pretending it
 * worked is the one unacceptable outcome — someone pastes and gets whatever
 * was there before — so the write reports whether it landed, and the caller
 * falls back to selecting the text, which leaves the browser's own copy
 * command one keystroke away and says so out loud.
 */

/**
 * @param {string} text
 * @returns {Promise<boolean>} whether it actually reached the clipboard
 */
export async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Select an element's contents, so ⌘C / Ctrl C copies exactly it. */
export function selectContents(node) {
  if (!node) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = globalThis.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  node.focus?.();
}
