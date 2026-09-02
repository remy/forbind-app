/**
 * The two strips above the dense endpoint list.
 *
 * Neither is a row and neither is part of the keyboard model the list runs, so
 * they live here rather than in `fb-endpoint-list.js`: that file is the rows,
 * the roving cursor and the type-ahead, and it has enough in it already.
 *
 * Both are custom elements rather than markup the list draws, so that a change
 * to the filters repaints the strip without touching the run of rows the
 * keyboard may be standing on.
 */

import { FbElement, define } from '../lib/element.js';
import { el, replace } from '../lib/dom.js';

/**
 * The deprecated controls above the dense list: `DEPRECATED 3` and
 * `Hide deprecated`.
 *
 * This bar used to lead with a row of method chips — `ALL 47`, `GET 21`,
 * `POST 12` — and they have gone. The verb is on every row already, the
 * search field narrows by verb when you type one (`post book`), and the roomy
 * layout keeps `+ verb` among its facets, which still writes `verb=` into the
 * address; a permanent row of buttons above the list was the one place that
 * had to be paid for in vertical space and in tab stops on every screen.
 *
 * What is left is about deprecation, not method, so the bar renders nothing at
 * all for a schema that deprecates nothing.
 */
class FbDeprecatedBar extends FbElement {
  static observes = ['schema', 'filters'];

  /** The bar as drawn, and the count it was drawn for. */
  #bar = null;
  #drawnFor = null;

  render(state) {
    const { schema, filters } = state;
    const deprecated = schema?.report.counts.deprecated ?? 0;
    if (!deprecated) {
      replace(this, []);
      this.#bar = null;
      this.#drawnFor = null;
      return;
    }

    /* Pressing one of these chips is what changes the filters, so the button
       this render would destroy is the one the keyboard is standing on. Only
       which chip reads as pressed changes, and an attribute can be patched
       where it is. */
    if (this.#bar?.isConnected && this.#drawnFor === deprecated) {
      this.#patch(filters);
      return;
    }

    const chip = (label, pressed, onclick, extraClass = '') =>
      el('button', {
        type: 'button',
        class: `chip${extraClass}`,
        'aria-pressed': String(pressed),
        onclick,
        text: label,
      });

    this.#bar = el('div', { class: 'filterbar', id: 'deprecated-filters', role: 'group', 'aria-label': 'Deprecated endpoints' }, [
      chip(`DEPRECATED ${deprecated}`, Boolean(filters.onlyDeprecated), () => this.actions.toggleOnlyDeprecated(), ' chip--dashed'),
      chip('Hide deprecated', filters.hideDeprecated, () => this.actions.toggleHideDeprecated(), ' chip--dashed filterbar__spacer'),
    ]);
    this.#drawnFor = deprecated;
    replace(this, [this.#bar]);
  }

  /** @param {object} filters */
  #patch(filters) {
    const [only, hide] = this.#bar.querySelectorAll('button');
    only?.setAttribute('aria-pressed', String(Boolean(filters.onlyDeprecated)));
    hide?.setAttribute('aria-pressed', String(Boolean(filters.hideDeprecated)));
  }
}

/**
 * The tag chips that stand in for the rail once it is off screen — whether
 * that is because the window is too narrow for it or because it has been
 * folded away by hand. Rendered always and hidden by CSS at wide widths would
 * mean two tab stops for the same control, so it is a media query in JS
 * instead.
 */
class FbTagChips extends FbElement {
  static observes = ['schema', 'filters', 'railCollapsed'];

  #media = null;
  #onChange = null;
  /** The bar as drawn, and the tags it was drawn for. */
  #bar = null;
  #drawnFor = null;

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
    const railOffScreen = (this.#media?.matches ?? false) || state.railCollapsed;
    if (!schema || !railOffScreen) {
      replace(this, []);
      this.#bar = null;
      this.#drawnFor = null;
      return;
    }

    // Same bargain as the bar above: pressing a tag chip changes the filters,
    // and rebuilding the row would take the pressed chip out from under the
    // keyboard. The chips themselves only change when the schema does.
    const signature = schema.tags.map((tag) => `${tag.name} ${tag.count}`).join('\u0000');
    if (this.#bar?.isConnected && this.#drawnFor === signature) {
      this.#patch(filters);
      return;
    }

    this.#bar = el('div', { class: 'tagbar', id: 'tag-chips', tabindex: '-1', role: 'group', 'aria-label': 'Filter by tag' }, [
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
          dataset: { tag: tag.name },
          onclick: (event) => this.actions.toggleTag(tag.name, { additive: event.shiftKey }),
        }),
      ),
    ]);
    this.#drawnFor = signature;
    replace(this, [this.#bar]);
  }

  /** @param {object} filters */
  #patch(filters) {
    for (const button of this.#bar.querySelectorAll('button')) {
      // "All" is the one with no tag of its own, and it is pressed when no tag
      // filter is applied at all.
      const tag = button.dataset.tag;
      const pressed = tag === undefined ? filters.tags.length === 0 : filters.tags.includes(tag);
      button.setAttribute('aria-pressed', String(pressed));
    }
  }
}

define('fb-deprecated-bar', FbDeprecatedBar);
define('fb-tag-chips', FbTagChips);
