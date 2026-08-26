/**
 * The top bar: wordmark, the filter search, and the right-hand cluster.
 *
 * The search input is deliberately uncontrolled. It filters as you type, and a
 * re-render that replaced its value would fight the person using it, so state
 * flows one way here: input -> store, never back.
 */

import { AwElement, define } from '../lib/element.js';
import { el, replace } from '../lib/dom.js';

class AwTopbar extends AwElement {
  static observes = ['schema', 'density'];

  #input = null;

  render(state) {
    const { schema } = state;
    const roomy = state.density === 'roomy';

    // In the roomy IA the search owns a header block of its own, so the top
    // bar keeps only the wordmark and the actions.
    const search = roomy ? null : this.#renderSearch(state);

    const version = schema?.version
      ? el('span', {
          class: 'version-chip',
        }, [
          el('span', { class: 'visually-hidden', text: 'Schema version ' }),
          el('span', { text: `v${schema.version}` }),
        ])
      : null;

    replace(this, [
      el('div', { class: 'topbar' }, [
        el('a', { class: 'wordmark', href: '#/', text: 'ALLYWAY' }),
        !roomy && el('span', { class: 'topbar__divider', 'aria-hidden': 'true' }),
        search,
        roomy && schema
          ? el('span', { class: 'searchblock__meta', text: `${schema.sourceName} · ${schema.operations.length} endpoints` })
          : null,
        el('div', { class: 'topbar__right' }, [
          roomy
            ? el('button', {
                type: 'button',
                class: 'link-quiet',
                text: 'Replace schema',
                onclick: () => this.actions.replaceSchema(),
              })
            : null,
          version,
          el('button', {
            type: 'button',
            class: 'btn',
            text: 'Display',
            onclick: () => this.actions.openOptions(),
          }),
          el('button', {
            type: 'button',
            class: 'btn btn--filled',
            text: 'Authorise',
            onclick: () => this.actions.openAuth(),
          }),
        ]),
      ]),
      roomy ? el('aw-search-block', {}) : null,
    ]);
  }

  #renderSearch(state) {
    const input = el('input', {
      id: 'search',
      type: 'search',
      class: 'input-bare',
      placeholder: 'Search endpoints, params, schemas',
      'aria-describedby': 'search-hint',
      autocomplete: 'off',
      spellcheck: 'false',
      '.value': state.filters.query,
      oninput: (event) => this.actions.setQuery(event.target.value),
      onkeydown: (event) => {
        if (event.key === 'Escape' && event.target.value) {
          event.stopPropagation();
          event.target.value = '';
          this.actions.setQuery('');
        }
        if (event.key === 'ArrowDown' || event.key === 'Enter') {
          event.preventDefault();
          this.actions.focusList();
        }
      },
    });
    this.#input = input;

    return el('div', { class: 'field topbar__search' }, [
      el('label', { class: 'visually-hidden', for: 'search', text: 'Search endpoints, parameters and schemas' }),
      input,
      el('span', { class: 'kbd', id: 'search-hint' }, [
        el('span', { 'aria-hidden': 'true', text: '⌘K' }),
        el('span', {
          class: 'visually-hidden',
          text: 'Press Command K, or Control K, for the command palette. Press the down arrow to move into the results.',
        }),
      ]),
    ]);
  }

  /** Called by the `/` shortcut and the skip link. */
  focusSearch() {
    this.#input?.focus();
    this.#input?.select();
  }
}

/**
 * The search-first header from 1b. Same store, same handler — only the
 * presentation differs, so there is one search behaviour to get right.
 */
class AwSearchBlock extends AwElement {
  static observes = ['schema', 'filters'];

  #input = null;
  #status = null;

  render(state) {
    const { schema, filters } = state;
    const count = this.actions.visibleOperations().length;

    const input = el('input', {
      id: 'search',
      type: 'search',
      placeholder: 'Search endpoints, params, schemas',
      'aria-describedby': 'search-status',
      autocomplete: 'off',
      spellcheck: 'false',
      '.value': filters.query,
      oninput: (event) => this.actions.setQuery(event.target.value),
      onkeydown: (event) => {
        if (event.key === 'ArrowDown' || event.key === 'Enter') {
          event.preventDefault();
          this.actions.focusList();
        }
      },
    });
    this.#input = input;

    this.#status = el('span', {
      class: 'searchblock__status',
      id: 'search-status',
      text: `${count} ${count === 1 ? 'match' : 'matches'} · ↑↓ to move`,
    });

    replace(this, [
      el('div', { class: 'searchblock' }, [
        el('div', { class: 'searchblock__field' }, [
          el('label', { class: 'visually-hidden', for: 'search', text: 'Search endpoints, parameters and schemas' }),
          input,
          this.#status,
        ]),
        el('aw-facets', {}),
      ]),
    ]);
  }

  focusSearch() {
    this.#input?.focus();
    this.#input?.select();
  }
}

/**
 * The schema meta strip: what was loaded, and the way back out of it.
 */
class AwMetaStrip extends AwElement {
  static observes = ['schema'];

  render(state) {
    const { schema } = state;
    if (!schema) {
      replace(this, []);
      return;
    }
    const facts = [
      schema.oasLabel,
      `${schema.report.counts.endpoints} endpoints`,
      `${schema.report.counts.schemas} schemas`,
    ];

    replace(this, [
      el('div', { class: 'meta-strip' }, [
        el('span', { class: 'meta-strip__name', text: schema.sourceName }),
        ...facts.flatMap((fact) => [
          el('span', { class: 'dot', 'aria-hidden': 'true', text: '·' }),
          el('span', { class: 'meta-strip__fact', text: fact }),
        ]),
        el('span', { class: 'meta-strip__end' }, [
          el('button', {
            type: 'button',
            class: 'link-quiet',
            text: 'Replace schema',
            onclick: () => this.actions.replaceSchema(),
          }),
        ]),
      ]),
    ]);
  }
}

define('aw-topbar', AwTopbar);
define('aw-search-block', AwSearchBlock);
define('aw-meta-strip', AwMetaStrip);
