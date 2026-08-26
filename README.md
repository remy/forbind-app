# allyway

An OpenAPI browser whose point is that it is accessible.

Load a schema — JSON or YAML, Swagger 2.0 through OpenAPI 3.1 — and browse,
filter and search it, read an operation in full, copy a `curl`/`fetch`/`python`
snippet, and send a real request. Parsing, filtering and snippet generation all
happen in the browser; nothing about your schema is uploaded.

```sh
npm start           # http://localhost:8080
npm test            # 124 unit tests, no dependencies, no browser
npm install
npm run test:a11y   # 50 checks in a real browser (needs Playwright + axe-core)
```

There is no build step. What is in this repository is what the browser loads.
The only runtime dependency is a vendored YAML parser; Playwright and axe-core
are development-only and nothing in `js/` imports them.

---

## What is here

```
index.html               the whole page
js/main.js               entry point: store, router, actions, shortcuts
js/lib/                  pure modules — parser, request builder, search, routing
js/components/           the custom elements
js/vendor/js-yaml.mjs    the one dependency, vendored (MIT)
css/                     tokens, base, app, list, detail, overlays
assets/fonts/            IBM Plex Sans + Mono, self-hosted, latin subsets (OFL)
samples/                 a worked example schema
netlify/functions/       the one piece of server-side code
test/                    node:test suites for the pure modules
test/a11y/               the browser suites, one file per subject
```

## Choices worth knowing about

**No framework, no build step, all web components.** The custom elements render
into the **light DOM**, not shadow roots. `aria-describedby`, `aria-controls`,
`aria-activedescendant` and `<label for>` all have to reach across what would
otherwise be shadow boundaries, and cross-root ARIA is still not something you
can rely on. Web components are custom elements and their lifecycle; shadow
encapsulation is a separate feature, and here it would cost more than it pays.

**Almost entirely client-side.** There is exactly one server function,
`/api/fetch-schema`, and it exists for one reason: a browser cannot read a
cross-origin response unless the other server sends CORS headers, and plenty of
published schemas do not. It is used *only* after a direct fetch has already
failed, only for the schema, and the UI says when it was used. Real API requests
from the try-it panel always go straight from your browser — no proxy — so a
credential never passes through anything of ours.

**What is remembered, and where.** Everything below is on your own machine —
there are no cookies, no telemetry, and nothing is sent anywhere.

| What | Where | Lifetime |
|---|---|---|
| Theme, density, hint bar, folded columns | `localStorage` | until changed |
| The loaded schema | `localStorage` | until you replace it |
| A credential | `sessionStorage` | this tab, and gone when it closes |
| …if you tick *Remember on this device* | `localStorage` | until you forget it |

A schema loaded from a URL is remembered as the URL and re-fetched; one loaded
from a file keeps its text (under 3 MB — above that only its name is kept, and
you are asked for it again). *Replace schema* forgets both the schema and any
credential held for it.

The credential defaults to `sessionStorage`, so it survives a reload but not the
tab. Remembering it is a labelled opt-in that says what it means, never a
default and never silent, and a credential is only ever handed back to the
schema it was entered against. Whichever store it is in, it never reaches a
snippet: copied commands carry `$TOKEN`. All of this is covered by tests that
fail if it stops being true. The rules live in one file, `js/lib/persist.js`.

**A copied snippet never carries your token.** `buildRequest` takes a
`revealCredential` flag that defaults to `false`, and the snippet path never
sets it. A test asserts this across every operation in the sample and all three
languages, including when the flag is omitted altogether.

## Accessibility

The point of the project, so it is worth being specific.

**Semantics.** Real landmarks with accessible names: `banner`, `navigation`
(tags and schemas), `main`, and a named region per pane. One `<h1>` naming the
tool and the loaded document. The endpoint list is a real list of real list
items — grouped results are a heading per group with that group's own named
list, rather than one list with headings wedged inside it, and nothing in it is
`display: contents`, which is the one thing that can quietly cost a list its
semantics. Parameters render as a real `<table>` with
`scope`ed headers where there is room, and as a real `<dl>` of stacked rows
where there is not — switched on a media query, because restyling a table to
`display: block` keeps the look and throws the semantics away.

**Never colour alone.** Selection is said three ways at once: a left bar, a
background tint, and `aria-current="true"`. Verb pills always carry the word
(`DEL` is shown but `DELETE` is announced). Required fields say `yes` and `no`,
not an asterisk. Parse notes are led by `WARN`, `INFO` or `FAIL` as text.
Deprecated rows carry "Deprecated" in their accessible name, because a
strikethrough is not announced.

**Keyboard.** Three models, all of them required, all of them built:

| | |
|---|---|
| `⌘K` / `Ctrl K` | Command palette — a real combobox: focus stays in the input, results are an owned listbox, the active option is tracked with `aria-activedescendant`, the count goes to a polite live region, `Esc` closes and restores focus to the invoker |
| `↑` `↓` `Home` `End` `PgUp` `PgDn` | Move the cursor in the endpoint list, which is a single tab stop (roving tabindex) |
| `Enter` | Open the row under the cursor |
| a letter | Jump to the next path starting with it |
| `/` | Focus the filter field |
| `⇧⌘F` | Focus the method filters |
| `⇧⌘C` | Copy the request snippet |
| `⇧⌘U` | Replace the schema |
| `⇧⌘M` | Maximise the detail, and restore the columns |
| `Tab` (from the top) | Skip links to every landmark |

Rows are anchors, so `Enter`, middle-click and open-in-new-tab work without
being reimplemented, and every operation has an address you can paste into a
ticket. Cursor moves patch attributes in place rather than re-rendering — a
rebuilt row drops focus to the body and the whole model dies on the spot. The
cursor walks the rows *as rendered*, which is not the same list as the filter
returns once the roomy layout groups them by tag; if those two ever disagree
the arrows stop matching the eye.

**Folding the columns away.** Either navigation column can be folded away to
give the detail the room: `Tags` and `List` in the top bar are disclosures, and
`aria-expanded` on each says whether the column it names is on screen. With
both folded the detail has the whole frame, which is all "maximise" means here
— `⇧⌘M` does the pair in one step, and again to bring them back.

Folding the rail hands the tags to the chip row that already stands in for it
in the narrower layouts, so filtering by tag never goes away with the column.

A folded column is removed rather than shrunk to a strip: a strip would carry a
second copy of the control that folded it, which is two tab stops for one
state. The toggles stay in the top bar instead, so what is missing always has a
way back, and so do the routes that need the column — the skip link unfolds it
on the way in, and a shortcut that moves into the list brings the list back
first rather than focusing a row nobody can see. Below the phone breakpoint
the preference is ignored and the toggles are not rendered: the list and the
detail are already separate pages there, and folding the list away would leave
nothing to navigate from.

The skip links move focus themselves rather than letting the browser navigate
to the fragment — the URL's fragment is the router here, so `#detail` would be
read as a route naming no operation and would throw away the selection and the
filters on the way past. The tags link resolves to whichever of the rail, the
chip row or the facet buttons the current layout is actually showing.

**Focus.** Every focusable element has a visible indicator and none of them are
removed: a `2px` accent outline offset clear of the element, or an inset ring
where an outer one would be clipped by a pane edge. Selection and focus are
independent and can co-occur, and both remain distinguishable in Windows High
Contrast Mode — where box-shadows are discarded, so the inset rings are
re-declared as outlines in system colours.

**Zoom and reflow.** Every size — type, spacing, control heights, pane widths
and the breakpoints themselves — is in `rem`, so a browser *text size* setting
scales the whole interface and not just the prose. Verified for no horizontal
page scroll at 320px, at 200% zoom and at 400% zoom. Three panes become two,
then one column with the detail as a pushed page.

Above the phone breakpoint the browser is a fixed frame: the banner stays put
and each pane scrolls inside its own bounds, so the endpoint list is a column
you can run down without the detail beside it moving. On a phone that is
dropped and the page scrolls normally, because the detail is a pushed page of
its own and a document that scrolls with the browser chrome beats a pane that
scrolls inside it.

**Live regions.** One polite region and one assertive one, both present from
first paint (a region created and filled in the same tick is routinely missed).
Filter counts, copy confirmations, verify results and request outcomes are
announced; repeats are nudged so an identical message is not swallowed. Filter
announcements are debounced so typing does not produce a stream of them.

**Preferences honoured.** `prefers-color-scheme` (theme defaults to Auto, with
Light and Dark in Display), `prefers-contrast: more`, `prefers-reduced-motion`
(transitions drop to 0ms), and `forced-colors`.

**Verified, not asserted.** `npm run test:a11y` drives a real browser and
checks all of the above: `axe-core` over eleven screens and states (import,
parse report, dense, roomy, dark, schema view, palette open, auth sheet,
display options, mobile detail, columns folded away) at WCAG 2.0/2.1/2.2 A and
AA plus best-practice, and
then the behaviours a static scan cannot see — the roving tabindex holding
focus through a dozen cursor moves, the combobox keeping focus in the input
while `aria-activedescendant` moves, focus returning to an invoker whose
toolbar re-rendered underneath it, meaning never carried by colour alone,
reflow at 320px and at 200% and 400% zoom, a visible ring under
`forced-colors`, the live regions actually carrying their announcements, and
the credential reaching neither storage nor the clipboard, and a folded column
keeping every route back to itself.

The one place the design was overridden for an accessibility reason is
documented in `DECISIONS.md`.

## Reading a response

A response is more than its status code, so each one opens up. Collapsed it is
the row the design draws — the code and its phrase — with a hint of what it
carries (`object · 9 fields`, `Booking[]`, `3 shapes`). Opened, it shows the
shape of the body as something you can walk through, and an example built from
the same schema.

The shape is **nested `<details>` inside nested `<ul>`s**, deliberately not
`role="tree"`. A tree widget would mean reimplementing roving tabindex,
`aria-expanded`, `aria-level`, `aria-setsize` and `aria-posinset` by hand, and
support for the pattern is uneven. A response body is not a tree *widget* — it
is a document with a shape. Native disclosures announce their own expanded
state, Tab and Enter and Space already work without a line of code, browsers
can reveal a collapsed section for find-in-page, and the nested lists carry the
depth so nothing has to describe it. `Expand all` and `Collapse all` are there
for scanning, and say what they did.

Levels are built the first time they open. Response schemas run to thirteen
levels in real documents and are allowed to contain themselves, so drawing the
whole shape up front is both enormous and, for a recursive schema, endless. A
branch that reopens a type already open above it says `repeats Booking` and
links to it rather than unrolling forever — and a list of that type counts as
that type, or `children: Node[]` would unroll where `parent: Node` did not.

A body that is a `oneOf` or `anyOf` has no fields of its own, so it lists its
shapes instead — named where the document names them, and told apart by the
fields they carry where it does not (`Option 1 · year, title, units`).

## Try it out

Try-it sends a real request from your browser to the host the schema declares.
There is no proxy, which is what keeps the credential local, and the cost is
that the API must send CORS headers for the response to be readable. When it
does not, the panel says which of the two possible causes it is and how to tell
them apart, rather than showing a generic failure. Mutating verbs carry a `LIVE`
warning first: it is not a sandbox.

The fields come from the schema: a parameter with an `enum` is a `<select>` of
exactly the values it allows (optional ones can stay *— not sent —*), and the
rest are text inputs carrying the schema's example as a placeholder. It is a
real `<form>`, so <kbd>Enter</kbd> in any field sends. A required parameter with
no value *and* no example to fall back on stops the send, names itself in a
polite word-led message tied to the field, and takes focus — rather than
sending `{bookingId}` to a real API.

## Deployment

Netlify, static. `netlify.toml` publishes the repository root, wires
`/api/fetch-schema` to the function, and sets a CSP that allows `connect-src *`
(try-it needs to reach arbitrary hosts) while locking scripts, styles and fonts
to this origin. There is no inline script or inline style anywhere in the app.

The schema relay is deliberately narrow: http(s) only, no embedded credentials,
public addresses only — including every written form of a private one, IPv4
mapped into IPv6 among them — redirects re-checked on every hop, an 8 MB cap
read as a stream, a 10-second timeout, and text out.

## Scale

The list is not virtualised. Every operation is a real element, which is what
keeps the roving tabindex, find-in-page, and open-in-new-tab honest — and it
holds up: GitHub's own 12.3 MB description (1,221 endpoints, 972 schemas, 47
tags) loads, parses and renders in about 0.7 seconds, and filtering it stays
under a frame. The sample the design was drawn against is 47 endpoints; the
ceiling is a long way above that.

## The example schema

`samples/bookings-api.v2.yaml` describes an imaginary restaurant bookings API.
It exists so the tool has something to browse on first run, and it matches the
design mocks exactly: 47 endpoints, 6 tags, 9 schemas, 3 deprecated, 4 without a
summary, one `http bearer` scheme. Open it from the import screen.
