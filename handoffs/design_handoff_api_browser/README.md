# Handoff: allyway — accessible API browser

## Overview

allyway is an API browser and testing tool whose core value is accessibility. A user uploads an
OpenAPI schema (JSON or YAML, 2.0–3.1); the tool parses it in the browser and generates a browsable,
filterable set of endpoints. From there the user can inspect an operation (parameters, request body,
responses), copy a generated `curl` snippet, and — not yet designed — send a real request.

This bundle covers five screens across two competing navigation models. Accessibility is
**invisible-but-correct**: there is no a11y panel, no badges, no annotation layer in the product.
It shows up as real semantics, visible focus, non-colour-only meaning, and keyboard parity.

## About the design files

`mocks/API Browser.dc.html` is a **design reference written in HTML**. It is a prototype showing
intended look, structure and behaviour — *not* production code to copy. The job is to **recreate
these designs in allyway's own environment** using its established framework, component library and
patterns. The `allyway` folder was empty at the time of handoff, so if no environment exists yet,
pick the framework appropriate for the project (a React + TypeScript SPA is the natural fit for a
client-side schema parser) and implement there.

The file is a streaming "Design Component" — a single HTML file with inline styles and a small
sibling runtime (`mocks/support.js`). Open it directly in a browser. Do not port its structure; port
what it depicts. It renders as a **design canvas**: an assumptions strip at the top, then one
section of labelled options (`1a`, `1b`, `1d`, `1e`, `1f`). Option `1c` (a command-palette-only
reading view) was explored and **rejected** — too much orientation was lost for sighted users. Do
not resurrect it; the id is retired.

## Fidelity

**High fidelity.** Colours, type, spacing, borders and copy are final and should be matched exactly.
Two caveats: (1) the mock has no hover/pressed rendering — those states are specified in prose below
and must be built; (2) the mocks are static — no real interaction is wired up.

---

## Screens / views

### 1a — Three-pane, dense table (recommended default)

**Purpose:** the working view for someone who lives in the schema. Maximum endpoints visible.

**Layout:** app frame `1280 × 800`, `1.5px solid #0F0F0E` border, no radius, no shadow.
Vertical stack of three rows: top bar (`52px`), schema meta strip (`34px`), then a body
`grid-template-columns: 216px 402px 1fr` with `1.5px` vertical rules between panes.

**Top bar** — `display:flex; align-items:center; gap:14px; padding:0 16px;`
`border-bottom:1.5px solid #0F0F0E`.
- Wordmark `ALLYWAY`: IBM Plex Mono 600 13px, `letter-spacing:.14em`.
- `1px × 20px` divider `#C9C8C2`.
- Search field: `flex:1; max-width:380px; height:32px; padding:0 10px;` `1px solid #0F0F0E`,
  background `#FFF`. Placeholder “Search endpoints, params, schemas”, Plex Sans 400 12.5px `#56564F`.
  Right-aligned kbd hint `⌘K`: Plex Mono 500 10.5px, `padding:3px 5px`, `1px solid #C9C8C2`, `#56564F`.
- Right cluster (`margin-left:auto; gap:10px`): version select `v2.1 ▾` (`height:30px; padding:0 10px;`
  `1px solid #0F0F0E`, Plex Mono 500 11.5px); `Authorise` button (`height:30px; padding:0 13px`,
  fill `#0F0F0E`, text `#FBFBF9`, Plex Sans 600 11.5px).

**Schema meta strip** — `height:34px; padding:0 16px;` background `#F3F2ED`,
`border-bottom:1px solid #D8D7D1`. Plex Mono 400 11.5px `#56564F`, `·`-separated:
filename (in `#0F0F0E`, weight 500) · `OpenAPI 3.1` · `47 endpoints` · `9 schemas`.
Right: `Replace schema`, `#1A3FB8`, underlined.

**Left pane (216px)** — `padding:14px 0`.
- Section label `Tags`: Plex Mono 600 10px, `letter-spacing:.1em`, uppercase, `#56564F`, `padding:0 14px 9px`.
- Tag rows: `padding:7px 14px`, `justify-content:space-between`, Plex Sans 400 12.5px, count in
  Plex Mono 11px `#56564F`. Selected row: fill `#0F0F0E`, text `#FBFBF9`, weight 600, count inherits.
  Content: Bookings 12 (selected), Venues 9, Availability 5, Payments 8, Customers 7, Webhooks 6.
- Divider `1px solid #D8D7D1`, then `Schemas` label and rows in Plex Mono 400 12px, `padding:6px 14px`:
  Booking, BookingLine, Venue, AvailabilitySlot, Error.

**Middle pane (402px)** — `grid-template-rows: auto 1fr auto`.
- Verb filter bar: `padding:10px 12px`, `border-bottom:1px solid #D8D7D1`, wrapping `gap:6px` chips,
  Plex Mono 600 10.5px, `padding:4px 8px`. Active chip (`ALL 47`) fills `#0F0F0E`/`#FBFBF9`; inactive
  `1px solid #A9A8A2`; `DEPRECATED 3` uses `1px dashed #A9A8A2` and `#56564F`.
  Chips: ALL 47, GET 21, POST 12, PATCH 8, DELETE 6, DEPRECATED 3.
- Endpoint rows: `grid-template-columns:64px 1fr; gap:10px; padding:9px 12px;`
  `border-bottom:1px solid #E6E5DF`. Verb pill: Plex Mono 600 10px, centred, `padding:3px 5px`.
  Path: Plex Mono 500 12.5px. Summary: Plex Sans 400 11.5px `#3F3F38`.
  - **Selected** row: `border-left:3px solid #0F0F0E`, background `#E9ECF7`.
  - **Focused** row: `box-shadow: inset 0 0 0 2px #1A3FB8` (inset so the ring is never clipped by the
    pane edge). Selection and focus are independent and can co-occur.
  - **Deprecated** row: `opacity:.62`, path `line-through`, verb pill goes neutral
    (`#F2F1EC` / `1px solid #6D6C66` / text `#3F3F38`).
- Keyboard hint bar: `height:30px; padding:0 12px;` background `#F3F2ED`,
  `border-top:1px solid #D8D7D1`, Plex Mono 400 10.5px `#56564F`, `gap:14px`:
  `↑↓ move` `↵ open` `/ filter` `⇧⌘F verbs`, right-aligned `2 of 47`.

**Right pane (detail)** — header block `padding:16px 20px 14px`, `border-bottom:1px solid #D8D7D1`:
verb pill (Plex Mono 600 11px, `padding:4px 7px`), path Plex Mono 500 16px, right-aligned `Try it`
button (`height:28px; padding:0 12px`, fill `#0F0F0E`). Description Plex Sans 400 12.5px/1.6
`#3F3F38`, `max-width:56ch`. Metadata chips (Plex Mono 500 10.5px, `1px solid #A9A8A2`,
`padding:4px 7px`): `requires bearer`, `scope: bookings.write`, `rate 60/min`.

Body `padding:16px 20px`:
- Section heading pattern (used throughout): Plex Mono 600 10px, `letter-spacing:.1em`, uppercase, `#56564F`.
- Params table: `1px solid #D8D7D1`; header row background `#F3F2ED`, Plex Mono 600 9.5px uppercase
  `#56564F`; columns `1.3fr .8fr .6fr 1.6fr`, `gap:8px`, rows `padding:7px 10px`,
  `border-bottom:1px solid #ECEAE4`. Field/type in Plex Mono 11.5px, `Req` = `yes` (weight 600) or
  `no` (`#56564F`) — a word, never a colour or asterisk. A type that names a schema links to it
  (`jump to schema`, `#1A3FB8`, underlined).
- Code block: language tabs (Plex Mono 500 10.5px; active fills `#0F0F0E`, inactive `1px solid #A9A8A2`
  `#56564F`) — `curl` / `fetch` / `python`, only `curl` implemented. `Copy` button `height:24px`,
  `1px solid #0F0F0E`. `<pre>`: background `#0F0F0E`, text `#F2F1EC`, Plex Mono 400 11.5px/1.75,
  `padding:12px 14px`, `white-space:pre-wrap; word-break:break-all`.
- Response chips: `padding:5px 8px`, Plex Mono 500 11px, tinted per class (see tokens) — each carries
  its status code and a phrase.

### 1b — Two-pane, roomy grouped rows (search-first)

**Purpose:** the alternative IA. No tag rail; a large search field owns the top of the page and holds
focus on load. Better for occasional users and writers; costs vertical density.

**Layout:** `1280 × 800`. Header block `padding:18px 22px 16px`, `border-bottom:1.5px solid #0F0F0E`,
then `grid-template-columns: 520px 1fr`.

- Header row: wordmark, then `bookings-api.v2.yaml · 47 endpoints` (Plex Mono 400 11.5px `#56564F`),
  right `Authorise` as an outline button (`1px solid #0F0F0E`).
- Search field: `height:46px`, `1.5px solid #0F0F0E`, background `#FFF`, with
  `box-shadow: inset 0 0 0 2px #1A3FB8` in the focused state shown. Query text Plex Mono 400 15px,
  followed by a `1.5px × 19px` caret block. Right: `14 matches · ↑↓ to move`, Plex Mono 11.5px `#56564F`.
- Filter chips row (`gap:7px`, `padding:5px 9px`, Plex Mono 600 10.5px): an applied filter is a filled
  token with a `✕` (`Tag: Bookings ✕`); available facets are outline `+ verb`, `+ auth scope`,
  `+ status code`; right-aligned dashed `Hide deprecated`.
- List pane (520px): group headers — active group is a full-bleed `#0F0F0E` bar with `#FBFBF9`
  Plex Mono 600 10px uppercase text, `padding:9px 18px`; subsequent groups are `#F3F2ED` with
  `#56564F` text and `1px solid #D8D7D1` top and bottom.
  Rows: `padding:15px 18px`, `border-bottom:1px solid #E6E5DF`. Verb pill + path (Plex Mono 500 14px),
  summary Plex Sans 400 12.5px/1.55 `#3F3F38`, then a metadata chip row (Plex Mono 500 10px,
  `1px solid #A9A8A2`, `padding:3px 6px`) carrying scope, param count, response count, paging model.
  Selected row: `border-left:4px solid #1A3FB8`, background `#E9ECF7`.
- Detail pane: verb pill + path (Plex Mono 500 19px); tab bar on `border-bottom:1.5px solid #0F0F0E`
  with the active tab filled `#0F0F0E`/`#FBFBF9`, `padding:9px 14px` — Overview / Body / Responses /
  Code / Try it. Prose Plex Sans 400 13.5px/1.7, `max-width:62ch`, `text-wrap:pretty`.
  A 2×2 fact grid (`1px solid #D8D7D1`, internal hairlines, `padding:13px 15px`): Auth, Rate limit,
  Idempotent, Since — label in Plex Mono 600 9.5px uppercase `#56564F`, value Plex Mono 400 12.5px.
  Then the curl block, with the copy button in its confirmed state (`Copied ✓`, filled).

### 1d — Import a schema (two states, side by side)

Both cards `620 × 470`, `padding` per below.

**Empty state.** Centred column, `max-width:440px`.
- `h2` “Load an OpenAPI schema”: Plex Sans 600 26px/1.2, `letter-spacing:-.01em`.
- Sub: Plex Sans 400 13.5px/1.65 `#3F3F38` — “JSON or YAML, 2.0 through 3.1. Nothing leaves your
  browser unless you send a request.”
- Drop zone: `1.5px dashed #0F0F0E`, background `#F3F2ED`, `padding:26px 20px`, centred.
  “Drop a file here” (Plex Sans 500 13px), then the **primary** `Choose file…` button
  (`height:34px; padding:0 15px`, fill `#0F0F0E`) shown in its focus state with a ringed halo:
  `box-shadow: 0 0 0 2px #FBFBF9, 0 0 0 4px #1A3FB8`. Then “or paste a URL below”, Plex Mono 11.5px `#56564F`.
- URL row: `1px solid #0F0F0E`, input area `padding:10px 12px` Plex Mono 12.5px `#56564F`,
  `Fetch` segment divided by `1px solid #0F0F0E`.

**Parsed state.** Filename as `h2` in Plex Mono 600 19px, plus a `Parsed OK` chip
(`#DFF0E6` / `1px solid #14603A` / text `#14603A`, Plex Mono 500 10.5px).
- Stat grid: 4 equal columns, outer `1px solid #0F0F0E`, internal `1px solid #D8D7D1`,
  `padding:14px`. Value Plex Mono 600 22px, label Plex Mono 400 10.5px `#56564F`:
  47 endpoints / 6 tags / 9 schemas / 3 deprecated.
- “3 things worth knowing” list, `1px solid #D8D7D1`, rows `padding:11px 13px`,
  `border-bottom:1px solid #ECEAE4`, Plex Sans 400 12px/1.5. Each row is led by a **word**
  (`WARN` `#6B4300`, `INFO` `#14603A`) in Plex Mono 600 10px — never an icon or colour alone.
  Copy: 4 operations have no `summary`; `Customer.email` has no format; one security scheme found
  (`http bearer`) so auth setup asks for a token only.
- Actions: primary `Browse 47 endpoints` (fill), secondary `Set up auth first` (`1px solid #0F0F0E`),
  both `height:36px; padding:0 16px`, Plex Sans 600 12.5px.

### 1e — Auth setup (sheet)

`width:600px`, height sizes to content, `padding:26px 28px`.

**The auth UI is derived from the schema.** Only the security schemes the uploaded document declares
are offered. In this mock the schema declares one, so there is **no scheme picker at all** — a
read-only provenance block states what was found, and the form asks for exactly that credential.
Build it this way: 1 scheme → no picker; 2+ → a picker listing only the declared schemes, labelled
with their scheme name and type.

- `h2` “Authorise requests” Plex Sans 600 20px; right-aligned `esc` hint Plex Mono 400 12px `#56564F`.
- Privacy line: Plex Sans 400 12.5px/1.6 `#3F3F38` — “Credentials stay in this browser tab and are
  never written to the schema or the clipboard snippet.” This must be literally true in the build:
  no persistence beyond the tab, and generated snippets carry `$TOKEN`, never the real value.
- Provenance block: `1px solid #D8D7D1`, background `#F3F2ED`, `padding:11px 13px`. Label
  “DECLARED IN BOOKINGS-API.V2.YAML” (Plex Mono 600 9.5px uppercase `#56564F`); value
  `http bearer` Plex Mono 500 13px with the qualifier “— JWT, header `Authorization`” in 400 `#3F3F38`.
- Field: visible persistent `<label>` “Bearer token” (Plex Sans 600 11px). Input `1.5px solid #0F0F0E`
  with `inset 0 0 0 2px #1A3FB8` focus ring; masked value Plex Mono 400 12.5px; a `Show` toggle
  divided by `1px solid #D8D7D1`, Plex Sans 500 11px underlined. Help text below, tied to the input
  via `aria-describedby`: “Paste a token or an `Authorization` header — we'll strip the prefix for you.”
- Verify result: `1px solid #14603A`, background `#DFF0E6`, `padding:11px 13px`; `VERIFIED`
  Plex Mono 600 10px + “Token valid · 6 scopes · expires in 51 min”, Plex Sans 400 12px, both `#14603A`.
  Announce this politely when it changes.
- Actions: `Save for this session` (fill), `Test again` (outline), `height:36px`.

Environment / base-URL switching was explicitly **descoped** — do not build it.

### 1f — Small screen (two views, 390px wide)

**List view** `390 × 720`, rows `auto auto 1fr auto`.
- Top bar `height:44px`, wordmark (Plex Mono 600 12px) + `Auth` button (`padding:8px 10px`,
  `1px solid #0F0F0E`).
- Search `height:44px`, `1.5px solid #0F0F0E`, Plex Sans 400 13px `#56564F`. Tag chips below,
  `padding:8px 11px`, Plex Mono 600 11px — active filled, others `1px solid #A9A8A2`.
- Rows `padding:14px`: verb pill + path (Plex Mono 500 13px), summary Plex Sans 400 12px/1.5
  `#3F3F38`. Selected row `border-left:4px solid #1A3FB8`, background `#E9ECF7`.
- Bottom status `height:46px`, `border-top:1.5px solid #0F0F0E`, background `#F3F2ED`,
  Plex Mono 400 11px `#56564F` — “Bookings · 12 of 47 shown”.

**Detail view** `390 × 720`. Back affordance `‹ Bookings` (Plex Sans 600 12px) + `Copy curl`.
Verb pill, then path Plex Mono 500 17px with `word-break:break-all`. Three-up segmented control
(Body / Responses / curl), `1px solid #0F0F0E`, active segment filled.
**Params become stacked definition rows, not a table** — `1px solid #D8D7D1`, rows `padding:11px 12px`:
name in Plex Mono 500 12.5px, then a single `·`-separated meta line in Plex Sans 400 11.5px `#3F3F38`
(“string · required · ULID”). No horizontal scrolling at 320px or at 200% zoom.
Sticky footer action `height:48px`, full width, fill `#0F0F0E` — “Try this request”.

---

## Interactions & behaviour

**Navigation**
- Selecting a tag filters the endpoint list and updates the count line; it does not change the detail pane.
- Selecting an endpoint row replaces the detail pane (desktop) or pushes a full page (mobile).
- Deprecated endpoints are listed but de-emphasised; `Hide deprecated` removes them from the result set.
- Deep-link every operation (`#/bookings/post-v2-bookings` or similar). Browser back must work.

**Keyboard model** (the agreed three, all required)
1. **⌘K command palette** — reaches endpoints, schemas and actions (`⇧⌘C` copy curl, `⇧⌘U` replace
   schema). Implement as a combobox: focus stays in the text input, results are an owned listbox, the
   active option is tracked with `aria-activedescendant`, the result count is a polite live region,
   `Esc` closes and restores focus to the invoker. Note: a palette-*only* IA was rejected — the
   palette accelerates the visible IA, it does not replace it.
2. **Roving tabindex list** — the endpoint list is one tab stop. `↑↓` move the active row
   (`tabindex=0` on the active row, `-1` on the rest), `Home`/`End` jump, `Enter` opens,
   `/` focuses the filter. Typing a letter jumps to the next matching path.
3. **Landmark jumping** — visually-hidden skip links to each region, visible on focus only.
   Real landmarks: `banner`, `navigation` (tags), `main` (list + detail), with accessible names.

**Focus and state**
- Every focusable element has a visible indicator: `2px #1A3FB8`, `inset` where an outer ring would be
  clipped by a pane edge, otherwise `outline` with `2px` offset against `#FBFBF9`. Never remove it.
- Selection is conveyed three ways at once — left bar, background tint, and `aria-current="true"`.
  Never colour alone. The same rule governs verbs (the word is always present) and parse warnings
  (led by `WARN` / `INFO` as text).
- Hover (not in the mock, build it): list rows `background:#F3F2ED`; outline buttons
  `background:#F3F2ED`; filled buttons `background:#26261F`; links keep the underline and darken to
  `#0F2775`. Transitions ≤120ms, and honour `prefers-reduced-motion` by dropping them.
- Active/pressed: filled buttons `background:#000`; no transform, no shadow.
- `Copy` → button label becomes `Copied ✓` for ~2s and a polite live region announces
  “curl command copied, 5 lines”. Never rely on the label change alone.

**Import flow**
- Drop zone is a real `<input type="file">` with a visible `<label>`; drag-and-drop is an enhancement,
  never the only route. Announce the dragover state in text.
- Parse errors (not drawn): keep the same “things worth knowing” list, add a `FAIL` word-led row with
  the YAML line/column and a `Show line` action. Never a modal alert.
- Warnings are informational — a schema with loose docs must still be fully browsable.

**Responsive**
- Three-pane → two-pane (list + detail, tags collapse into a filter chip row) → single column list
  with detail as a pushed page. Breakpoints are content-driven; the panes collapse when the detail
  pane would drop below ~480px.
- Must reflow without horizontal scroll at 320px and at 200% zoom (WCAG 2.2 AA, 1.4.10).

**Not yet designed** — ask before inventing: try-it-out request builder, live response viewer,
response history, schema diffing, non-curl snippet languages (`fetch` and `python` tabs are drawn
but inert).

## State

- `schema` — parsed document, its source name, version, and the parse report (counts + warnings).
- `filters` — `{ query, tags[], verbs[], hideDeprecated, scopes[], statusCodes[] }`.
- `selectedOperationId` — drives the detail pane; mirrored into the URL.
- `activeRowId` — roving-tabindex cursor; distinct from selection.
- `paletteOpen`, `paletteQuery`, `paletteActiveId`.
- `auth` — `{ schemeId, credential, verifyState: idle|checking|valid|invalid, scopes[], expiresAt }`.
  Session-scoped memory only: no `localStorage`, no cookies, no telemetry.
- `announcement` — the string pushed to the polite live region (copy, verify, filter counts).

Everything is client-side. Parsing, filtering and snippet generation need no backend; the only network
calls are the optional schema fetch-by-URL and, later, try-it-out requests.

## Design tokens

**Colour**
| Token | Value | Use |
|---|---|---|
| ink | `#0F0F0E` | text, borders, filled buttons |
| paper | `#FBFBF9` | app background |
| paper-alt | `#F3F2ED` | strips, status bars, inset panels |
| canvas | `#EFEEE9` | the design canvas behind the mocks only |
| ink-70 | `#3F3F38` | secondary prose |
| ink-55 | `#56564F` | labels, meta |
| rule-strong | `#0F0F0E` @ 1.5px | frame and pane divisions |
| rule | `#D8D7D1` | section divisions |
| rule-soft | `#E6E5DF` / `#ECEAE4` | row divisions |
| border-quiet | `#A9A8A2` | inactive chips |
| accent | `#1A3FB8` | focus, selection, links |
| accent-tint | `#E9ECF7` | selected row background |
| verb-get | text/border `#0B4F9C`, fill `#DBE4F3` | |
| verb-post + success | text/border `#14603A`, fill `#DFF0E6` | also 2xx, INFO, VERIFIED |
| verb-patch + warn | text/border `#6B4300`, fill `#F7ECD6` | also 4xx-soft, WARN |
| verb-delete + error | text/border `#97161C`, fill `#FAE4E3` | also 422/5xx |
| neutral-pill | text `#3F3F38`, border `#6D6C66`, fill `#F2F1EC` | deprecated |
| code-bg / code-fg | `#0F0F0E` / `#F2F1EC` | snippet blocks |

All text/background pairs above meet WCAG AA at their used size; the verb and status pills are
dark-text-on-tint for that reason. Keep them if you re-theme.

**Type** — IBM Plex Sans (400/500/600) for prose and UI; IBM Plex Mono (400/500/600) for anything the
API literally says: paths, verbs, field names, types, counts, filenames, keyboard hints, and all
small uppercase labels (`letter-spacing:.08–.1em`). Scale in use: 26 / 24 / 22 / 20 / 19 / 17 / 16 /
15 / 14 / 13.5 / 13 / 12.5 / 12 / 11.5 / 11 / 10.5 / 10 / 9.5px. Body line-height 1.55–1.75;
snippet 1.75–1.8.

**Spacing** — 3 / 4 / 5 / 6 / 7 / 8 / 9 / 10 / 12 / 14 / 16 / 18 / 20 / 22 / 24 / 26 / 28 / 32px.
Row padding `9px 12px` (dense) or `15px 18px` (roomy). Control heights 24 / 26 / 28 / 30 / 32 / 34 /
36 / 44 / 46 / 48px — never below 44px on touch.

**Radius: 0 everywhere. Shadows: none** — the only `box-shadow` in the system is a focus ring.
Depth is expressed with hairlines and fills.

## Assets

None. No icons, no images, no logos — every affordance is a word or a rule. The `▾`, `✕`, `‹`, `↑↓`,
`↵`, `⇥`, `⌘`, `✓` marks are text characters. If allyway has a wordmark, swap it for the `ALLYWAY`
text lockup and keep the mono/letter-spaced treatment or replace it wholesale.

Fonts: IBM Plex Sans + IBM Plex Mono (Google Fonts / `@ibm/plex`, OFL). Self-host in production.

## Files

- `mocks/API Browser.dc.html` — all five options on one canvas. Open in a browser.
- `mocks/support.js` — runtime the mock file needs to render. Not part of the design.

Option ids as the design team refers to them: `1a` three-pane dense, `1b` two-pane roomy,
`1d` import, `1e` auth, `1f` small screen. `1c` is retired (rejected).

## Open questions for the developer to raise back

1. Which IA ships — `1a` or `1b`? They can coexist as a density preference, but the tag rail is a real
   structural difference; picking one first is cheaper.
2. Is try-it-out in scope for v1? It changes the auth story from “verify a token” to “proxy real
   requests”, including CORS.
3. Which snippet languages after curl, and is snippet generation templated per language or driven off
   a shared request model?
