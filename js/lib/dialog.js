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
  let invoker = null;

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
    // this itself in modern browsers, but only when the invoker is still in
    // the document and still focusable — which is not guaranteed after a
    // re-render, so we do it deliberately.
    const target = invoker;
    invoker = null;
    if (target && document.contains(target)) {
      target.focus({ preventScroll: true });
    }
  });

  return {
    open(fromElement = document.activeElement) {
      invoker = fromElement instanceof HTMLElement ? fromElement : null;
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
