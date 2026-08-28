# How allyway is put together

A map of the codebase for anyone — human or agent — picking it up cold.
`README.md` is the product: what it does and what it promises. `CLAUDE.md` is
the rules for changing it. `DECISIONS.md` is the reasoning behind the parts
that look odd on purpose. This file is the structure.

---

## The shape of it

No build step. `index.html` links six stylesheets and loads `js/main.js` as a
module; the browser loads the ES modules as written. There are two vendored
runtime dependencies (`js-yaml` and `markdown-it`) and one server-side function
(`netlify/functions/fetch-schema.mjs`), used only when a direct fetch of a
schema is blocked by CORS.

```
index.html               the whole page: stylesheets, theme boot, <aw-app>
js/theme-boot.js         sets the theme before first paint, to avoid a flash
js/main.js               entry point: store, router, actions, shortcuts, boot
js/lib/                  pure modules — no DOM assumptions beyond dom.js
js/components/           the custom elements, one file per area of the screen
js/vendor/*.mjs          the two runtime dependencies: js-yaml, markdown-it
css/                     tokens → base → app → list → detail → overlays
assets/fonts/            IBM Plex Sans + Mono, self-hosted, latin subsets
samples/                 the bundled example schema
example-schema/          a large real-world schema for manual testing
netlify/functions/       the one piece of server-side code
scripts/serve.mjs        the dev server behind `npm start`
test/                    node:test suites for the pure modules
test/a11y/               the browser suites, one file per subject
```

Data flows one way: **store → components**. A component reads state, renders,
and calls an action; actions live in `js/main.js` and are the only thing that
writes to the store or the URL.

---

## State

`js/lib/store.js` is the whole state model — about a hundred lines, no
dependencies. `initialState()` is the authoritative shape:

| Key | What it holds |
|---|---|
| `schema` | the parsed model, or `null` |
| `schemaState` | `idle` \| `loading` \| `ready` \| `error` |
| `schemaError`, `importNote` | what the import screen reports |
| `browsing` | past the parse report and into the browser |
| `filters` | `query`, `tags`, `verbs`, `scopes`, `statusCodes`, `hideDeprecated`, `onlyDeprecated` |
| `selectedOperationId`, `selectedSchemaName` | what the detail pane shows |
| `activeRowId` | the roving cursor — deliberately not the selection |
| `baseUrl` | a base URL the reader supplied for a schema that declares none |
| `palette`, `authOpen`, `optionsOpen` | the overlays |
| `mobileView` | `list` \| `detail`, below the phone breakpoint |
| `theme`, `density`, `showHints` | display preferences |
| `railCollapsed`, `listCollapsed` | folded columns |

`store.set(patch)` merges and notifies; `store.patch(key, patch)` does the same
for a nested object. Nested objects are always **replaced, never mutated**, so
components can compare with `Object.is` and there is no diffing machinery.

Only the five display preferences are persisted, and only those: `PERSISTED_PREFS` in
`js/lib/persist.js` is the allowlist, and `Store` writes through it on every
change. Everything else remembered — the schema, the credential — is written
deliberately from `main.js`, never as a side effect of a state change.

---

## Components

Every element extends `AwElement` (`js/lib/element.js`), renders into the
**light DOM**, declares the state keys it cares about in `static observes`, and
is registered through `define()` + `defineAll()` so nothing upgrades before the
store exists.

```js
class AwThing extends AwElement {
  static observes = ['schema', 'filters'];
  render(state) { replace(this, [ /* built with el() */ ]); }
}
define('aw-thing', AwThing);
```

Override `update(state, prev)` when a full re-render would be wrong — which is
whenever the element holds focus. The pattern throughout: *structural* changes
re-render, everything else patches attributes in place.

| Element | Owns |
|---|---|
| `aw-app` | landmarks, skip links, live regions, the shell layout, the column flags |
| `aw-topbar` | wordmark, search, column toggles, Settings/Authorise; also `aw-search-block` (roomy) and `aw-meta-strip` |
| `aw-tag-rail` | the tag rail; also `aw-facets`, the filter row that replaces it |
| `aw-endpoint-list` | the rows, the roving tabindex, type-ahead; also `aw-verb-bar` and `aw-tag-chips` |
| `aw-detail` | an operation, a component schema, or the empty state — an operation's sections are a tab set in every layout |
| `aw-schema-tree` | a response body as nested `<details>` in nested `<ul>`s |
| `aw-code-block` | the curl/fetch/python snippet and its copy button |
| `aw-try-it` | the real request form and its result |
| `aw-palette` | ⌘K — a real combobox over operations, schemas and commands |
| `aw-auth-sheet` | the credential, where it is stored, and verification |
| `aw-options` | theme, density, hint bar, and the base URL once one is needed |
| `aw-import` | the load screen and the parse report |
| `aw-base-url` | the base URL field — on the parse report, in Settings, and in Try it until it is answered |

`aw-detail` hands its field tables and the whole component-schema view to
`detail-fields.js` — one set of rows drawn one way, for parameters, request
bodies and schemas alike.

---

## The pure modules

`js/lib/` holds everything that can be reasoned about — and tested — without a
browser. `npm test` covers these.

| Module | What it is |
|---|---|
| `openapi.js` | the parser. Swagger 2.0 → OpenAPI 3.1 into one model: operations, schemas, tags, servers, security schemes, and a parse report. Also `$ref` resolution, type description, field rows and payload children |
| `servers.js` | what counts as a usable server URL, and which base URL a request is built against |
| `enums.js` | the values a field allows, followed through `$ref` and `allOf` |
| `markdown.js` | descriptions rendered as CommonMark, or stripped to text where only text fits |
| `search.js` | filtering, scoring, grouping by tag, type-ahead indexing |
| `request.js` | builds a request from an operation and renders it as curl, fetch or python. `revealCredential` defaults to `false`, and the snippet path never sets it |
| `router.js` | hash routing: `#/op/<id>`, `#/schema/<name>`, `#/import`, with filters and `src` in the query; `foldQuerySchema` rewrites a `?url=` in the search into that `src` |
| `persist.js` | every rule about what is remembered and where, in one file |
| `loader.js` | file, URL and sample loading, plus the CORS fallback |
| `auth.js` | credential normalising, masking, JWT claims, probe interpretation |
| `store.js` | the store |
| `element.js` | `AwElement`, `define`, `defineAll` |
| `dom.js` | `el`, `replace`, `uid`, `focusable`, `preserveFocus` |
| `announce.js` | the two live regions and `announce()` |
| `dialog.js` | `<dialog>` plumbing: focus return, light dismiss |
| `context.js` | the one place components find the store, router and actions |

---

## Layout and CSS

Load order matters: `tokens` → `base` → `app` → `list` → `detail` →
`overlays`.

| File | Subject |
|---|---|
| `tokens.css` | colours, type, spacing, control heights, pane widths — every value in `rem` |
| `base.css` | resets, typography, buttons, chips, pills, focus rings, `visually-hidden` |
| `app.css` | the shell: top bar, meta strip, grid, tag rail, filter bars, folded columns |
| `list.css` | the endpoint list, the empty state, the hint and status bars |
| `detail.css` | the detail pane, tabs, tables, code block, try-it |
| `overlays.css` | palette, auth sheet, display panel, import screen |

Two densities, set by the `data-density` attribute on `.app` and mirrored on
`<html>`: `dense` is three panes with a tag rail, `roomy` is two panes with a
search-first header. Breakpoints, in `rem` so a text-size preference moves
them: **75rem** the rail folds into a chip row, **62rem** the panes narrow,
**48rem** the list and the detail become separate pages.

Folded columns are `data-rail` / `data-list` on the same element, written by
`aw-app` and ignored below 48rem. Both are disclosures driven from the top bar;
the folded column is removed from the grid rather than shrunk to a strip. A
folded rail hands the tags to the same chip row the 75rem breakpoint uses, so
there is one stand-in whichever reason the rail is not there.

---

## Routing and addresses

`js/lib/router.js` parses and builds the hash; `main.js` owns the round trip.
Every operation and schema has an address, filters ride in the query, and `src`
names the schema the rest of the URL is about — so a link opens the right
operation for someone who has never loaded that document.

A schema can also be named before the fragment, as `?url=` (or `?src=`) in the
real query string — the shape an inbound link usually takes. `foldQuerySchema`
rewrites it into the fragment at boot and `main.js` `replaceState`s the result
before `restoreSchema` or `router.start` look at the address, so exactly one
representation ever reaches the app. A `src` already in the fragment wins.

The fragment being the router is why skip links move focus themselves instead
of letting the browser navigate: `#detail` would be read as a route naming no
operation and would throw the selection and the filters away on the way past.

---

## Keyboard

Three models, all built, all checked in `test/a11y/keyboard.mjs` and
`columns.mjs`:

- **The palette** (`⌘K`) is a combobox: focus never leaves the input, the
  active option moves with `aria-activedescendant`.
- **The endpoint list** is one tab stop with a roving cursor: `↑ ↓ Home End
  PgUp PgDn`, `Enter` to open, a letter to jump. The cursor walks the rows *as
  rendered*, which is not the same order the filter returns once the roomy
  layout groups by tag.
- **Global shortcuts** live in `installShortcuts()` in `main.js`: `/`, `⇧⌘F`,
  `⇧⌘C`, `⇧⌘U`, `⇧⌘M`. Single-key shortcuts never fire while someone is
  typing.

The rule underneath all three: never destroy the element the keyboard is
standing on. Cursor moves, column folds and toggle state all patch attributes
in place.

---

## Tests

```sh
npm test          # node:test over js/lib/, no browser, no dependencies
npm run test:a11y # test/a11y/*.mjs in real Chromium (needs npm install)
```

The browser suites share `test/a11y/lib/harness.mjs`, which starts the dev
server and a browser and exports `open()` and `violations()`. One file per
subject: `axe` (the static sweep over every screen), `structure`, `keyboard`,
`columns`, `layout`, `presentation`, `announcements`, `credential`, `tryit`,
`payload`, `baseurl`, `markdown`.

`test/fixtures/local-echo.yaml` points at the dev server so a request can
actually be sent and read in a test. The other fixtures are the documents that
are awkward on purpose: `no-server.yaml` declares no `servers`, `ref-enum.yaml`
names its enum somewhere else, and `markdown-docs.yaml` writes descriptions in
markdown, raw HTML and all.

---

## Things that will bite

- **A re-render that holds focus.** Rebuilding a subtree the keyboard is in
  drops focus to the body. Check `update()` before adding a state key to
  `observes`.
- **Duplicated controls across layouts.** A control rendered always and hidden
  with CSS is a second tab stop for one job. The layouts that swap controls
  (`aw-tag-chips`, the column toggles) use a media query in JS instead.
- **`display: contents` in the endpoint list.** It quietly costs the list its
  list semantics; a browser test asserts it is nowhere in there.
- **The memoised filter.** `visibleOperations()` caches on the schema name and
  the filters. A new filter key must be inside the `filters` object or the
  cache will not see it.
- **Descriptions are someone else's file.** `markdown.js` runs with
  `html: false` and there is no sanitiser; never turn that on, and never put a
  document's string into `innerHTML` anywhere else.
- **`aw-try-it` observes `baseUrl`.** It patches the preview line in `update()`
  rather than re-rendering, because the field that sets the base URL is inside
  the panel and holds focus while it changes.
- **Storage that throws.** Private modes make `localStorage` throw on access,
  not just on write. Everything in `persist.js` is wrapped; keep it that way.
