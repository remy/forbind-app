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
  static observes = ['schemaState', 'browsing', 'density', 'mobileView'];

  #media = null;
  #onMediaChange = null;

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

  render(state) {
    const isBrowser = state.schemaState === 'ready' && state.browsing && state.schema;
    const small = this.#media?.matches ?? false;

    const skipTargets = isBrowser
      ? [
          ['#endpoint-list', 'Skip to the endpoint list'],
          ['#detail', 'Skip to the operation detail'],
          ['#search', 'Skip to search'],
          ['#tag-nav', 'Skip to tags and schemas'],
        ]
      : [['#import-main', 'Skip to the schema import form']];

    const skipLinks = el(
      'div',
      { class: 'skip-links' },
      skipTargets.map(([href, label]) => el('a', { class: 'skip-link', href, text: label })),
    );

    const politeRegion = el('div', {
      class: 'live-region',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      id: 'aw-live-polite',
    });
    const assertiveRegion = el('div', {
      class: 'live-region',
      role: 'alert',
      'aria-live': 'assertive',
      'aria-atomic': 'true',
      id: 'aw-live-assertive',
    });

    const body = isBrowser ? this.#renderBrowser(state, small) : this.#renderImport();

    replace(this, [
      skipLinks,
      body,
      politeRegion,
      assertiveRegion,
      el('aw-palette', {}),
      el('aw-auth-sheet', {}),
      el('aw-options', {}),
    ]);

    registerRegions(politeRegion, assertiveRegion);
  }

  #renderImport() {
    return el('div', { class: 'app', 'data-density': 'dense' }, [
      el('main', { id: 'main', 'aria-label': 'Load a schema' }, [el('aw-import', {})]),
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
        class: 'app',
        'data-density': roomy ? 'roomy' : 'dense',
        'data-mobile-view': small ? state.mobileView : 'both',
      },
      [banner, el('div', { class: 'shell' }, [rail, main])],
    );
  }
}

define('aw-app', AwApp);
