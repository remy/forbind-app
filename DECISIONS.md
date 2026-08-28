# Decisions

Answers to the questions the handoff asked, the ones asked back, and every
place the build knowingly diverges from the mocks.

---

## The handoff's open questions

### 1. Which IA ships — `1a` or `1b`?

**Both, with `1a` as the default and `1b` as a density preference.**

`1a` (three panes, tag rail, dense rows) is what loads. Settings → Roomy switches
to `1b` (two panes, no rail, search-first, grouped rows with metadata), and the
preference is remembered.

The tag rail really is a structural difference, so it is not faked: in roomy the
rail is gone and tags become facet chips in the filter row, exactly as drawn.
The same folding already had to exist for narrow windows, so `1b` costs one
density flag rather than a second application.

The detail pane does not differ, though the mocks draw it both ways. It shipped
as the mocks have it — stacked sections in `1a`, a tab set in `1b` — and the tab
set has since been made the structure in every layout; see "The detail pane is a
tab set in every layout" below.

### 2. Is try-it-out in scope for v1?

**Yes, and without a proxy.**

Requests go straight from the browser to the host the schema declares. That
keeps the auth sheet's promise literally true — the credential never reaches a
server of ours — and it means CORS is the user's problem rather than something
hidden by a relay. So the failure case is the designed case: when a response
cannot be read, the panel names the two things it can be (unreachable host, or
no `Access-Control-Allow-Origin` for this origin), says the request may well
have succeeded regardless, points at the browser's network panel, and explains
why allyway will not proxy it.

Mutating verbs get a `LIVE` warning above the form. An operation with a declared
scheme and no credential set gets a `NO TOKEN` warning and a link to the sheet.

Auth verification splits into two claims that are never conflated:

- **what the token says about itself** — a local JWT read for scopes and expiry,
  no network, shown as `TOKEN SAYS`;
- **whether the API accepts it** — a real GET against the cheapest operation
  that needs that scheme and no invented path parameter, shown as `VERIFIED` or
  `REJECTED`. If CORS hides the answer, it says so rather than guessing.

### 3. Which snippet languages after curl, and templated or shared model?

**A shared request model, and `fetch` and `python` now work.**

`buildRequest` produces one `{method, url, headers, body}` and each language
renders that. The tabs were drawn inert; making them real was about forty lines
and it removes the possibility of the three drifting apart. Adding a language is
one function in `SNIPPET_LANGUAGES`.

The same model feeds the try-it sender, so what you copy is what gets sent —
with one deliberate exception: `buildRequest` takes `revealCredential`, it
defaults to `false`, and the snippet path never sets it. A copied command
carries `$TOKEN`. There is a test that fails if that ever stops being true.

---

## Questions asked back, and the answers given

| Question | Answer |
|---|---|
| Which IA ships? | `1a` default, `1b` as a density toggle |
| Try-it in scope? | Yes, but no proxy — say so plainly in the errors when CORS blocks it |
| How far should theming go? | Follow the system, with Light/Dark in an options panel; use `rem` so zoom works |
| Build tooling? | None — plain ESM, vendored dependencies, deployed as-is |

---

## Divergences from the mocks

Everything else matches. These are the places it does not, and why.

**Deprecated rows are at `opacity: .78`, not `.62`.** Measured against the
paper, `.62` puts the 10px verb pill at 3.34:1 and the 11.5px summary at 3.53:1
— both under the 4.5:1 the rest of the palette was built to clear, and the
handoff states that all pairs meet AA. `.78` keeps the worst pair at 5.05:1 and
still reads as clearly stood down. The de-emphasis was never carrying the
meaning anyway: the strikethrough, the neutral pill and the word "Deprecated" in
the accessible name all say it.

**The version control is static text, not `v2.1 ▾`.** Environment and base-URL
switching were explicitly descoped, which leaves the caret with nothing to
disclose. A disclosure affordance that discloses nothing is worse than no
affordance, so it shows `v2.1.0` as a labelled chip.

**A `Settings` button was added to the top bar.** Theme and density need
somewhere to live and the mocks predate the theming decision. It sits before
`Authorise` in the right cluster, in the same outline-button style. It was
called `Display` first; `Settings` is the word people go looking for.

**`DEPRECATED 3` and `Hide deprecated` are both in the dense verb bar.** The
mock shows `DEPRECATED 3` in `1a` and `Hide deprecated` in `1b`. They do
different things — show only these, versus remove these — so `1a` gets both, the
second right-aligned and dashed exactly as `1b` draws it. They are mutually
exclusive; pressing one releases the other.

**An `All endpoints` row leads the tag rail, and an `All` chip leads the tag
chip row.** The mock shows a tag selected with no drawn way back. Shift-click
(or `+ tag` in roomy) adds a tag to the selection rather than replacing it.

**The detail pane is a tab set in every layout.** The mocks draw the sections
stacked under headings in `1a` and as tabs in `1b`, and that is how it shipped.
Two structures for one pane meant two things to learn, two shapes for a
"go to Try it" command to hit, and — once either navigation column could be
folded away — a dense detail that was one very long scroll at whatever width it
happened to have. The tab set is now what an operation is, in both densities and
on phones, where the same tabs are drawn as a segmented control.

What that costs is real and worth naming: find-in-page no longer reaches a
section that is not the open one, and neither does `⌘F`'s cousin, a print. The
answer is not to keep two structures — it is that every section is one keystroke
away on the tab list, the tab list is a single tab stop, and the panel is
labelled by its tab, so nothing is hidden from a screen reader that was not
already one arrow key away.

**The header `Try it` button is not repeated.** Try it is a tab, and on phones
it is also the sticky footer action. Three controls for one job is two too many.

**The parse report is a step, not a flash.** Loading a file lands on the report
card with its warnings and a `Browse 47 endpoints` button. A link that names the
schema in the URL (`#/op/…?src=…`) skips it, because that link already knows
where it is going.

---

## Things built that the mocks did not draw

Called out because the handoff asked to be asked before anything was invented.
Each is either a state the design implies or a route out of a dead end.

- **Hover, focus and pressed states** — specified in the handoff's prose, absent
  from the static mocks, built as written (list rows and outline buttons to
  `#F3F2ED`, filled buttons to `#26261F` then `#000`, links darkening to
  `#0F2775`, transitions ≤120ms and dropped under `prefers-reduced-motion`).
- **The parse *failure* state** — described in prose, not drawn. Same "things
  worth knowing" list, a `FAIL` word-led row, the YAML or JSON line and column,
  and a `Show line …` disclosure. Never a modal alert.
- **A component schema view** (`#/schema/Booking`) — the mock's rail lists
  schemas and its params table links to one, so both needed a destination. It
  shows the fields and which operations use it.
- **An empty-results state** with a "Clear all filters" way out.
- **Facet panels in roomy.** `+ verb`, `+ auth scope`, `+ status code` are drawn
  as chips with no drawn behaviour. They expand a group of checkbox chips in the
  flow of the page rather than a positioned popup — a menu that has to be
  positioned is a menu that breaks at 400% zoom.
- **A "nothing selected" detail state**, since a schema can load with no
  operation chosen.
- **A schema `src` in the URL**, so a link to an operation opens for someone who
  has never loaded that document.
- **A bundled example schema**, so the tool has something to browse on first
  run. It matches the mocks' numbers exactly.
- **Settings** (theme, density, hint bar), following the theming answer.

---

## Changes made after the handoff, at the user's request

**The schema comes back on reload.** It used to be memory-only, so a refresh
dropped you at the file picker. A schema loaded from a URL is remembered as
that URL and re-fetched; one loaded from a file keeps its text in
`localStorage` under a 3 MB cap. `Replace schema` forgets it. The import
screen's promise — "nothing leaves your browser" — is unchanged, because
storage is the browser.

**The credential can be remembered, and says where it is.** It used to be
memory-only. It now defaults to `sessionStorage`, which survives a reload but
dies with the tab, and a labelled checkbox moves it to `localStorage` with the
trade spelled out under the label ("still here tomorrow — and readable by
anything else that can read this browser's data"). The sheet's opening line
changes to match whichever is in force, so the copy is never claiming more
privacy than it is delivering. A credential is stored against the schema it was
entered for and is never handed to a different one. Neither store ever reaches
a snippet.

**Enum parameters are dropdowns in try-it.** A parameter whose schema declares
an `enum` renders as a `<select>` of exactly those values. Optional ones open on
a real "— not sent —" choice rather than a blank; required ones open on their
first value, which is what the curl block already shows, so the two agree from
the start. The enum is dropped from the hint line, since the control is now
saying it.

**A schema with no server URL says so, and can be given one.** `servers` is
optional in OpenAPI, and a document without it describes paths with no host in
front of them — which used to surface only as a failure when Try it was
pressed. It is now detected at ingest and carried on the parse report as a
`WARN` with a base URL field beside the *Browse* button, never in front of it:
reading an API you cannot call is an ordinary thing to want, so supplying one
is an offer and not a toll. Three shapes count as the same gap and are named
apart in the warning — no `servers` at all, a relative URL, and one still
holding a `{variable}` with no default. A link that opens an operation directly
never sees the report, so the same field is in the Try it panel and the gap is
announced on arrival. What is typed is completed when it is only missing a
scheme and refused with a sentence when it is not a base URL at all. It is kept
in `localStorage` against the schema it was typed for, on the same rule as the
credential: a host nobody chose for a document is a request sent somewhere
nobody chose. Setting one patches the URL under the Send button in place, because
the field that sets it is inside the panel and holds focus while it changes.

**Enum dropdowns follow the `$ref`.** Documents rarely write an enum where the
field is; they name it once as a schema and point at it, often through an
`allOf: [{$ref}, {description}]` wrapper so prose can sit beside it. The
dropdown used to need the values written in place, so those fields landed as
free text — the one shape of field that cannot be typed wrong, typed by hand.
`js/lib/enums.js` follows the hops. An array of enums is left alone: it wants a
multi-select and a different validation story. So are two branches offering
different sets, which is not a choice to make on the reader's behalf.

**Descriptions are rendered as markdown.** `description` is CommonMark
everywhere in OpenAPI and documents use it, so rendering it as plain text put
asterisks, backticks and pipes on screen as litter. markdown-it is vendored
(UMD wrapped as ESM — its own ESM entry is unbundled and there is no bundler
here) and configured once in `js/lib/markdown.js`, which is the only place a
document's string reaches `innerHTML`. Four rules make it safe to point at
someone else's file: raw HTML never renders (`html: false`, no sanitiser to get
wrong), headings are pushed to `h3`–`h6` and renumbered in sequence so a description
can neither outrank the pane it sits in nor skip a level on the way into it, images become links because the CSP allows images from this
origin only and a broken image box says nothing, and links open in a new tab —
losing a half-filled try-it form to a documentation link would be its own bug —
with "(opens in a new tab)" in the accessible name, because that is a surprise
otherwise. Where the design has one line and no more — a list row, a table of
contents summary, a hint tied to a field, anything that becomes an accessible
name — the markdown is *stripped to its words* rather than rendered, since a
link cannot live inside a `<summary>` and raw syntax is worse than emphasis
quietly lost.

**Try-it is a real form.** The fields and the send button are in a `<form>`, so
Enter sends — previously nothing happened, because Enter has no meaning outside
a form. Validation is deliberately narrow: an empty required field is fine when
the schema offers an example, because the builder uses it and the snippet
already shows it. It only stops when there is nothing to fall back on and the
URL would carry a literal `{bookingId}`. Then it announces which parameter,
marks the field `aria-invalid`, ties a `NEEDED`-led message to it, and moves
focus there; typing clears it.

**The browser is a fixed frame again.** The mocks draw a 1280×800 app with
panes that scroll inside it; the build had drifted into a page that scrolled as
a whole, so the endpoint list ran off the bottom of the window and the keyboard
hint bar went with it. Above the phone breakpoint the shell is pinned to the
window and each pane scrolls in its own bounds. On a phone it stays an ordinary
scrolling page.

**Skip links move focus themselves.** They were plain `href="#detail"` links,
which is right in a static document and wrong here: the fragment is the router,
so following one was read as a route naming no operation and cleared both the
open operation and the filters. They keep their hrefs and preventDefault on
activation. The tags link resolves across the rail, the chip row and the facet
buttons, so it always lands on the one the current layout is showing rather
than on a hidden element.

**The cursor follows the rendered order.** It walked the filtered array while
the roomy layout rendered the same operations grouped by tag, so the arrows and
the eye disagreed. The list now records the order as it builds the rows, and
every keyboard behaviour reads from that.

**The columns fold away.** Three panes is the right default and the wrong
answer when the thing being read is a response body thirteen levels deep. Both
navigation columns are now disclosures — `Tags` and `List` in the top bar —
and folding both gives the detail the whole frame, which is all "maximise"
means here; `⇧⌘M` does the pair in one step.

A folded column is removed from the grid rather than shrunk to a strip. A strip
would have to carry a control to bring the column back, which is a second tab
stop for a state the top bar is already reporting, and the design has no
vocabulary for a vertical label. So the toggles stay put and stay legible:
`aria-expanded` says which way round each is, a caret turns towards where the
column went, and the fill changes — three cues, none of them colour alone.

Folding the rail is the same substitution the 75rem breakpoint already makes:
the tags become the chip row that stands in for the rail, so what is saved is
216px of width rather than the ability to filter by tag. One rail, one stand-in,
whichever reason the rail is not there.

The care is in the ways back. Focus is moved out of a column before it stops
being focusable, or it lands on the body. A skip link aimed at a folded column
unfolds it on the way past rather than pointing at something invisible — but
only where nothing it names is on screen, so the tags link lands on the chips
instead of undoing the fold. `/`
then `↓`, and anything else that moves into the list, brings the list back
first — the rows are still in the document when the column is folded, so
focusing one would otherwise fail silently. Below the phone breakpoint none of
it applies: the list and the detail are already separate pages there, so the
flags are ignored and the toggles are not rendered rather than sitting there
doing nothing.

Neither the shell nor the top bar re-renders for a fold. Both patch the
attributes in place, because the button that did the folding lives in the top
bar and a replaced button takes the keyboard's focus to the body with it —
the same rule the endpoint list's cursor has always followed.

**Two files were split rather than grown.** `css/app.css` was 539 lines of two
subjects; the endpoint list moved to `css/list.css`. The browser suite was one
944-line file; it is now `test/a11y/`, one file per subject over a shared
harness, run by the same `npm run test:a11y`. Nothing in either changed
besides where it lives.

**Responses show their payload.** They were a status code and a phrase, which
is all the mock draws — but with a schema like Oak's, whose responses are
inline anonymous objects nested three deep, that told you nothing about what
came back. Each response is now a disclosure: collapsed it is the drawn row
plus a shape hint, opened it is the body's structure and a generated example.

Nested native `<details>` inside nested `<ul>`s, not `role="tree"`. The tree
pattern would mean hand-rolling roving tabindex, `aria-expanded`,
`aria-level`, `aria-setsize` and `aria-posinset`, and its screen-reader
support is uneven; a response body is a document with a shape rather than a
tree widget. Disclosures bring their own expanded state, keyboard handling and
find-in-page reveal, and the nested lists carry the depth.

Levels build on first open — thirteen levels deep is real, and a schema may
contain itself. A branch that reopens a type already open above it says
`repeats Booking` and links to it. Links live in the branch body rather than
the summary, because a `<summary>` is a button and a link inside one is a
focusable control inside a focusable control.

---

## Still not designed, still not invented

- A live response *viewer* beyond status, timing, size, readable headers and a
  pretty-printed body.
- Request history.
- Schema diffing.
- Environment switching — several named servers with one selected, remembered
  per environment. Still descoped. The base URL field added later is not that:
  it is one value, offered only where the document leaves a gap.
- `1c`, the palette-only reading view. Rejected in design; the id stays retired.
  The palette accelerates the visible IA and does not replace it.
