/**
 * The top bar: wordmark, the filter search, the column toggles, and the
 * right-hand cluster.
 *
 * The search input is deliberately uncontrolled. It filters as you type, and a
 * re-render that replaced its value would fight the person using it, so state
 * flows one way here: input -> store, never back.
 */

import { AwElement, define } from '../lib/element.js';
import { el, replace } from '../lib/dom.js';

/* The rail only exists in the dense IA and only above this width; below the
   second one the list and the detail are separate pages, so neither column is
   foldable. A toggle for a column that is not on screen is a control that does
   nothing, so each is a media query rather than a CSS `display: none`. */
const HAS_RAIL = '(min-width: 75.0625rem)';
const HAS_COLUMNS = '(min-width: 48.0625rem)';

class AwTopbar extends AwElement {
  static observes = ['schema', 'density', 'railCollapsed', 'listCollapsed'];

  #input = null;
  #toggles = [];
  #media = [];
  #onMediaChange = null;

  connectedCallback() {
    this.#media = [HAS_RAIL, HAS_COLUMNS].map((query) => globalThis.matchMedia?.(query)).filter(Boolean);
    this.#onMediaChange = () => this.render(this.state);
    for (const media of this.#media) media.addEventListener('change', this.#onMediaChange);
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    for (const media of this.#media) media.removeEventListener('change', this.#onMediaChange);
  }

  /**
   * Folding a column away must not rebuild the bar the button lives on — the
   * button is what the keyboard is standing on, and replacing it drops focus
   * to the body. A toggle carries its state in `aria-expanded` and a caret, so
   * both are written onto the button that is already there.
   */
  update(state, prev) {
    if (!Object.is(state.schema, prev.schema) || state.density !== prev.density) {
      this.render(state);
      return;
    }
    this.#syncToggles(state);
  }

  #syncToggles(state) {
    for (const { button, caret, key } of this.#toggles) {
      const expanded = !state[key];
      button.setAttribute('aria-expanded', String(expanded));
      caret.textContent = expanded ? '‹' : '›';
    }
  }

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
        this.#renderColumnToggles(state),
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
            id: 'open-display',
            text: 'Display',
            onclick: () => this.actions.openOptions(),
          }),
          el('button', {
            type: 'button',
            class: 'btn btn--filled',
            id: 'open-auth',
            text: 'Authorise',
            onclick: () => this.actions.openAuth(),
          }),
        ]),
      ]),
      roomy ? el('aw-search-block', {}) : null,
    ]);
  }

  /**
   * The column toggles: two disclosures for the two navigation columns.
   *
   * Disclosures rather than a "maximise" mode, because that is what they are:
   * each says, in `aria-expanded`, whether the column it names is on screen,
   * and stays on screen itself so a folded column always has a way back. Both
   * folded is what maximising the detail means, and ⇧⌘M does the pair in one
   * step.
   *
   * State is said three ways, none of them colour alone: the accessible
   * `aria-expanded`, a caret that turns towards where the column went, and the
   * button's own fill.
   */
  #renderColumnToggles(state) {
    this.#toggles = [];
    const [hasRail, hasColumns] = this.#media.map((media) => media.matches);
    if (!hasColumns) return null;

    const toggle = (key, id, label, name, run) => {
      const caret = el('span', { 'aria-hidden': 'true', text: state[key] ? '›' : '‹' });
      const button = el('button', {
        type: 'button',
        id,
        class: 'btn btn--toggle',
        'aria-expanded': String(!state[key]),
        'aria-controls': key === 'railCollapsed' ? 'tag-nav' : 'endpoint-list',
        onclick: run,
      }, [
        caret,
        el('span', { 'aria-hidden': 'true', text: label }),
        el('span', { class: 'visually-hidden', text: name }),
      ]);
      this.#toggles.push({ button, caret, key });
      return button;
    };

    const buttons = [
      hasRail && state.density !== 'roomy'
        ? toggle('railCollapsed', 'toggle-rail', 'Tags', 'Tag rail', () => this.actions.toggleRail())
        : null,
      toggle('listCollapsed', 'toggle-list', 'List', 'Endpoint list', () => this.actions.toggleList()),
    ].filter(Boolean);

    return el('div', { class: 'toggles', role: 'group', 'aria-label': 'Columns' }, buttons);
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

  /**
   * Typing changes `filters`, and the only thing here that depends on them is
   * the match count. Re-rendering for that would replace the input the person
   * is typing into — focus goes to the body and the second keystroke lands
   * nowhere. So a filter change updates the count and nothing else.
   */
  update(state, prev) {
    if (!Object.is(state.schema, prev.schema)) {
      this.render(state);
      return;
    }
    this.#updateStatus();
  }

  #updateStatus() {
    if (!this.#status) return;
    const count = this.actions.visibleOperations().length;
    this.#status.textContent = `${count} ${count === 1 ? 'match' : 'matches'} · ↑↓ to move`;
  }

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
