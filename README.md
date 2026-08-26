# allyway

An OpenAPI browser whose point is that it is accessible.

Load a schema — JSON or YAML, Swagger 2.0 through OpenAPI 3.1 — and browse,
filter and search it, read an operation in full, copy a `curl`/`fetch`/`python`
snippet, and send a real request. Parsing, filtering and snippet generation all
happen in the browser; nothing about your schema is uploaded.

```sh
npm start           # http://localhost:8080
npm test            # 98 unit tests, no dependencies, no browser
npm install
npm run test:a11y   # 27 checks in a real browser (needs Playwright + axe-core)
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
css/                     tokens, base, app, detail, overlays
assets/fonts/            IBM Plex Sans + Mono, self-hosted, latin subsets (OFL)
samples/                 a worked example schema
netlify/functions/       the one piece of server-side code
test/                    node:test suites for the pure modules
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

**Nothing is persisted except two display preferences.** Theme and density go to
`localStorage`, because someone who needs a dark, high-contrast, roomy interface
should not have to set it again every visit. The schema, the filters and above
all the credential live in memory for the life of the tab and nowhere else.
There are no cookies and no telemetry. There is a test that fails if a
credential, a schema name or a filter ever reaches storage.

**A copied snippet never carries your token.** `buildRequest` takes a
`revealCredential` flag that defaults to `false`, and the snippet path never
sets it. A test asserts this across every operation in the sample and all three
languages, including when the flag is omitted altogether.

## Accessibility

The point of the project, so it is worth being specific.

**Semantics.** Real landmarks with accessible names: `banner`, `navigation`
(tags and schemas), `main`, and a named region per pane. One `<h1>` naming the
tool and the loaded document. Parameters render as a real `<table>` with
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
| `Tab` (from the top) | Skip links to every landmark |

Rows are anchors, so `Enter`, middle-click and open-in-new-tab work without
being reimplemented, and every operation has an address you can paste into a
ticket. Cursor moves patch attributes in place rather than re-rendering — a
rebuilt row drops focus to the body and the whole model dies on the spot.

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

**Live regions.** One polite region and one assertive one, both present from
first paint (a region created and filled in the same tick is routinely missed).
Filter counts, copy confirmations, verify results and request outcomes are
announced; repeats are nudged so an identical message is not swallowed. Filter
announcements are debounced so typing does not produce a stream of them.

**Preferences honoured.** `prefers-color-scheme` (theme defaults to Auto, with
Light and Dark in Display), `prefers-contrast: more`, `prefers-reduced-motion`
(transitions drop to 0ms), and `forced-colors`.

**Verified, not asserted.** `npm run test:a11y` drives a real browser and
checks all of the above: `axe-core` over ten screens and states (import, parse
report, dense, roomy, dark, schema view, palette open, auth sheet, display
options, mobile detail) at WCAG 2.0/2.1/2.2 A and AA plus best-practice, and
then the behaviours a static scan cannot see — the roving tabindex holding
focus through a dozen cursor moves, the combobox keeping focus in the input
while `aria-activedescendant` moves, focus returning to an invoker whose
toolbar re-rendered underneath it, meaning never carried by colour alone,
reflow at 320px and at 200% and 400% zoom, a visible ring under
`forced-colors`, the live regions actually carrying their announcements, and
the credential reaching neither storage nor the clipboard.

The one place the design was overridden for an accessibility reason is
documented in `DECISIONS.md`.

## Try it out

Try-it sends a real request from your browser to the host the schema declares.
There is no proxy, which is what keeps the credential local, and the cost is
that the API must send CORS headers for the response to be readable. When it
does not, the panel says which of the two possible causes it is and how to tell
them apart, rather than showing a generic failure. Mutating verbs carry a `LIVE`
warning first: it is not a sandbox.

## Deployment

Netlify, static. `netlify.toml` publishes the repository root, wires
`/api/fetch-schema` to the function, and sets a CSP that allows `connect-src *`
(try-it needs to reach arbitrary hosts) while locking scripts, styles and fonts
to this origin. There is no inline script or inline style anywhere in the app.

The schema relay is deliberately narrow: http(s) only, no embedded credentials,
public addresses only — including every written form of a private one, IPv4
mapped into IPv6 among them — redirects re-checked on every hop, an 8 MB cap
read as a stream, a 10-second timeout, and text out.

## The example schema

`samples/bookings-api.v2.yaml` describes an imaginary restaurant bookings API.
It exists so the tool has something to browse on first run, and it matches the
design mocks exactly: 47 endpoints, 6 tags, 9 schemas, 3 deprecated, 4 without a
summary, one `http bearer` scheme. Open it from the import screen.
