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

import { AwElement, define } from '../lib/element.js';
import { el, replace, uid } from '../lib/dom.js';
import { verbLabel, verbClass, statusClass, fieldRows, payloadChildren, describeType } from '../lib/openapi.js';
import { sampleValue } from '../lib/request.js';
import { markdownBlock, markdownToText } from '../lib/markdown.js';
import { paramTable, renderSchemaView } from './detail-fields.js';

const NARROW = '(max-width: 48rem)';

/** Sections in the order they are read. */
const SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'body', label: 'Body' },
  { key: 'responses', label: 'Responses' },
  { key: 'code', label: 'Code' },
  { key: 'tryit', label: 'Try it' },
];

class AwDetail extends AwElement {
  static observes = ['schema', 'selectedOperationId', 'selectedSchemaName', 'density', 'auth', 'mobileView'];

  #tab = 'overview';
  #media = null;
  #onMediaChange = null;

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
   * Responses, opened up.
   *
   * Collapsed, each one is the row the design draws: a status chip and its
   * phrase. Opened, it is what the response actually contains — the shape of
   * the body as a walkable set of fields, and an example built from the same
   * schema. Every 2xx starts open, because that is the one you came to read;
   * the rest wait to be asked for.
   */
  #sectionResponses(state, op) {
    if (!op.responses.length) {
      return el('section', { class: 'detail__section', 'aria-label': 'Responses' }, [
        el('p', { class: 'empty__body', text: 'This operation declares no responses.' }),
      ]);
    }

    const success = op.responses.filter((r) => statusClass(r.code) === 'success');

    return el('section', { class: 'detail__section', 'aria-label': 'Responses' }, [
      el('ul', { class: 'response-list' }, op.responses.map((response) =>
        el('li', {}, [this.#renderResponse(state, response, success.length === 1 && success[0] === response)]),
      )),
    ]);
  }

  #renderResponse(state, response, openByDefault) {
    const klass = statusClass(response.code);
    const hasBody = Boolean(response.schema);
    const children = hasBody ? payloadChildren(state.schema.doc, response.schema) : null;
    const typeLabel = hasBody ? describeType(state.schema.doc, response.schema).label : '';

    let shape = 'no body';
    if (hasBody) {
      const count = children?.items.length ?? 0;
      if (!children) shape = typeLabel;
      else if (children.kind === 'variants') shape = `${typeLabel} · ${count} shapes`;
      else shape = `${typeLabel} · ${count} ${count === 1 ? 'field' : 'fields'}`;
    }

    const summaryLine = el('summary', { class: 'response-summary' }, [
      el('span', { class: `response-chip pill--${klass}`, text: response.code }),
      el('span', { class: 'response-summary__text', text: markdownToText(response.description) || '—' }),
      el('span', { class: 'response-summary__shape', text: shape }),
    ]);

    if (!hasBody) {
      // Nothing to open, so it is a row rather than a disclosure that does
      // nothing when you press it.
      return el('div', { class: 'response-row' }, [
        el('span', { class: `response-chip pill--${klass}`, text: response.code }),
        el('span', { class: 'response-summary__text', text: markdownToText(response.description) || '—' }),
        el('span', { class: 'response-summary__shape', text: shape }),
      ]);
    }

    const tree = el('aw-schema-tree', {});
    const label = `The ${response.code} response body`;
    const example = exampleFor(state.schema.doc, response);

    const wrapper = el('details', { class: 'response-detail', open: openByDefault ? true : null }, [
      summaryLine,
      el('div', { class: 'response-detail__body' }, [
        el('div', { class: 'response-detail__meta' }, [
          response.contentType
            ? el('span', { class: 'chip chip--static', text: response.contentType })
            : null,
          response.schemaName
            ? el('a', {
                href: this.actions.hashFor({ view: 'schema', id: response.schemaName }),
                text: response.schemaName,
              })
            : null,
        ]),
        el('div', { class: 'detail__section' }, [
          el('h3', { class: 'label', text: 'Body' }),
          tree,
        ]),
        example !== null
          ? el('div', { class: 'detail__section' }, [
              el('h3', { class: 'label', text: 'Example' }),
              el('pre', { class: 'code-block', tabindex: '0', text: example }),
            ])
          : null,
      ]),
    ]);

    // A closed response does not pay to describe a payload nobody has asked
    // to see — and an operation can declare a dozen of them.
    const describe = () => tree.describe(response.schema, label);
    if (openByDefault) describe();
    else wrapper.addEventListener('toggle', () => { if (wrapper.open) describe(); }, { once: true });

    return wrapper;
  }

  #sectionCode(state, op) {
    const block = el('aw-code-block', {});
    block.operation = op;
    return el('section', { class: 'detail__section', 'aria-label': 'Request snippet' }, [block]);
  }

  #sectionTryIt(state, op) {
    const panel = el('aw-try-it', { id: 'try-it' });
    panel.operation = op;
    return el('section', { class: 'detail__section', 'aria-label': 'Try it' }, [panel]);
  }

  /* --- component schema view -------------------------------------------- */

}

/**
 * The example body: whatever the document offers, else one built from the
 * schema. Unlike a request draft this includes optional fields — a response
 * example is meant to show everything you might get back.
 */
function exampleFor(doc, response) {
  if (response.example !== undefined) return JSON.stringify(response.example, null, 2);
  if (!response.schema) return null;
  const value = sampleValue(doc, response.schema, { includeOptional: true });
  if (value === null || value === undefined) return null;
  return JSON.stringify(value, null, 2);
}

define('aw-detail', AwDetail);