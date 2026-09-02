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

  render(state) {
    const { schema, filters } = state;
    const deprecated = schema?.report.counts.deprecated ?? 0;
    if (!deprecated) {
      replace(this, []);
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

    replace(this, [
      el('div', { class: 'filterbar', id: 'deprecated-filters', role: 'group', 'aria-label': 'Deprecated endpoints' }, [
        chip(`DEPRECATED ${deprecated}`, Boolean(filters.onlyDeprecated), () => this.actions.toggleOnlyDeprecated(), ' chip--dashed'),
        chip('Hide deprecated', filters.hideDeprecated, () => this.actions.toggleHideDeprecated(), ' chip--dashed filterbar__spacer'),
      ]),
    ]);
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

define('fb-deprecated-bar', FbDeprecatedBar);
define('fb-tag-chips', FbTagChips);
