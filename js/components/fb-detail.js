/**
 * The detail pane.
 *
 * Renders three things depending on the route: an operation, a component
 * schema, or the "nothing selected yet" state.
 *
 * An operation's sections are a tab set in every layout, built on the ARIA
 * tabs pattern: one tab stop for the tab list, arrows to move between tabs,
 * and the panel labelled by its tab. The only thing a layout changes is how
 * the tabs are drawn — a row of them where there is width, a segmented
 * control on a phone.
 *
 * Parameters render as a real `<table>` where there is room for one, and as a
 * real `<dl>` of stacked rows where there is not. A table restyled with
 * `display: block` keeps the look and loses the semantics, which is the wrong
 * trade in a tool whose whole point is the semantics.
 */

import { FbElement, define } from '../lib/element.js';
import { el, replace, uid } from '../lib/dom.js';
import { verbLabel, verbClass, fieldRows } from '../lib/openapi.js';
import { markdownBlock } from '../lib/markdown.js';
import { paramTable, renderSchemaView } from './detail-fields.js';
import { defaultOpenResponses, renderResponses } from './detail-responses.js';

const NARROW = '(max-width: 48rem)';

/** Sections in the order they are read. */
const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'body', label: 'Body' },
  { key: 'responses', label: 'Responses' },
  { key: 'code', label: 'Code' },
  { key: 'tryit', label: 'Try it' },
];

class FbDetail extends FbElement {
  static observes = ['schema', 'selectedOperationId', 'selectedSchemaName', 'density', 'auth', 'mobileView'];

  #tab = 'overview';
  #media = null;
  #onMediaChange = null;
  /** Panels that hold the reader's own work, kept across renders — see #keptPanel. */
  #panels = {};
  /** The schema they were built for; a new document gets new panels. */
  #panelsFor = null;
  /** Which responses are unfolded, and the operation that was asked. */
  #openResponses = null;
  #openResponsesFor = null;

  connectedCallback() {
    this.#media = globalThis.matchMedia?.(NARROW);
    this.#onMediaChange = () => this.render(this.state);
    this.#media?.addEventListener('change', this.#onMediaChange);
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#media?.removeEventListener('change', this.#onMediaChange);
  }

  get #narrow() {
    return this.#media?.matches ?? false;
  }

  render(state) {
    const { schema } = state;
    if (!schema) {
      replace(this, []);
      return;
    }
    if (state.selectedSchemaName) {
      replace(this, renderSchemaView(state, { narrow: this.#narrow, hashFor: (t) => this.actions.hashFor(t) }));
      return;
    }
    const op = schema.operations.find((candidate) => candidate.id === state.selectedOperationId);
    if (!op) {
      replace(this, [this.#renderNothingSelected(state)]);
      return;
    }
    replace(this, this.#renderOperation(state, op));
  }

  /* --- empty ------------------------------------------------------------ */

  #renderNothingSelected(state) {
    const first = this.actions.visibleOperations()[0];
    return el('div', { class: 'detail__body' }, [
      el('h2', { class: 'empty__title', text: 'Pick an endpoint' }),
      el('p', { class: 'empty__body', text: `${state.schema.operations.length} operations across ${state.schema.tags.length} tags. Choose one from the list, or press Command K for the palette.` }),
      first
        ? el('p', { class: 'empty__body' }, [
            el('a', {
              href: this.actions.hashFor({ view: 'operation', id: first.id }),
              text: `Start with ${first.method} ${first.path}`,
            }),
          ])
        : null,
    ]);
  }

  /* --- operation -------------------------------------------------------- */

  #renderOperation(state, op) {
    const roomy = state.density === 'roomy';
    const header = this.#renderHeader(state, op, roomy);

    const available = SECTIONS.filter((section) => {
      if (section.key === 'body') return Boolean(op.requestBody) || op.parameters.length > 0;
      return true;
    });
    if (!available.some((section) => section.key === this.#tab)) this.#tab = 'overview';

    const baseId = uid('tabs');
    const tablist = el(
      'div',
      {
        class: `tabs${this.#narrow && !roomy ? ' tabs--segmented' : ''}`,
        role: 'tablist',
        'aria-label': 'Operation sections',
        onkeydown: (event) => this.#onTabKey(event, available),
      },
      available.map((section) =>
        el('button', {
          type: 'button',
          class: 'tab',
          role: 'tab',
          id: `${baseId}-tab-${section.key}`,
          'aria-selected': String(this.#tab === section.key),
          'aria-controls': `${baseId}-panel-${section.key}`,
          tabindex: this.#tab === section.key ? '0' : '-1',
          dataset: { tab: section.key },
          text: section.label,
          onclick: () => {
            this.#tab = section.key;
            this.render(this.state);
            this.querySelector(`#${CSS.escape(`${baseId}-tab-${section.key}`)}`)?.focus();
          },
        }),
      ),
    );

    const panel = el(
      'div',
      {
        class: 'tabpanel detail__body',
        role: 'tabpanel',
        id: `${baseId}-panel-${this.#tab}`,
        'aria-labelledby': `${baseId}-tab-${this.#tab}`,
        tabindex: '0',
      },
      [this.#renderPanel(state, op, this.#tab)],
    );

    return [
      header,
      tablist,
      panel,
      this.#narrow ? this.#renderStickyAction(op) : null,
    ];
  }

  #renderPanel(state, op, key) {
    switch (key) {
      case 'body': return this.#sectionBody(state, op);
      case 'responses': return this.#sectionResponses(state, op);
      case 'code': return this.#sectionCode(state, op);
      case 'tryit': return this.#sectionTryIt(state, op);
      case 'overview':
      default: return this.#sectionOverview(state, op);
    }
  }

  /** Open a named section, whoever asked — a command, a link, the palette. */
  showTab(key) {
    this.#tab = key;
    this.render(this.state);
  }

  #onTabKey(event, available) {
    const index = available.findIndex((section) => section.key === this.#tab);
    let next = null;
    if (event.key === 'ArrowRight') next = (index + 1) % available.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + available.length) % available.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = available.length - 1;
    if (next === null) return;
    event.preventDefault();
    this.#tab = available[next].key;
    this.render(this.state);
    this.querySelector(`[role="tab"][data-tab="${CSS.escape(this.#tab)}"]`)?.focus();
  }

  #renderHeader(state, op, roomy) {
    const backLink = el('div', { class: 'detail-back' }, [
      el('a', {
        class: 'detail-back__link',
        href: this.actions.hashFor({ view: 'browse' }),
        onclick: (event) => {
          event.preventDefault();
          this.actions.backToList();
        },
      }, [
        el('span', { 'aria-hidden': 'true', text: '‹' }),
        el('span', { text: `Back to ${state.filters.tags[0] ?? 'the endpoint list'}` }),
      ]),
      el('span', { class: 'detail-back__end' }, [
        el('button', {
          type: 'button',
          class: 'btn btn--sm',
          text: 'Copy curl',
          onclick: (event) => this.actions.copyCurl(op, event.currentTarget),
        }),
      ]),
    ]);

    const chips = [
      op.security.length
        ? el('span', { class: 'chip chip--static', text: `requires ${this.actions.schemeLabel(op.security[0].schemeId)}` })
        : el('span', { class: 'chip chip--static', text: 'no auth required' }),
      ...op.scopes.map((scope) => el('span', { class: 'chip chip--static', text: `scope: ${scope}` })),
      op.extensions.rateLimit ? el('span', { class: 'chip chip--static', text: `rate ${op.extensions.rateLimit}` }) : null,
      op.deprecated ? el('span', { class: 'chip chip--static', text: 'deprecated' }) : null,
    ].filter(Boolean);

    return el('div', {}, [
      backLink,
      el('div', { class: 'detail__header detail__header--tabbed' }, [
        el('div', { class: 'detail__title-row' }, [
          verbLabel(op.method) === op.method
            ? el('span', { class: `pill detail__pill pill--${op.deprecated ? 'neutral' : verbClass(op.method)}`, text: op.method })
            : el('span', { class: `pill detail__pill pill--${op.deprecated ? 'neutral' : verbClass(op.method)}` }, [
                el('span', { 'aria-hidden': 'true', text: verbLabel(op.method) }),
                el('span', { class: 'visually-hidden', text: op.method }),
              ]),
          el('h2', { class: 'detail__path', text: op.path }),
          // Try it is one of the tabs, and on a phone it is also the sticky
          // action; a copy here as well would be three controls doing one job.
        ]),
        op.summary && !roomy ? el('p', { class: 'detail__lede', text: op.summary }) : null,
        chips.length ? el('div', { class: 'detail__chips' }, chips) : null,
      ]),
    ]);
  }

  #renderStickyAction(op) {
    return el('div', { class: 'sticky-action' }, [
      el('button', {
        type: 'button',
        class: 'btn btn--filled',
        text: 'Try this request',
        onclick: () => this.actions.openTryIt(op.id),
      }),
    ]);
  }

  /* --- sections --------------------------------------------------------- */

  #sectionOverview(state, op) {
    const prose = op.description || op.summary;
    const facts = [
      ['Auth', op.security.length
        ? `${this.actions.schemeLabel(op.security[0].schemeId)}${op.scopes.length ? ` · ${op.scopes.join(', ')}` : ''}`
        : 'None'],
      ['Rate limit', op.extensions.rateLimit],
      ['Idempotent', op.extensions.idempotent],
      ['Since', op.extensions.since],
      ['Operation id', op.operationId],
      ['Server', op.servers[0]?.url],
    ].filter(([, value]) => Boolean(value));

    return el('section', { class: 'detail__section', 'aria-label': 'Overview' }, [
      // `description` is CommonMark in OpenAPI, and documents write it that
      // way; see js/lib/markdown.js for what is and is not rendered.
      markdownBlock(prose, { class: 'detail__lede' }),
      op.deprecated
        ? el('p', { class: 'tryit__warning' }, [
            el('span', { class: 'word word--warn', text: 'DEPRECATED' }),
            el('span', { text: 'This operation is marked deprecated in the schema. It is still listed so existing callers can read it.' }),
          ])
        : null,
      facts.length
        ? el('dl', { class: 'facts' }, facts.map(([label, value]) =>
            el('div', {}, [el('dt', { text: label }), el('dd', { text: String(value) })]),
          ))
        : null,
    ]);
  }

  #sectionBody(state, op) {
    const params = op.parameters.filter((p) => p.in !== 'body');
    return el('section', { class: 'detail__section', 'aria-label': 'Request body and parameters' }, [
      params.length ? this.#paramGroups(state, op, params) : null,
      op.requestBody ? this.#requestBody(state, op) : null,
      !op.requestBody && !params.length
        ? el('p', { class: 'empty__body', text: 'This operation takes no parameters and no request body.' })
        : null,
    ]);
  }

  #paramGroups(state, op, params) {
    const groups = [
      ['path', 'Path parameters'],
      ['query', 'Query parameters'],
      ['header', 'Header parameters'],
      ['cookie', 'Cookie parameters'],
    ];
    return el('div', {}, groups.map(([where, label]) => {
      const rows = params.filter((p) => p.in === where);
      if (!rows.length) return null;
      return el('div', { class: 'detail__section' }, [
        el('h3', { class: 'label', text: label }),
        this.#fieldTable(
          label,
          rows.map((p) => ({
            name: p.name,
            type: p.type,
            required: p.required,
            notes: p.constraints.join(' · '),
            description: p.description,
            deprecated: p.deprecated,
          })),
        ),
      ]);
    }));
  }

  #requestBody(state, op) {
    const rows = fieldRows(state.schema.doc, op.requestBody.schema);
    const title = op.requestBody.schemaName
      ? `Request body — ${op.requestBody.schemaName}`
      : 'Request body';
    return el('div', { class: 'detail__section' }, [
      el('div', { class: 'detail__section-head' }, [
        el('h3', { class: 'label', text: title }),
        el('span', { class: 'chip chip--static', text: op.requestBody.required ? 'required' : 'optional' }),
        op.requestBody.contentType
          ? el('span', { class: 'chip chip--static', text: op.requestBody.contentType })
          : null,
      ]),
      markdownBlock(op.requestBody.description, { class: 'detail__lede' }),
      rows.length
        ? this.#fieldTable(title, rows)
        : el('p', { class: 'empty__body', text: 'The body schema does not declare named properties.' }),
    ]);
  }

  /**
   * @param {string} caption
   * @param {Array<{name: string, type: {label: string, ref: string|null}, required: boolean, notes: string, description?: string, deprecated?: boolean}>} rows
   */
  /** The shared field table, told which layout it is in. */
  #fieldTable(caption, rows) {
    return paramTable({
      caption,
      rows,
      narrow: this.#narrow,
      hashFor: (target) => this.actions.hashFor(target),
    });
  }

  /**
   * Responses, opened up — drawn by `detail-responses.js`.
   *
   * Which of them are open is remembered here rather than there, because the
   * section is rebuilt on every render of the pane and a disclosure the reader
   * opened should still be open after a trip to another tab. A different
   * operation is a different question, and starts from the default again.
   */
  #sectionResponses(state, op) {
    if (this.#openResponsesFor !== op) {
      this.#openResponsesFor = op;
      this.#openResponses = defaultOpenResponses(op);
    }
    return renderResponses(state, op, {
      hashFor: (target) => this.actions.hashFor(target),
      opened: this.#openResponses,
    });
  }

  #sectionCode(state, op) {
    const block = this.#keptPanel(state, 'fb-code-block');
    block.operation = op;
    return el('section', { class: 'detail__section', 'aria-label': 'Request snippet' }, [block]);
  }

  /**
   * A panel holding the reader's own work is kept, not rebuilt.
   *
   * What has been typed into Try it, and which language Code is showing, live
   * on those elements, so a fresh one is an emptied form and a snippet back at
   * curl — and this runs again on every re-render: switching tabs and back,
   * pressing "Try this request" a second time, a credential arriving. None of
   * those is a request to throw the reader's work away. The panels go when the
   * document does, which is the one time they should.
   */
  #keptPanel(state, tag, attrs = {}) {
    if (this.#panelsFor !== state.schema) {
      this.#panels = {};
      this.#panelsFor = state.schema;
    }
    this.#panels[tag] ??= el(tag, attrs);
    return this.#panels[tag];
  }

  #sectionTryIt(state, op) {
    const panel = this.#keptPanel(state, 'fb-try-it', { id: 'try-it' });
    panel.operation = op;
    return el('section', { class: 'detail__section', 'aria-label': 'Try it' }, [panel]);
  }
}

define('fb-detail', FbDetail);
