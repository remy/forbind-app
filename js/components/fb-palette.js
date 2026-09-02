/**
 * The ⌘K command palette.
 *
 * Built as a combobox, which is the pattern that actually works when someone
 * cannot see the list: focus never leaves the text input, the results are an
 * owned listbox, and the active option is pointed at with
 * `aria-activedescendant` rather than by moving focus. The result count goes
 * through a polite live region, and Escape closes and puts focus back on
 * whatever opened it.
 *
 * The palette accelerates the visible navigation. It does not replace it — a
 * palette-only reading view was explored in the design and rejected, and this
 * is the half of that decision the code has to keep honouring.
 */

import { FbElement, define } from '../lib/element.js';
import { el, replace } from '../lib/dom.js';
import { wireDialog } from '../lib/dialog.js';
import { verbLabel, verbClass } from '../lib/openapi.js';
import { score } from '../lib/search.js';

const MAX_PER_GROUP = 8;

class FbPalette extends FbElement {
  static observes = ['palette', 'schema'];

  #dialog = null;
  #controller = null;
  #input = null;
  #listbox = null;
  #count = null;
  #results = [];
  #activeIndex = 0;

  connectedCallback() {
    super.connectedCallback();
    this.#build();
  }

  render(state) {
    if (!this.#dialog) return;
    if (state.palette.open && !this.#dialog.open) {
      this.#activeIndex = 0;
      this.#input.value = state.palette.query ?? '';
      this.#controller.open(this.actions.lastInvoker());
      this.#refresh();
    } else if (!state.palette.open && this.#dialog.open) {
      this.#controller.close();
    }
  }

  #build() {
    this.#input = el('input', {
      type: 'text',
      id: 'palette-input',
      role: 'combobox',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      'aria-expanded': 'true',
      'aria-controls': 'palette-listbox',
      'aria-autocomplete': 'list',
      'aria-describedby': 'palette-help',
      placeholder: 'Go to an endpoint, a schema, or run a command',
      oninput: () => this.#refresh(),
      onkeydown: (event) => this.#onKeyDown(event),
    });

    // A listbox may contain groups, and a group may contain options — but a
    // <li> may not be a group, so the whole structure is divs carrying roles
    // rather than a list carrying roles it is not allowed to have.
    this.#listbox = el('div', {
      class: 'palette__results',
      id: 'palette-listbox',
      role: 'listbox',
      'aria-label': 'Results',
    });

    this.#count = el('span', { class: 'palette__count', 'aria-hidden': 'true' });

    this.#dialog = el('dialog', { class: 'palette', 'aria-label': 'Command palette' }, [
      el('div', { class: 'palette__field' }, [
        el('label', { class: 'visually-hidden', for: 'palette-input', text: 'Go to an endpoint, a schema, or run a command' }),
        this.#input,
        this.#count,
      ]),
      this.#listbox,
      el('p', { class: 'palette__foot', id: 'palette-help' }, [
        el('span', { text: '↑↓ move' }),
        el('span', { text: '↵ open' }),
        el('span', { text: 'esc close' }),
      ]),
    ]);

    this.#controller = wireDialog(this.#dialog, {
      initialFocus: () => this.#input,
      onClose: () => this.actions.closePalette(),
    });

    replace(this, [this.#dialog]);
  }

  /* --- results ---------------------------------------------------------- */

  #collect(query) {
    const state = this.state;
    const schema = state.schema;
    const commands = this.actions.commands();

    const matchedCommands = commands.filter((command) =>
      !query || command.label.toLowerCase().includes(query.toLowerCase()),
    );

    if (!schema) {
      return [{ label: 'Commands', items: matchedCommands }];
    }

    const operations = schema.operations
      .map((op) => ({ op, s: score(op, query) }))
      .filter((entry) => entry.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_PER_GROUP)
      .map((entry) => ({
        kind: 'operation',
        id: entry.op.id,
        method: entry.op.method,
        label: entry.op.path,
        detail: entry.op.summary,
        deprecated: entry.op.deprecated,
        run: () => this.actions.selectOperation(entry.op.id, { focusRow: true }),
      }));

    const schemas = schema.schemas
      .filter((entry) => !query || entry.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, MAX_PER_GROUP)
      .map((entry) => ({
        kind: 'schema',
        label: entry.name,
        detail: 'component schema',
        run: () => this.actions.selectSchema(entry.name),
      }));

    return [
      { label: 'Endpoints', items: operations },
      { label: 'Schemas', items: schemas },
      { label: 'Commands', items: matchedCommands },
    ].filter((group) => group.items.length > 0);
  }

  #refresh() {
    const query = this.#input.value.trim();
    const groups = this.#collect(query);
    this.#results = groups.flatMap((group) => group.items);
    if (this.#activeIndex >= this.#results.length) this.#activeIndex = 0;

    let index = -1;
    const children = [];
    for (const group of groups) {
      const groupItems = [];
      for (const item of group.items) {
        index += 1;
        groupItems.push(this.#renderOption(item, index));
      }
      children.push(
        el('div', { role: 'group', 'aria-label': group.label }, [
          el('span', { class: 'palette__group-label', text: group.label, 'aria-hidden': 'true' }),
          ...groupItems,
        ]),
      );
    }

    if (!children.length) {
      children.push(
        el('p', { class: 'palette__empty', text: query ? `Nothing matches “${query}”.` : 'Type to search.' }),
      );
    }

    replace(this.#listbox, children);
    this.#count.textContent = `${this.#results.length}`;
    this.#syncActive();
    // The count is announced politely, once per keystroke settle.
    this.actions.announcePaletteCount(this.#results.length);
  }

  #renderOption(item, index) {
    const id = `palette-option-${index}`;
    return el(
      'div',
      {
        class: 'palette__option',
        id,
        role: 'option',
        'aria-selected': 'false',
        dataset: { index: String(index) },
        onmousedown: (event) => {
          // Keep focus in the input; a blur would close the dialog first.
          event.preventDefault();
        },
        onclick: () => this.#activate(index),
      },
      [
        item.kind === 'operation'
          ? (verbLabel(item.method) === item.method
              ? el('span', { class: `pill pill--${item.deprecated ? 'neutral' : verbClass(item.method)}`, text: item.method })
              : el('span', { class: `pill pill--${item.deprecated ? 'neutral' : verbClass(item.method)}` }, [
                  el('span', { 'aria-hidden': 'true', text: verbLabel(item.method) }),
                  el('span', { class: 'visually-hidden', text: item.method }),
                ]))
          : null,
        el('span', { class: item.kind === 'operation' ? 'palette__option-path' : '', text: item.label }),
        item.detail ? el('span', { class: 'palette__option-summary', text: item.detail }) : null,
        item.shortcut ? el('span', { class: 'kbd palette__option-kbd', text: item.shortcut }) : null,
        item.deprecated ? el('span', { class: 'visually-hidden', text: ' Deprecated.' }) : null,
      ],
    );
  }

  #syncActive() {
    const options = [...this.#listbox.querySelectorAll('[role="option"]')];
    for (const option of options) option.setAttribute('aria-selected', 'false');
    const active = options[this.#activeIndex];
    if (!active) {
      this.#input.removeAttribute('aria-activedescendant');
      return;
    }
    active.setAttribute('aria-selected', 'true');
    this.#input.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  }

  #activate(index) {
    const item = this.#results[index];
    if (!item) return;
    this.actions.closePalette();
    // Run after the dialog has closed so focus lands where the command wants
    // it, not back on the invoker.
    requestAnimationFrame(() => item.run());
  }

  #onKeyDown(event) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.#activeIndex = this.#results.length ? (this.#activeIndex + 1) % this.#results.length : 0;
        this.#syncActive();
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.#activeIndex = this.#results.length
          ? (this.#activeIndex - 1 + this.#results.length) % this.#results.length
          : 0;
        this.#syncActive();
        return;
      case 'Home':
        if (!this.#input.value) { event.preventDefault(); this.#activeIndex = 0; this.#syncActive(); }
        return;
      case 'End':
        if (!this.#input.value) { event.preventDefault(); this.#activeIndex = this.#results.length - 1; this.#syncActive(); }
        return;
      case 'Enter':
        event.preventDefault();
        this.#activate(this.#activeIndex);
        return;
      default:
    }
  }
}

define('fb-palette', FbPalette);
