/**
 * Display options.
 *
 * Theme and density are the two preferences worth persisting: someone who
 * needs a dark, high-contrast, roomy interface should not have to set it again
 * on every visit. They go to localStorage and nothing else does — no schema,
 * no filters, and above all no credential.
 *
 * Theme has three states rather than two, because "follow the system" is a
 * real answer and is the default. A two-way toggle silently overrides whatever
 * the operating system was told.
 */

import { AwElement, define } from '../lib/element.js';
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

class AwOptions extends AwElement {
  static observes = ['optionsOpen', 'theme', 'density', 'showHints'];

  #dialog = null;
  #controller = null;

  connectedCallback() {
    super.connectedCallback();
    this.#dialog = el('dialog', { 'aria-labelledby': 'options-title' });
    this.#controller = wireDialog(this.#dialog, {
      initialFocus: () => this.querySelector('input[name="theme"]:checked') ?? this.querySelector('input'),
      onClose: () => this.actions.closeOptions(),
    });
    replace(this, [this.#dialog]);
    this.#renderSheet();
  }

  render(state) {
    if (!this.#dialog) return;
    this.#renderSheet();
    if (state.optionsOpen && !this.#dialog.open) this.#controller.open(this.actions.lastInvoker());
    else if (!state.optionsOpen && this.#dialog.open) this.#controller.close();
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
          el('h2', { id: 'options-title', text: 'Display' }),
          el('span', { class: 'sheet__esc', 'aria-hidden': 'true', text: 'esc' }),
        ]),
        el('p', {
          class: 'sheet__lede',
          text: 'These two settings are remembered on this device. Nothing else is — not the schema, not the filters, and not the credential.',
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

define('aw-options', AwOptions);
