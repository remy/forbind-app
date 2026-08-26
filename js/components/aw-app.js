/**
 * The application shell.
 *
 * Owns the landmark structure — banner, navigation, main, and a named region
 * per pane — plus the skip links that jump to them and the two live regions
 * everything else announces through. Which screen is showing (import or
 * browser) is the only thing it re-renders for; every pane below manages its
 * own updates.
 */

import { AwElement, define } from '../lib/element.js';
import { el, replace } from '../lib/dom.js';
import { registerRegions } from '../lib/announce.js';

const SMALL_SCREEN = '(max-width: 48rem)';

class AwApp extends AwElement {
  static observes = ['schemaState', 'browsing', 'density', 'mobileView', 'railCollapsed', 'listCollapsed'];

  #media = null;
  #onMediaChange = null;
  #mounted = false;
  #skipLinks = null;
  #body = null;

  connectedCallback() {
    super.connectedCallback();
    // The list and the detail become separate pages below this width, which
    // changes both the layout and what the skip links should offer.
    this.#media = globalThis.matchMedia?.(SMALL_SCREEN);
    this.#onMediaChange = () => this.render(this.state);
    this.#media?.addEventListener('change', this.#onMediaChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#media?.removeEventListener('change', this.#onMediaChange);
  }

  /**
   * Folding a column away must not rebuild the shell.
   *
   * The control that did it lives in the top bar, inside the very tree a
   * re-render would replace — and a button replaced under the pointer takes
   * focus to the body with it. A column is a pair of attributes and a CSS
   * rule, so the change is written onto the element that is already there.
   */
  update(state, prev) {
    const structural = ['schemaState', 'browsing', 'density', 'mobileView'];
    if (structural.some((key) => !Object.is(state[key], prev[key]))) {
      this.render(state);
      return;
    }
    this.#syncColumns(state);
  }

  #syncColumns(state) {
    const app = this.#body?.firstElementChild;
    if (!(app instanceof HTMLElement) || !app.classList.contains('app--browse')) return;
    const small = this.#media?.matches ?? false;
    Object.assign(app.dataset, columnAttributes(state, small));
  }

  render(state) {
    const isBrowser = state.schemaState === 'ready' && state.browsing && state.schema;
    const small = this.#media?.matches ?? false;

    if (!this.#mounted) this.#mount();

    // Where the tags live depends on the layout: a rail at full width, a chip
    // row once that folds, facet buttons in the roomy IA. The link is offered
    // once and resolves to whichever of them is actually on screen — a skip
    // link pointing at a hidden element is worse than no skip link. A column
    // folded away is the same problem with a different cause, and has an
    // answer the layouts do not: where nothing the link names is on screen,
    // it unfolds the column on the way past. Only where nothing is — with the
    // rail folded the tag chips are standing in for it, and the link should
    // land on those rather than undo the fold.
    const skipTargets = isBrowser
      ? [
          ['#endpoint-list', 'Skip to the endpoint list', () => this.actions.showList()],
          ['#detail', 'Skip to the operation detail'],
          ['#search', 'Skip to search'],
          ['#tag-nav, #tag-chips, #filters', 'Skip to tags and filters', () => this.actions.showRail()],
        ]
      : [['#main', 'Skip to the schema import form']];

    replace(
      this.#skipLinks,
      skipTargets.map(([selector, label, reveal]) => el('a', {
        class: 'skip-link',
        href: selector.split(',')[0].trim(),
        text: label,
        // The fragment belongs to the router here, so letting the browser
        // navigate to `#detail` would be read as a route — one that names no
        // operation, which threw away both the selection and the filters. The
        // link keeps its href for semantics and for anyone who opens it in a
        // new tab; activating it moves focus directly instead.
        onclick: (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          focusSkipTarget(selector, reveal);
        },
      })),
    );

    replace(this.#body, [isBrowser ? this.#renderBrowser(state, small) : this.#renderImport()]);
  }

  /**
   * The parts that must outlive a re-render are built once and never replaced.
   *
   * The live regions have to be in the document from first paint — a region
   * created and filled in the same tick is routinely missed — and the dialogs
   * have to survive a state change made from inside one of them. Switching
   * density from the Display panel used to rebuild the shell, which destroyed
   * the very dialog the click came from.
   */
  #mount() {
    this.#mounted = true;
    this.#skipLinks = el('div', { class: 'skip-links' });
    this.#body = el('div', { class: 'app-root' });

    const polite = el('div', {
      class: 'live-region',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      id: 'aw-live-polite',
    });
    const assertive = el('div', {
      class: 'live-region',
      role: 'alert',
      'aria-live': 'assertive',
      'aria-atomic': 'true',
      id: 'aw-live-assertive',
    });

    replace(this, [
      this.#skipLinks,
      this.#body,
      polite,
      assertive,
      el('aw-palette', {}),
      el('aw-auth-sheet', {}),
      el('aw-options', {}),
    ]);

    registerRegions(polite, assertive);
  }

  #renderImport() {
    return el('div', { class: 'app', 'data-density': 'dense' }, [
      el('main', { id: 'main', tabindex: '-1', 'aria-label': 'Load a schema' }, [el('aw-import', {})]),
    ]);
  }

  #renderBrowser(state, small) {
    const roomy = state.density === 'roomy';

    const banner = el('header', { class: 'banner', role: 'banner' }, [
      // One h1 per page, naming the tool and the document it is showing.
      el('h1', { class: 'visually-hidden' }, [
        `allyway — ${state.schema.title}${state.schema.version ? ` ${state.schema.version}` : ''}`,
      ]),
      el('aw-topbar', {}),
      // The roomy IA folds the schema meta into the header row rather than
      // giving it a strip of its own, as drawn in 1b.
      roomy ? null : el('aw-meta-strip', {}),
    ]);

    const rail = el(
      'nav',
      { class: 'rail', id: 'tag-nav', tabindex: '-1', 'aria-label': 'Tags and schemas' },
      [el('aw-tag-rail', {})],
    );

    const listPane = el(
      'section',
      {
        class: 'pane pane--list',
        id: 'endpoint-list',
        tabindex: '-1',
        'aria-label': 'Endpoints',
      },
      [el('aw-endpoint-list', {})],
    );

    const detailPane = el(
      'section',
      {
        class: 'pane pane--detail',
        id: 'detail',
        tabindex: '-1',
        'aria-label': 'Operation detail',
      },
      [el('aw-detail', {})],
    );

    const main = el('main', {
      class: 'main',
      id: 'main',
      'aria-label': 'Endpoint browser',
    }, [listPane, detailPane]);

    return el(
      'div',
      {
        class: 'app app--browse',
        'data-density': roomy ? 'roomy' : 'dense',
        'data-mobile-view': small ? state.mobileView : 'both',
        dataset: columnAttributes(state, small),
      },
      [banner, el('div', { class: 'shell' }, [rail, main])],
    );
  }
}

/**
 * Which columns are folded away, as the attributes the stylesheet reads.
 *
 * Below the phone breakpoint the flags are ignored: the list and the detail
 * are separate pages there, so hiding the list would leave the browser with
 * nothing to navigate from.
 *
 * @param {object} state
 * @param {boolean} small
 */
function columnAttributes(state, small) {
  return {
    rail: !small && state.railCollapsed ? 'collapsed' : 'expanded',
    list: !small && state.listCollapsed ? 'collapsed' : 'expanded',
  };
}

/**
 * Put focus on a skip link's target and scroll it into view.
 *
 * A skip link that only scrolls has not done its job — the next Tab would
 * carry on from where it was, which is the thing the link exists to avoid. The
 * panes carry `tabindex="-1"` so they can take focus without becoming tab
 * stops; where the target is already a control, like the search field, it is
 * focused and its text selected so typing replaces the query.
 *
 * @param {string} selector one or more `#id` fragments; the first one that is
 *   actually rendered wins, so a link stays useful across the layouts.
 * @param {(() => void)} [reveal] last resort when none of them is on screen —
 *   unfold the column that holds the target, then look again.
 */
function focusSkipTarget(selector, reveal) {
  const onScreen = () => [...document.querySelectorAll(selector)]
    .find((node) => node.offsetParent !== null || node.getClientRects().length > 0);

  let target = onScreen();
  if (!target && reveal) {
    reveal();
    target = onScreen();
  }
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({
    block: 'start',
    behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
  if (typeof target.select === 'function') target.select();
}

define('aw-app', AwApp);
