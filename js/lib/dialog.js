/**
 * Modal plumbing built on the real `<dialog>` element.
 *
 * `showModal()` already gives us the inert background, the top layer, the
 * `Esc` handling and the focus trap — reimplementing any of that by hand is
 * how modals end up leaking focus. What is added here is the part `<dialog>`
 * does not do: returning focus to whatever opened it, and closing on a click
 * outside the panel without swallowing clicks inside it.
 */

/**
 * @param {HTMLDialogElement} dialog
 * @param {object} [options]
 * @param {() => HTMLElement|null} [options.initialFocus]
 * @param {() => void} [options.onClose]
 * @param {boolean} [options.lightDismiss] close on backdrop click (default true)
 */
export function wireDialog(dialog, options = {}) {
  const { initialFocus, onClose, lightDismiss = true } = options;
  /** @type {{node: HTMLElement|null, key: string|null}} */
  let invoker = { node: null, key: null };

  if (lightDismiss) {
    dialog.addEventListener('click', (event) => {
      // A click on the dialog element itself is a click on the backdrop: the
      // panel inside it is a child, so any click on content stops here first.
      if (event.target === dialog) dialog.close('dismiss');
    });
  }

  dialog.addEventListener('close', () => {
    onClose?.();
    // Restore focus to the control that opened the dialog. `<dialog>` does
    // this itself, but only while the invoker is still the same node in the
    // document — and a dialog that changes state (switching density from the
    // Display panel, say) can re-render the bar the invoker lives on. So the
    // invoker is remembered by identity *and* by key, and the key is used to
    // find its replacement.
    const { node, key } = invoker;
    invoker = { node: null, key: null };

    let target = node && document.contains(node) ? node : null;
    if (!target && key) {
      target = document.querySelector(`#${CSS.escape(key)}`)
        ?? document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
    }
    target?.focus({ preventScroll: true });
  });

  return {
    open(fromElement = document.activeElement) {
      const node = fromElement instanceof HTMLElement ? fromElement : null;
      invoker = { node, key: node ? (node.id || node.dataset.focusKey || null) : null };
      if (!dialog.open) dialog.showModal();
      const focusTarget = initialFocus?.();
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    },
    close(returnValue) {
      if (dialog.open) dialog.close(returnValue);
    },
    get isOpen() {
      return dialog.open;
    },
  };
}
