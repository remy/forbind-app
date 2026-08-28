/**
 * The import screen: empty, parsed, and failed.
 *
 * The drop zone is a real `<input type="file">` with a visible label. Drag and
 * drop is layered on top as an enhancement and is never the only route — and
 * the dragover state is announced in text, because "the box went blue" is not
 * information everyone receives.
 *
 * A schema with no `servers` block gets one more thing on the report: a field
 * for the base URL, beside — never in front of — the button that browses
 * without one. The document is missing half an address; that is worth saying
 * at the moment it is read, and worth being able to fix there, but it is not a
 * reason to hold the schema hostage.
 *
 * Parse problems are not a modal alert. They join the same "things worth
 * knowing" list, led by a word rather than an icon, with the line and column
 * and a way to see the offending line. A schema with loose docs is still
 * perfectly browsable, so warnings never block the way through.
 */

import { AwElement, define } from '../lib/element.js';
import { el, replace } from '../lib/dom.js';
import { announce } from '../lib/announce.js';
import { logoMark } from '../lib/logo.js';

const SAMPLE = '/samples/bookings-api.v2.yaml';

class AwImport extends AwElement {
  static observes = ['schema', 'schemaState', 'schemaError', 'importNote', 'importUrl'];

  #dragDepth = 0;

  render(state) {
    if (state.schemaState === 'ready' && state.schema) {
      replace(this, [this.#renderReport(state)]);
      // The report replaces the form, so say what happened.
      return;
    }
    replace(this, [this.#renderForm(state)]);

    // The failed form is a rebuilt form: whatever the reader pressed to start
    // the fetch — the Fetch button, or Enter in the field — no longer exists,
    // and focus would otherwise fall to the body. Where the address is still
    // there to be corrected, the caret goes back to the end of it.
    if (state.schemaState === 'error' && state.importUrl) {
      const field = this.querySelector('#schema-url');
      if (field) {
        field.focus({ preventScroll: true });
        const end = field.value.length;
        try {
          field.setSelectionRange(end, end);
        } catch {
          /* `type="url"` does not support a selection range everywhere. */
        }
      }
    }
  }

  /* --- empty / loading / error ------------------------------------------ */

  #renderForm(state) {
    const loading = state.schemaState === 'loading';
    const error = state.schemaState === 'error' ? state.schemaError : null;

    const dropzone = el(
      'div',
      {
        class: 'dropzone',
        dataset: { dragging: 'false' },
        ondragenter: (event) => this.#onDragEnter(event),
        ondragover: (event) => { event.preventDefault(); },
        ondragleave: (event) => this.#onDragLeave(event),
        ondrop: (event) => this.#onDrop(event),
      },
      [
        el('p', { class: 'dropzone__title', text: 'Drop a file here' }),
        el('span', { class: 'filepick' }, [
          el('input', {
            type: 'file',
            id: 'schema-file',
            accept: '.json,.yaml,.yml,application/json,text/yaml,application/yaml',
            'aria-describedby': 'drop-status',
            onchange: (event) => {
              const file = event.target.files?.[0];
              if (file) this.actions.loadFile(file);
            },
          }),
          el('label', { for: 'schema-file', text: 'Choose file…' }),
        ]),
        el('p', { class: 'dropzone__or', text: 'or paste a URL below' }),
        el('p', {
          class: 'dropzone__status',
          id: 'drop-status',
          role: 'status',
          'aria-live': 'polite',
          text: loading ? 'Loading and parsing the schema…' : '',
        }),
      ],
    );

    const urlInput = el('input', {
      type: 'url',
      id: 'schema-url',
      // A fetch that failed is a fetch worth retrying, usually after a small
      // edit. Emptying the field would make the reader retype an address the
      // app is still holding, so it is written back as the value.
      '.value': state.importUrl ?? '',
      placeholder: 'https://…/openapi.yaml',
      autocomplete: 'url',
      spellcheck: 'false',
      'aria-describedby': 'url-help',
      onkeydown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.actions.loadUrl(event.target.value);
        }
      },
    });

    return el('div', { class: 'import' }, [
      el('div', { class: 'import__inner' }, [
        el('h1', { class: 'brand' }, [
          logoMark(),
          el('span', { class: 'brand__name', text: 'Allyway' }),
        ]),
        // What the thing is, in one line, before what to do with it. The name
        // above says nothing on its own to anyone arriving from a link.
        el('p', {
          class: 'import__tagline',
          text: 'An OpenAPI browser whose point is that it is accessible.',
        }),
        el('p', {
          class: 'import__lede',
          text: 'Load an OpenAPI schema — JSON or YAML, 2.0 through 3.1. '
            + 'Nothing leaves your browser unless you send a request.',
        }),

        dropzone,

        el('div', { class: 'urlrow' }, [
          el('label', { class: 'visually-hidden', for: 'schema-url', text: 'Schema URL' }),
          urlInput,
          el('button', {
            type: 'button',
            text: 'Fetch',
            onclick: () => this.actions.loadUrl(urlInput.value),
          }),
        ]),
        el('p', { class: 'help', id: 'url-help' }, [
          el('span', { text: 'Fetched by your browser first. If the host does not allow that, allyway fetches it server-side instead and says so. ' }),
          el('button', {
            type: 'button',
            class: 'link-quiet',
            text: 'Or open the bundled example schema',
            onclick: () => this.actions.loadSample(SAMPLE),
          }),
        ]),

        error ? this.#renderError(error) : null,

        el('p', {
          class: 'import__foot',
          text: 'The drop zone is a real file input with a visible label — keyboard and drag both work, and the button is the primary path, not a fallback.',
        }),
      ]),
    ]);
  }

  #renderError(error) {
    const detail = error.detail ?? {};
    const where = detail.line ? `line ${detail.line}${detail.column ? `, column ${detail.column}` : ''}` : null;

    // A failure lists one row or two depending on whether it carries a hint,
    // and the disclosure under it is a third thing on screen. Rather than
    // count what is arguably countable more than one way, the heading names
    // the list and leaves the counting to the parse report, where the number
    // is the point.
    const rows = [
      el('li', {}, [
        el('span', { class: 'word word--fail', text: 'FAIL' }),
        el('span', {}, [
          el('span', { text: error.message }),
          where ? el('span', { text: ` (${where})` }) : null,
          detail.message ? el('span', { text: ` ${detail.message}` }) : null,
        ]),
      ]),
      detail.hint
        ? el('li', {}, [
            el('span', { class: 'word word--info', text: 'INFO' }),
            el('span', { text: detail.hint }),
          ])
        : null,
    ].filter(Boolean);

    return el('div', { class: 'detail__section' }, [
      el('h2', { class: 'label', text: 'Worth knowing' }),
      el('ul', { class: 'notes' }, rows),
      detail.snippet
        ? el('details', {}, [
            el('summary', { text: `Show ${where ?? 'the line'}` }),
            el('pre', { class: 'import__error-detail', text: `${detail.line ?? ''}  ${detail.snippet}` }),
          ])
        : null,
    ]);
  }

  /* --- parsed ----------------------------------------------------------- */

  #renderReport(state) {
    const { schema, importNote } = state;
    const { counts, notes, ok } = schema.report;

    const stats = [
      [counts.endpoints, 'endpoints'],
      [counts.tags, 'tags'],
      [counts.schemas, 'schemas'],
      [counts.deprecated, 'deprecated'],
    ];

    return el('div', { class: 'import' }, [
      el('div', { class: 'import__inner import__inner--wide' }, [
        el('div', { class: 'report__head' }, [
          el('h1', { class: 'report__head-title', text: schema.sourceName }),
          el('span', {
            class: `pill ${ok ? 'pill--success' : 'pill--error'}`,
            text: ok ? 'Parsed OK' : 'Parsed with problems',
          }),
        ]),
        schema.title && schema.title !== schema.sourceName
          ? el('p', { class: 'import__lede', text: `${schema.title}${schema.version ? ` ${schema.version}` : ''} · ${schema.oasLabel}` })
          : null,
        importNote ? el('p', { class: 'import__lede', text: importNote }) : null,

        el('dl', { class: 'stats' }, stats.map(([value, label]) =>
          el('div', {}, [
            el('dd', { text: String(value) }),
            el('dt', { text: label }),
          ]),
        )),

        notes.length
          ? el('div', { class: 'detail__section' }, [
              el('h2', { class: 'label', text: `${notes.length} ${notes.length === 1 ? 'thing' : 'things'} worth knowing` }),
              el('ul', { class: 'notes' }, notes.map((note) =>
                el('li', {}, [
                  el('span', { class: `word word--${note.level.toLowerCase()}`, text: note.level }),
                  el('span', {}, note.parts.map((part) =>
                    typeof part === 'string' ? el('span', { text: part }) : el('code', { text: part.code }),
                  )),
                ]),
              )),
            ])
          : null,

        el('aw-base-url'),

        el('div', { class: 'sheet__actions' }, [
          el('button', {
            type: 'button',
            class: 'btn btn--filled btn--lg',
            text: `Browse ${counts.endpoints} endpoints`,
            onclick: () => this.actions.enterBrowser(),
          }),
          Object.keys(schema.securitySchemes).length
            ? el('button', {
                type: 'button',
                class: 'btn btn--lg',
                text: 'Set up auth first',
                onclick: () => this.actions.authThenBrowse(),
              })
            : null,
          el('button', {
            type: 'button',
            class: 'btn btn--lg',
            text: 'Load a different schema',
            onclick: () => this.actions.replaceSchema(),
          }),
        ]),
      ]),
    ]);
  }

  /* --- drag and drop ---------------------------------------------------- */

  #status(text) {
    const node = this.querySelector('#drop-status');
    if (node) node.textContent = text;
  }

  #onDragEnter(event) {
    event.preventDefault();
    this.#dragDepth += 1;
    const zone = this.querySelector('.dropzone');
    if (zone) zone.dataset.dragging = 'true';
    // The colour change is not the message; the sentence is.
    this.#status('A file is over the drop zone. Release to load it.');
  }

  #onDragLeave(event) {
    event.preventDefault();
    this.#dragDepth = Math.max(0, this.#dragDepth - 1);
    if (this.#dragDepth > 0) return;
    const zone = this.querySelector('.dropzone');
    if (zone) zone.dataset.dragging = 'false';
    this.#status('');
  }

  #onDrop(event) {
    event.preventDefault();
    this.#dragDepth = 0;
    const zone = this.querySelector('.dropzone');
    if (zone) zone.dataset.dragging = 'false';
    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      this.#status('That drop carried no file.');
      announce('That drop carried no file.', { assertive: true });
      return;
    }
    this.#status(`Loading ${file.name}…`);
    this.actions.loadFile(file);
  }
}

define('aw-import', AwImport);
