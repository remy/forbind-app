/**
 * The confirmation in front of a request that changes something.
 *
 * The LIVE warning above the form says what is about to happen; this asks.
 * WCAG 3.3.6 wants a reversal, a check, or a confirmation before a submission
 * that cannot be undone, and only the third is available to a client that does
 * not own the API being called.
 *
 * It opens on Cancel, and Escape and a click outside both mean no: whatever a
 * second press costs someone sending the same POST for the tenth time, an
 * accidental DELETE costs more. Everything else is `<dialog>`'s own — the top
 * layer, the inert background, the focus trap — and wireDialog is what puts
 * focus back on the Send button afterwards.
 */

import { el, replace, uid } from '../lib/dom.js';
import { wireDialog } from '../lib/dialog.js';

/** Verbs that change something and are asked about before they are sent. */
export const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * @param {{method: string, url: string}} built the request as it will be sent
 * @param {HTMLElement|null} invoker the control to hand focus back to
 * @returns {Promise<boolean>} whether to go ahead
 */
export function confirmMutation(built, invoker) {
  return new Promise((resolve) => {
    const titleId = uid('confirm-title');
    const detailId = uid('confirm-detail');
    let answer = false;

    const dialog = el('dialog', {
      class: 'confirm',
      // alertdialog, not dialog: the description is the point, and this is a
      // question that has to be answered before anything else happens.
      role: 'alertdialog',
      'aria-labelledby': titleId,
      'aria-describedby': detailId,
    });

    const controller = wireDialog(dialog, {
      initialFocus: () => dialog.querySelector('[data-answer="no"]'),
      onClose: () => {
        dialog.remove();
        resolve(answer);
      },
    });

    const answerWith = (value) => () => {
      answer = value;
      controller.close(value ? 'send' : 'cancel');
    };

    replace(dialog, [
      el('div', { class: 'sheet sheet--confirm' }, [
        el('div', { class: 'sheet__head' }, [
          el('h2', { id: titleId, text: `Send this ${built.method}?` }),
          el('span', { class: 'sheet__esc', 'aria-hidden': 'true', text: 'esc' }),
        ]),
        el('p', { class: 'sheet__lede', id: detailId }, [
          el('span', { text: 'This sends a real request to ' }),
          el('code', { text: built.url }),
          el('span', { text: '. It is not a sandbox — whatever it changes, stays changed.' }),
        ]),
        el('div', { class: 'sheet__actions' }, [
          el('button', {
            type: 'button',
            class: 'btn btn--filled',
            dataset: { answer: 'yes' },
            text: `Send ${built.method}`,
            onclick: answerWith(true),
          }),
          el('button', {
            type: 'button',
            class: 'btn',
            dataset: { answer: 'no' },
            text: 'Cancel',
            onclick: answerWith(false),
          }),
        ]),
      ]),
    ]);

    document.body.append(dialog);
    controller.open(invoker);
  });
}
