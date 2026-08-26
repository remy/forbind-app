/**
 * The tag rail (1a) and the facet chip row that replaces it when the rail is
 * not on screen (1b, and every layout narrower than three panes).
 *
 * Tags are toggle buttons rather than links: they filter what the list shows
 * without changing which operation is open, so `aria-pressed` is the honest
 * state. Schemas are links, because they do navigate.
 */

import { AwElement, define } from '../lib/element.js';
import { el, replace, uid } from '../lib/dom.js';

class AwTagRail extends AwElement {
  static observes = ['schema', 'filters', 'selectedSchemaName'];

  update(state, prev) {
    // Opening a schema only changes which link is current; rebuilding the rail
    // would take the focused link out from under the keyboard.
    if (Object.is(state.schema, prev.schema) && Object.is(state.filters, prev.filters)) {
      for (const link of this.querySelectorAll('.rail__schema')) {
        if (link.textContent === state.selectedSchemaName) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      return;
    }
    this.render(state);
  }

  render(state) {
    const { schema, filters } = state;
    if (!schema) {
      replace(this, []);
      return;
    }

    const total = schema.operations.length;
    const noneSelected = filters.tags.length === 0;

    const tagRows = [
      el('li', {}, [
        el(
          'button',
          {
            type: 'button',
            class: 'rail__item',
            'aria-pressed': String(noneSelected),
            onclick: () => this.actions.setTags([]),
          },
          [
            el('span', { text: 'All endpoints' }),
            el('span', { class: 'rail__count', text: String(total) }),
          ],
        ),
      ]),
      ...schema.tags.map((tag) =>
        el('li', {}, [
          el(
            'button',
            {
              type: 'button',
              class: 'rail__item',
              'aria-pressed': String(filters.tags.includes(tag.name)),
              onclick: (event) => this.actions.toggleTag(tag.name, { additive: event.shiftKey || event.metaKey || event.ctrlKey }),
            },
            [
              el('span', { text: tag.name }),
              el('span', { class: 'rail__count', text: String(tag.count) }),
            ],
          ),
        ]),
      ),
    ];

    const tagsLabelId = uid('rail-tags');
    const schemasLabelId = uid('rail-schemas');

    replace(this, [
      el('h2', { class: 'label rail__label', id: tagsLabelId, text: 'Tags' }),
      el('ul', { class: 'rail__list', 'aria-labelledby': tagsLabelId }, tagRows),
      el('h2', { class: 'label rail__divider', id: schemasLabelId, text: 'Schemas' }),
      el(
        'ul',
        { class: 'rail__list', 'aria-labelledby': schemasLabelId },
        schema.schemas.map((entry) =>
          el('li', {}, [
            el('a', {
              class: 'rail__schema',
              href: this.actions.hashFor({ view: 'schema', id: entry.name }),
              text: entry.name,
              'aria-current': state.selectedSchemaName === entry.name ? 'page' : null,
            }),
          ]),
        ),
      ),
    ]);
  }
}

/**
 * The applied-filter row from 1b: filled tokens for what is on, outline
 * disclosures for the facets that are not. Each disclosure reveals a group of
 * checkboxes in the flow of the page rather than in a popup — a menu that has
 * to be positioned is a menu that breaks at 400% zoom.
 */
class AwFacets extends AwElement {
  static observes = ['schema', 'filters'];

  /** @type {string|null} which facet panel is open */
  #open = null;

  render(state) {
    const { schema, filters } = state;
    if (!schema) {
      replace(this, []);
      return;
    }

    const applied = [
      ...filters.tags.map((tag) => ({ label: `Tag: ${tag}`, remove: () => this.actions.toggleTag(tag) })),
      ...filters.verbs.map((verb) => ({ label: `Verb: ${verb}`, remove: () => this.actions.toggleVerb(verb) })),
      ...filters.scopes.map((scope) => ({ label: `Scope: ${scope}`, remove: () => this.actions.toggleScope(scope) })),
      ...filters.statusCodes.map((code) => ({ label: `Status: ${code}`, remove: () => this.actions.toggleStatusCode(code) })),
    ];

    const facets = [
      { key: 'tag', label: 'tag', values: schema.tags.map((t) => t.name), active: filters.tags, toggle: (v) => this.actions.toggleTag(v, { additive: true }) },
      { key: 'verb', label: 'verb', values: schema.verbCounts.map((v) => v.verb), active: filters.verbs, toggle: (v) => this.actions.toggleVerb(v) },
      { key: 'scope', label: 'auth scope', values: this.actions.allScopes(), active: filters.scopes, toggle: (v) => this.actions.toggleScope(v) },
      { key: 'status', label: 'status code', values: this.actions.allStatusCodes(), active: filters.statusCodes, toggle: (v) => this.actions.toggleStatusCode(v) },
    ].filter((facet) => facet.values.length > 0);

    const openFacet = facets.find((facet) => facet.key === this.#open) ?? null;
    const panelId = 'facet-panel';

    replace(this, [
      el('div', { class: 'filterbar', id: 'filters', tabindex: '-1', role: 'group', 'aria-label': 'Filters' }, [
        ...applied.map((item) =>
          el('button', {
            type: 'button',
            class: 'chip',
            'aria-pressed': 'true',
            onclick: item.remove,
          }, [
            el('span', { text: item.label }),
            el('span', { 'aria-hidden': 'true', text: '✕' }),
            el('span', { class: 'visually-hidden', text: ' — remove this filter' }),
          ]),
        ),
        ...facets.map((facet) =>
          el('button', {
            type: 'button',
            class: 'chip',
            'aria-expanded': String(this.#open === facet.key),
            'aria-controls': panelId,
            text: `+ ${facet.label}`,
            onclick: () => {
              this.#open = this.#open === facet.key ? null : facet.key;
              this.render(this.state);
              this.querySelector(`[aria-controls="${panelId}"][aria-expanded="true"]`)?.focus();
            },
          }),
        ),
        el('button', {
          type: 'button',
          class: 'chip chip--dashed filterbar__spacer',
          'aria-pressed': String(filters.hideDeprecated),
          text: 'Hide deprecated',
          onclick: () => this.actions.toggleHideDeprecated(),
        }),
      ]),
      openFacet
        ? el(
            'div',
            { class: 'filterbar', id: panelId, role: 'group', 'aria-label': `Filter by ${openFacet.label}` },
            openFacet.values.map((value) =>
              el('button', {
                type: 'button',
                class: 'chip',
                'aria-pressed': String(openFacet.active.includes(value)),
                text: value,
                onclick: () => openFacet.toggle(value),
              }),
            ),
          )
        : el('div', { id: panelId, hidden: true }),
    ]);
  }
}

define('aw-tag-rail', AwTagRail);
define('aw-facets', AwFacets);
