/**
 * The shape of a payload, as something you can walk through.
 *
 * Built from nested `<details>` inside nested `<ul>`s, and deliberately not
 * from `role="tree"`. A tree widget would mean reimplementing roving tabindex,
 * `aria-expanded`, `aria-level`, `aria-setsize` and `aria-posinset` by hand,
 * and screen-reader support for the pattern is uneven. A response body is not
 * a tree *widget* — it is a document with a shape. Native disclosures announce
 * their own expanded state, Tab and Enter and Space already work, browsers can
 * reveal a collapsed section for find-in-page, and the nested lists carry the
 * depth so nothing has to describe it.
 *
 * Children are built the first time a branch opens. Response schemas run to
 * thirteen levels in the wild and are allowed to contain themselves, so
 * rendering the whole shape up front is both enormous and, for a recursive
 * schema, endless. A branch that reopens a `$ref` already open above it says
 * so and links to it instead of unrolling forever.
 */

import { AwElement, define } from '../lib/element.js';
import { el, replace, uid } from '../lib/dom.js';
import { announce } from '../lib/announce.js';
import { payloadChildren, hasChildren, refOf, payloadRef, refName } from '../lib/openapi.js';
import { markdownToText } from '../lib/markdown.js';

/** How deep to open automatically. One level shows the shape without a wall. */
const OPEN_TO_DEPTH = 1;

/**
 * How a branch builds its children, kept beside the branch rather than on it.
 *
 * `toggle` fires after the fact, so "expand all" cannot open a branch and then
 * find its children in the same pass — the next level would not exist yet.
 * Holding the builder here lets that walk fill each branch as it opens.
 *
 * @type {WeakMap<HTMLDetailsElement, () => void>}
 */
const builders = new WeakMap();

class AwSchemaTree extends AwElement {
  static observes = ['schema'];

  /** @type {unknown} the schema node to describe — set by the parent */
  node = null;
  /** @type {string} what to call the payload in announcements */
  label = 'payload';

  /** Point the tree at a payload and draw it. Used to defer the work. */
  describe(node, label) {
    this.node = node;
    if (label) this.label = label;
    if (this.isConnected) this.render(this.state);
  }

  render(state) {
    if (!state.schema || this.node === null || this.node === undefined) {
      replace(this, []);
      return;
    }
    const doc = state.schema.doc;
    const children = payloadChildren(doc, this.node);

    if (!children) {
      replace(this, [
        el('p', { class: 'result__note', text: this.#describeLeaf() }),
      ]);
      return;
    }

    replace(this, [
      children.kind === 'variants'
        ? el('p', {
            class: 'result__note',
            text: `This body is one of ${children.items.length} shapes. Open one to see what it carries.`,
          })
        : null,
      el('div', { class: 'tree-toolbar' }, [
        el('button', {
          type: 'button',
          class: 'link-quiet',
          text: 'Expand all',
          onclick: () => this.#setAll(true),
        }),
        el('button', {
          type: 'button',
          class: 'link-quiet',
          text: 'Collapse all',
          onclick: () => this.#setAll(false),
        }),
      ]),
      this.#renderLevel(doc, children, { depth: 0, seen: new Set([refOf(this.node)].filter(Boolean)) }),
    ]);
  }

  /** A payload that is not an object still deserves a sentence. */
  #describeLeaf() {
    const name = refName(refOf(this.node) ?? '');
    if (name) return `This response returns ${name}, which declares no named fields.`;
    return 'This response body declares no named fields.';
  }

  /**
   * @param {object} doc
   * @param {{kind: string, items: Array}} children
   * @param {{depth: number, seen: Set<string>}} context
   */
  #renderLevel(doc, children, context) {
    return el(
      'ul',
      { class: `schema-tree${children.kind === 'variants' ? ' schema-tree--variants' : ''}` },
      children.items.map((row) => el('li', {}, [this.#renderRow(doc, row, context)])),
    );
  }

  #renderRow(doc, row, context) {
    // Looked through an array, so a list of a type counts as that type.
    const ref = payloadRef(doc, row.schema);
    const alreadyOpen = ref !== null && context.seen.has(ref);
    const expandable = !alreadyOpen && hasChildren(doc, row.schema, context.seen);

    if (!expandable) {
      return el('div', { class: 'field-node' }, [
        this.#fieldLine(doc, row, { cyclic: alreadyOpen, ref }),
      ]);
    }

    const bodyId = uid('branch');
    const details = el('details', {
      class: 'field-branch',
      open: context.depth < OPEN_TO_DEPTH ? true : null,
    }, [
      el('summary', {}, [this.#fieldLine(doc, row, { branch: true })]),
      el('div', { class: 'field-branch__body', id: bodyId }),
    ]);

    const fill = () => {
      const body = details.querySelector(`#${CSS.escape(bodyId)}`);
      if (!body || body.dataset.filled === 'true') return;
      body.dataset.filled = 'true';
      const seen = new Set(context.seen);
      if (ref) seen.add(ref);
      const children = payloadChildren(doc, row.schema);
      if (!children) return;
      replace(body, [
        // The link to the named schema lives here rather than in the summary:
        // a <summary> is a button, and a link inside one is a focusable thing
        // inside a focusable thing, which is a trap for anyone tabbing.
        ref
          ? el('p', { class: 'field-branch__source' }, [
              el('span', { text: 'Defined by ' }),
              el('a', {
                href: this.actions.hashFor({ view: 'schema', id: refName(ref) }),
                text: refName(ref),
              }),
            ])
          : null,
        this.#renderLevel(doc, children, { depth: context.depth + 1, seen }),
      ]);
    };

    // Built on first open, and on the way in if it starts open.
    builders.set(details, fill);
    details.addEventListener('toggle', () => {
      if (details.open) fill();
    });
    if (details.open) fill();

    return details;
  }

  /**
   * One field: its name, its type, whether it has to be there, and whatever
   * else the schema says about it. The same information a reader gets from the
   * parameter table, in the same order, so the two read alike.
   */
  #fieldLine(doc, row, { branch = false, cyclic = false, ref = null } = {}) {
    const parts = [
      el('span', { class: 'field-node__name', text: row.name }),
      el('span', { class: 'field-node__type' }, [this.#typeCell(row.type, branch)]),
      // A variant is one of the shapes the body can take, so "required" has
      // nothing to say about it.
      row.variant
        ? null
        : el('span', {
            class: row.required ? 'field-node__req req-yes' : 'field-node__req req-no',
            text: row.required ? 'required' : 'optional',
          }),
    ].filter(Boolean);

    if (row.values) {
      parts.push(el('span', {
        class: 'field-node__note',
        text: `one of: ${row.values.join(', ')}`,
      }));
    } else if (row.notes) {
      parts.push(el('span', { class: 'field-node__note', text: row.notes }));
    }

    if (row.description) {
      // One line inside a disclosure summary, so the description is stripped
      // back to its words: a link cannot live inside a summary, and asterisks
      // shown raw are worse than emphasis quietly lost.
      parts.push(el('span', { class: 'field-node__desc', text: markdownToText(row.description) }));
    }
    if (row.deprecated) {
      parts.push(el('span', { class: 'field-node__note', text: 'deprecated' }));
    }
    if (cyclic && ref) {
      // Saying "shown above" is the honest end of a recursive branch — better
      // than a control that opens the same thing forever.
      parts.push(el('span', { class: 'field-node__note' }, [
        el('span', { text: 'repeats ' }),
        el('a', {
          href: this.actions.hashFor({ view: 'schema', id: refName(ref) }),
          text: refName(ref),
        }),
      ]));
    }

    return el('span', { class: `field-node__line${branch ? ' field-node__line--branch' : ''}` }, parts);
  }

  /**
   * The type, linked to the schema it names — except inside a branch summary,
   * where a link would nest one focusable control inside another. Those get
   * the link in the branch body instead.
   */
  #typeCell(type, plain = false) {
    if (!type.ref || plain) return el('span', { text: type.label });
    return el('a', {
      href: this.actions.hashFor({ view: 'schema', id: type.ref }),
      text: type.label,
    });
  }

  /**
   * Open or close everything.
   *
   * Opening a branch reveals branches that were never built, which contain
   * more of the same, so this walks until a pass finds nothing left to open.
   * The bound is there because a schema is allowed to contain itself; the
   * `seen` set stops a cycle unrolling, and this stops anything it misses.
   */
  #setAll(open) {
    if (!open) {
      for (const node of this.querySelectorAll('details.field-branch')) node.open = false;
      announce(`${this.label} collapsed.`);
      return;
    }

    let opened = 0;
    for (let pass = 0; pass < 20; pass += 1) {
      const closed = [...this.querySelectorAll('details.field-branch:not([open])')];
      if (!closed.length) break;
      for (const node of closed) {
        node.open = true;
        // Build now rather than waiting for `toggle`, so the next pass can see
        // the level this one just revealed.
        builders.get(node)?.();
        opened += 1;
      }
    }
    const total = this.querySelectorAll('details.field-branch').length;
    announce(`${this.label} expanded: ${total} ${total === 1 ? 'branch' : 'branches'}, ${opened} newly opened.`);
  }
}

define('aw-schema-tree', AwSchemaTree);
