/**
 * Settings.
 *
 * Theme and density are the two preferences worth persisting: someone who
 * needs a dark, high-contrast, roomy interface should not have to set it again
 * on every visit. They go to localStorage and nothing else does — no schema,
 * no filters, and above all no credential.

 *
 * Theme has three states rather than two, because "follow the system" is a
 * real answer and is the default. A two-way toggle silently overrides whatever
 * the operating system was told.
 *
 * The base URL is here too, and only when the loaded document leaves that gap.
 * It is not a display preference — it is the missing half of the schema's
 * address — but it needs one permanent home that is not attached to whichever
 * operation happens to be open, and this is the sheet that is always one
 * keystroke away.
 */

import { FbElement, define } from '../lib/element.js';
import { el, replace } from '../lib/dom.js';
import { wireDialog } from '../lib/dialog.js';
import { announce } from '../lib/announce.js';

const THEMES = [
  ['auto', 'Follow the system', 'Whatever this device is set to, including when that changes while the page is open.'],
  ['light', 'Light', 'The palette the interface was designed in.'],
  ['dark', 'Dark', 'The same palette with the roles inverted; every pair still clears AA.'],
];

const DENSITIES = [
  ['dense', 'Dense', 'Three panes with a tag rail, and one line per endpoint. The most endpoints on screen at once.'],
  ['roomy', 'Roomy', 'Two panes, no rail. Search owns the header and rows carry a summary and metadata.'],
];

class FbOptions extends FbElement {
  static observes = ['optionsOpen', 'theme', 'density', 'showHints'];

  #dialog = null;
  #controller = null;

  connectedCallback() {
    super.connectedCallback();
    this.#dialog = el('dialog', { 'aria-labelledby': 'options-title' });
    this.#controller = wireDialog(this.#dialog, {
      // Normally the theme already in force, so the sheet opens on the thing
      // it is most often opened to change. A command that named one control
      // asks for that control instead, and gets it if it is on screen at all.
      initialFocus: () => {
        const asked = this.actions.takeOptionsFocus?.();
        const named = asked === 'base-url' ? this.querySelector('fb-base-url input') : null;
        // The sheet is focused with `preventScroll`, which is right for a
        // control at the top and wrong for one near the bottom: bring it into
        // view first, so the field the command named is also the field on
        // screen.
        named?.scrollIntoView({ block: 'center' });
        return named ?? this.querySelector('input[name="theme"]:checked') ?? this.querySelector('input');
      },
      onClose: () => this.actions.closeOptions(),
    });
    replace(this, [this.#dialog]);
    this.#renderSheet();
  }

  render(state) {
    if (!this.#dialog) return;
    if (state.optionsOpen && !this.#dialog.open) {
      // Build on the way in. Changing a preference while it is open must NOT
      // rebuild: these are native radios and a checkbox, they already hold
      // what was just chosen, and replacing them takes focus off the control
      // the keyboard is standing on.
      this.#renderSheet();
      this.#controller.open(this.actions.lastInvoker());
    } else if (!state.optionsOpen && this.#dialog.open) {
      this.#controller.close();
    }
  }

  #renderSheet() {
    const state = this.state;

    const radioGroup = (name, options, current, onPick) =>
      el('fieldset', {}, [
        el('legend', { text: name === 'theme' ? 'Theme' : 'Density' }),
        ...options.map(([value, label, hint]) =>
          el('label', { class: 'choice' }, [
            el('input', {
              type: 'radio',
              name,
              value,
              '.checked': current === value,
              onchange: () => onPick(value),
            }),
            el('span', { class: 'choice__text' }, [
              el('span', { class: 'choice__label', text: label }),
              el('span', { class: 'choice__hint', text: hint }),
            ]),
          ]),
        ),
      ]);

    replace(this.#dialog, [
      el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet__head' }, [
          el('h2', { id: 'options-title', text: 'Settings' }),
          el('span', { class: 'sheet__esc', 'aria-hidden': 'true', text: 'esc' }),
        ]),
        el('p', {
          class: 'sheet__lede',
          text: 'These settings are remembered on this device, along with which columns you have folded away. The filters are not, and neither is the credential — that is kept, and forgotten, in the Authorise sheet.',
        }),

        radioGroup('theme', THEMES, state.theme, (value) => {
          this.actions.setTheme(value);
          announce(`Theme set to ${THEMES.find((t) => t[0] === value)[1].toLowerCase()}.`);
        }),

        radioGroup('density', DENSITIES, state.density, (value) => {
          this.actions.setDensity(value);
          announce(`Layout set to ${value}.`);
        }),

        el('fieldset', {}, [
          el('legend', { text: 'Hints' }),
          el('label', { class: 'choice' }, [
            el('input', {
              type: 'checkbox',
              '.checked': state.showHints,
              onchange: (event) => this.actions.setShowHints(event.target.checked),
            }),
            el('span', { class: 'choice__text' }, [
              el('span', { class: 'choice__label', text: 'Show the keyboard hint bar' }),
              el('span', { class: 'choice__hint', text: 'The strip under the endpoint list. The shortcuts work either way.' }),
            ]),
          ]),
        ]),

        // Renders nothing at all unless the loaded schema left the gap.
        el('fb-base-url', { variant: 'settings' }),

        el('p', { class: 'help' }, [
          el('span', { text: 'Reduced motion and increased contrast are taken from your system settings and are not overridden here.' }),
        ]),

        el('div', { class: 'sheet__actions' }, [
          el('button', {
            type: 'button',
            class: 'btn btn--filled btn--lg',
            text: 'Done',
            onclick: () => this.#controller.close(),
          }),
        ]),
      ]),
    ]);
  }
}

define('fb-options', FbOptions);
