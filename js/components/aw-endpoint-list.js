/**
 * The endpoint list.
 *
 * One tab stop for the whole list (roving tabindex), so Tab does not walk
 * through forty-seven rows to reach the detail pane. Within the list:
 *
 *   ↑ ↓            move the cursor
 *   Home / End     first / last
 *   PageUp/Down    ten at a time
 *   Enter / Space  open
 *   a letter       jump to the next path starting with it
 *   /              back to the filter field
 *
 * The rows are anchors, so Enter, middle-click and "open in new tab" all work
 * without being reimplemented, and the address bar shows where you are.
 *
 * Selection (which operation the detail pane shows) and the cursor (which row
 * the keyboard is on) are separate, exactly as the handoff specifies, and both
 * are visible at once without either being conveyed by colour alone.
 */

import { AwElement, define } from '../lib/element.js';
import { el, replace, uid } from '../lib/dom.js';
import { announce } from '../lib/announce.js';
import { verbLabel, verbClass } from '../lib/openapi.js';
import { groupByTag, typeAheadIndex } from '../lib/search.js';

const TYPEAHEAD_TIMEOUT = 800;

class AwEndpointList extends AwElement {
  static observes = ['schema', 'filters', 'selectedOperationId', 'activeRowId', 'density', 'showHints'];

  #typeBuffer = '';
  #typeTimer = null;
  #scroll = null;
  #hintCount = null;

  /**
   * The operations in the order they were actually rendered.
   *
   * This is not always the order `visibleOperations()` returns them in: the
   * roomy layout groups by tag, so a filtered-and-sorted array and the rows on
   * screen can disagree completely. Everything the keyboard does — the arrows,
   * Home/End, type-ahead, the "3 of 32" counter, which row holds the tab stop
   * — reads from here, so the cursor always moves to the row underneath the
   * one it was on.
   *
   * @type {object[]}
   */
  #ordered = [];

  /**
   * Moving the cursor must not rebuild the list.
   *
   * The active row is the focused element; replacing it mid-move drops focus
   * to the body and the keyboard model dies on the spot. So a change to the
   * cursor or the selection patches attributes in place, and only a change to
   * what the list *contains* re-renders it.
   */
  update(state, prev) {
    const structural = ['schema', 'filters', 'density', 'showHints'];
    if (structural.some((key) => !Object.is(state[key], prev[key]))) {
      this.render(state);
      return;
    }
    this.#patchRows(state);
  }

  #patchRows(state) {
    for (const row of this.#rows()) {
      const id = row.dataset.opId;
      if (state.selectedOperationId === id) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    }
    this.#syncRoving(state);
    this.#updateCount(state);
  }

  #updateCount(state) {
    if (!this.#hintCount) return;
    const total = this.#ordered.length;
    const index = this.#ordered.findIndex((op) => op.id === state.activeRowId);
    this.#hintCount.textContent = total ? `${Math.max(0, index) + 1} of ${total}` : '0 of 0';
  }

  render(state) {
    const { schema } = state;
    if (!schema) {
      replace(this, []);
      return;
    }

    const visible = this.actions.visibleOperations();
    const roomy = state.density === 'roomy';

    // #ordered is filled as the rows are built, so it cannot drift from them.
    this.#ordered = [];
    const listBody = visible.length
      ? roomy
        ? this.#renderGrouped(state, visible)
        : this.#renderFlat(state, visible)
      : this.#renderEmpty(state);

    this.#scroll = el(
      'div',
      {
        class: 'list-scroll',
        onkeydown: (event) => this.#onKeyDown(event),
      },
      listBody,
    );

    this.#hintCount = el('span', { class: 'hintbar__count' });

    replace(this, [
      roomy ? null : el('aw-verb-bar', {}),
      roomy ? null : el('aw-tag-chips', {}),
      this.#scroll,
      state.showHints ? this.#renderHints() : null,
      this.#renderStatusBar(state, visible),
    ]);

    this.#syncRoving(state);
    this.#updateCount(state);
  }

  /* --- rows ------------------------------------------------------------- */

  #renderRow(state, op, roomy) {
    const isSelected = state.selectedOperationId === op.id;
    const pillClass = op.deprecated ? 'pill pill--neutral' : `pill pill--${verbClass(op.method)}`;

    const summary = op.summary || op.description.split('\n')[0] || '';

    // The verb pill shows the abbreviated word but announces the real method,
    // so DEL is never read as anything other than DELETE.
    const pill = () =>
      verbLabel(op.method) === op.method
        ? el('span', { class: pillClass, text: op.method })
        : el('span', { class: pillClass }, [
            el('span', { 'aria-hidden': 'true', text: verbLabel(op.method) }),
            el('span', { class: 'visually-hidden', text: op.method }),
          ]);
    const path = () => el('span', { class: 'row__path', text: op.path });
    // A strikethrough is not announced, so the word goes into the name too.
    const deprecatedNote = () =>
      op.deprecated ? el('span', { class: 'visually-hidden', text: ' Deprecated.' }) : null;

    const meta = roomy
      ? [
          op.scopes.length ? el('span', { class: 'chip', text: op.scopes[0] }) : null,
          op.parameters.length
            ? el('span', { class: 'chip', text: `${op.parameters.length} ${op.parameters.length === 1 ? 'param' : 'params'}` })
            : null,
          op.requestBody ? el('span', { class: 'chip', text: 'body' }) : null,
          op.responses.length
            ? el('span', { class: 'chip', text: `${op.responses.length} ${op.responses.length === 1 ? 'response' : 'responses'}` })
            : null,
        ].filter(Boolean)
      : [];

    const anchor = el(
      'a',
      {
        class: `row${op.deprecated ? ' row--deprecated' : ''}`,
        href: this.actions.hashFor({ view: 'operation', id: op.id }),
        'aria-current': isSelected ? 'true' : null,
        tabindex: '-1',
        dataset: { opId: op.id },
        onclick: (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          this.actions.selectOperation(op.id, { focusRow: true });
        },
        onfocus: () => this.actions.setActiveRow(op.id),
      },
      roomy || this.#isNarrow()
        ? [
            el('span', { class: 'row__head' }, [pill(), path()]),
            summary ? el('span', { class: 'row__summary', text: summary }) : null,
            meta.length ? el('span', { class: 'row__meta' }, meta) : null,
            deprecatedNote(),
          ]
        : [
            pill(),
            el('span', {}, [
              path(),
              summary ? el('span', { class: 'row__summary', text: summary }) : null,
              deprecatedNote(),
            ]),
          ],
    );

    return anchor;
  }

  /** @returns {HTMLElement} an `<li>`, recording the operation's place in the run. */
  #listItem(state, op, roomy) {
    this.#ordered.push(op);
    return el('li', {}, [this.#renderRow(state, op, roomy)]);
  }

  #renderFlat(state, visible) {
    return [
      el('ul', {
        class: 'endpoints',
        'aria-label': `Endpoints, ${visible.length} of ${state.schema.operations.length}`,
      }, visible.map((op) => this.#listItem(state, op, false))),
    ];
  }

  /**
   * Grouped rows are a heading followed by that group's own list, rather than
   * one list with headings wedged inside it. A list may only contain list
   * items, and the alternative — an `<li>` set to `display: contents` so the
   * heading inside it can stick — is exactly the construct that drops the
   * listitem role in some browsers. This way the headings are real headings,
   * each group is a named list, and `position: sticky` works because the
   * heading is a sibling in the scroll container.
   */
  #renderGrouped(state, visible) {
    const groups = groupByTag(visible, this.state.schema.tags);
    const out = [];
    groups.forEach((group, index) => {
      const headingId = uid('group');
      out.push(el('h2', {
        class: `group-head${index === 0 ? ' group-head--first' : ''}`,
        id: headingId,
        text: `${group.name} — ${group.operations.length}`,
      }));
      out.push(el('ul', {
        class: 'endpoints',
        'aria-labelledby': headingId,
      }, group.operations.map((op) => this.#listItem(state, op, true))));
    });
    return out;
  }

  #renderEmpty(state) {
    const { filters } = state;
    const bits = [
      filters.query && `matching “${filters.query}”`,
      filters.tags.length && `tagged ${filters.tags.join(' or ')}`,
      filters.verbs.length && `using ${filters.verbs.join(' or ')}`,
      filters.hideDeprecated && 'once deprecated ones are hidden',
    ].filter(Boolean);

    return [
      el('div', { class: 'empty-wrap' }, [
        el('div', { class: 'empty' }, [
          el('p', { class: 'empty__title', text: 'No endpoints match' }),
          el('p', {
            class: 'empty__body',
            text: bits.length
              ? `Nothing in this schema is ${bits.join(', ')}.`
              : 'This schema declares no operations.',
          }),
          bits.length
            ? el('p', { class: 'empty__body' }, [
                el('button', {
                  type: 'button',
                  class: 'link-quiet',
                  text: 'Clear all filters',
                  onclick: () => this.actions.clearFilters(),
                }),
              ])
            : null,
        ]),
      ]),
    ];
  }

  /* --- chrome ----------------------------------------------------------- */

  #renderHints() {
    const hint = (symbol, spoken, label) =>
      el('span', {}, [
        el('kbd', {}, [
          el('span', { 'aria-hidden': 'true', text: symbol }),
          el('span', { class: 'visually-hidden', text: spoken }),
        ]),
        el('span', { text: ` ${label}` }),
      ]);

    return el('div', { class: 'hintbar' }, [
      hint('↑↓', 'Up or down arrow', 'move'),
      hint('↵', 'Enter', 'open'),
      hint('/', 'Slash', 'filter'),
      hint('⇧⌘F', 'Shift Command F, or Shift Control F', 'verbs'),
      hint('⌘K', 'Command K, or Control K', 'palette'),
      this.#hintCount,
    ]);
  }

  #renderStatusBar(state, visible) {
    const scope = state.filters.tags.length ? state.filters.tags.join(', ') : 'All';
    return el('p', {
      class: 'statusbar',
      text: `${scope} · ${visible.length} of ${state.schema.operations.length} shown`,
    });
  }

  /* --- roving tabindex -------------------------------------------------- */

  #rows() {
    return [...this.querySelectorAll('a.row')];
  }

  #syncRoving(state) {
    const rows = this.#rows();
    if (!rows.length) return;
    let index = this.#ordered.findIndex((op) => op.id === state.activeRowId);
    if (index < 0) index = this.#ordered.findIndex((op) => op.id === state.selectedOperationId);
    if (index < 0) index = 0;
    for (const [i, row] of rows.entries()) row.tabIndex = i === index ? 0 : -1;
  }

  #isNarrow() {
    return globalThis.matchMedia?.('(max-width: 48rem)').matches ?? false;
  }

  /** Move the cursor to a position in the rendered run. */
  #moveTo(index, { announceRow = false } = {}) {
    const rows = this.#rows();
    if (!rows.length) return;
    const clamped = Math.min(Math.max(index, 0), rows.length - 1);
    const row = rows[clamped];
    const op = this.#ordered[clamped];
    for (const other of rows) other.tabIndex = -1;
    row.tabIndex = 0;
    row.focus({ preventScroll: false });
    if (op) this.actions.setActiveRow(op.id);
    if (this.#hintCount) this.#hintCount.textContent = `${clamped + 1} of ${rows.length}`;
    if (announceRow && op) {
      announce(`${op.method} ${op.path}, ${clamped + 1} of ${rows.length}`);
    }
  }

  /** Where the cursor is in the rendered run, by the row that actually has focus. */
  #cursorIndex() {
    const rows = this.#rows();
    const focused = rows.indexOf(document.activeElement);
    if (focused >= 0) return focused;
    const byState = this.#ordered.findIndex((op) => op.id === this.state.activeRowId);
    return byState < 0 ? 0 : byState;
  }

  #onKeyDown(event) {
    // Only the rows drive the cursor; a control that happens to sit inside the
    // scroller keeps its own keys.
    if (!(event.target instanceof HTMLElement) || !event.target.classList.contains('row')) return;

    const total = this.#ordered.length;
    const current = this.#cursorIndex();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.#moveTo(current + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (current === 0) {
          // Stepping off the top of the list goes back to the filter field,
          // which is where the cursor came from.
          this.actions.focusSearch();
          return;
        }
        this.#moveTo(current - 1);
        return;
      case 'Home':
        event.preventDefault();
        this.#moveTo(0);
        return;
      case 'End':
        event.preventDefault();
        this.#moveTo(total - 1);
        return;
      case 'PageDown':
        event.preventDefault();
        this.#moveTo(current + 10, { announceRow: true });
        return;
      case 'PageUp':
        event.preventDefault();
        this.#moveTo(current - 10, { announceRow: true });
        return;
      case ' ':
      case 'Spacebar':
        event.preventDefault();
        if (this.#ordered[current]) this.actions.selectOperation(this.#ordered[current].id, { focusRow: true });
        return;
      case '/':
        // `/` is the filter shortcut, but it is also in every path a person
        // might be typing ahead for. A slash with nothing typed yet means the
        // shortcut; a slash mid-word is part of the word.
        if (this.#typeBuffer === '') {
          event.preventDefault();
          this.actions.focusSearch();
          return;
        }
        // Claim the key so the document-level `/` shortcut does not also fire
        // and yank focus into the filter mid-word.
        event.preventDefault();
        event.stopPropagation();
        break;
      default:
        break;
    }

    // Type-ahead. Single printable characters only, and never when a modifier
    // is held — those belong to the browser or to a global shortcut.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && event.key !== ' ') {
      this.#typeBuffer += event.key.toLowerCase();
      clearTimeout(this.#typeTimer);
      this.#typeTimer = setTimeout(() => { this.#typeBuffer = ''; }, TYPEAHEAD_TIMEOUT);
      // Repeating the same letter cycles rather than searching for "aa".
      const needle = this.#typeBuffer.length > 1 && this.#typeBuffer.split('').every((c) => c === this.#typeBuffer[0])
        ? this.#typeBuffer[0]
        : this.#typeBuffer;
      const found = typeAheadIndex(
        this.#ordered,
        needle,
        this.#typeBuffer.length > 1 && needle === this.#typeBuffer ? current - 1 : current,
      );
      if (found >= 0) {
        event.preventDefault();
        this.#moveTo(found, { announceRow: true });
      }
    }
  }
}

/** The dense verb filter bar: ALL 47, GET 21, … plus the deprecated controls. */
class AwVerbBar extends AwElement {
  static observes = ['schema', 'filters'];

  render(state) {
    const { schema, filters } = state;
    if (!schema) {
      replace(this, []);
      return;
    }
    const total = schema.operations.length;
    const deprecated = schema.report.counts.deprecated;

    const chip = (label, pressed, onclick, extraClass = '') =>
      el('button', {
        type: 'button',
        class: `chip${extraClass}`,
        'aria-pressed': String(pressed),
        onclick,
        text: label,
      });

    replace(this, [
      el('div', { class: 'filterbar', id: 'verb-filters', role: 'group', 'aria-label': 'Filter by method' }, [
        chip(`ALL ${total}`, filters.verbs.length === 0 && !filters.onlyDeprecated, () => this.actions.setVerbs([])),
        ...schema.verbCounts.map((entry) =>
          chip(`${entry.verb} ${entry.count}`, filters.verbs.includes(entry.verb), () => this.actions.toggleVerb(entry.verb)),
        ),
        deprecated
          ? chip(`DEPRECATED ${deprecated}`, Boolean(filters.onlyDeprecated), () => this.actions.toggleOnlyDeprecated(), ' chip--dashed')
          : null,
        deprecated
          ? chip('Hide deprecated', filters.hideDeprecated, () => this.actions.toggleHideDeprecated(), ' chip--dashed filterbar__spacer')
          : null,
      ]),
    ]);
  }
}

/**
 * The tag chips that stand in for the rail once it is off screen. Rendered
 * always and hidden by CSS at wide widths would mean two tab stops for the
 * same control, so it is a media query in JS instead.
 */
class AwTagChips extends AwElement {
  static observes = ['schema', 'filters'];

  #media = null;
  #onChange = null;

  connectedCallback() {
    this.#media = globalThis.matchMedia?.('(max-width: 75rem)');
    this.#onChange = () => this.render(this.state);
    this.#media?.addEventListener('change', this.#onChange);
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#media?.removeEventListener('change', this.#onChange);
  }

  render(state) {
    const { schema, filters } = state;
    if (!schema || !(this.#media?.matches ?? false)) {
      replace(this, []);
      return;
    }
    replace(this, [
      el('div', { class: 'tagbar', id: 'tag-chips', tabindex: '-1', role: 'group', 'aria-label': 'Filter by tag' }, [
        el('button', {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(filters.tags.length === 0),
          text: `All ${schema.operations.length}`,
          onclick: () => this.actions.setTags([]),
        }),
        ...schema.tags.map((tag) =>
          el('button', {
            type: 'button',
            class: 'chip',
            'aria-pressed': String(filters.tags.includes(tag.name)),
            text: `${tag.name} ${tag.count}`,
            onclick: (event) => this.actions.toggleTag(tag.name, { additive: event.shiftKey }),
          }),
        ),
      ]),
    ]);
  }
}

define('aw-endpoint-list', AwEndpointList);
define('aw-verb-bar', AwVerbBar);
define('aw-tag-chips', AwTagChips);
