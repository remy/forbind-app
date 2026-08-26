# Decisions

Answers to the questions the handoff asked, the ones asked back, and every
place the build knowingly diverges from the mocks.

---

## The handoff's open questions

### 1. Which IA ships — `1a` or `1b`?

**Both, with `1a` as the default and `1b` as a density preference.**

`1a` (three panes, tag rail, dense rows) is what loads. Display → Roomy switches
to `1b` (two panes, no rail, search-first, grouped rows with metadata), and the
preference is remembered.

The tag rail really is a structural difference, so it is not faked: in roomy the
rail is gone and tags become facet chips in the filter row, exactly as drawn.
The same folding already had to exist for narrow windows, so `1b` costs one
density flag rather than a second application.

The detail pane differs too, as the mocks show: stacked sections under real
headings in dense (one linear read, and find-in-page reaches all of it), a tab
set in roomy and on phones.

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
| Build tooling? | None — plain ESM, vendored dependency, deployed as-is |

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

**A `Display` button was added to the top bar.** Theme and density need
somewhere to live and the mocks predate the theming decision. It sits before
`Authorise` in the right cluster, in the same outline-button style.

**`DEPRECATED 3` and `Hide deprecated` are both in the dense verb bar.** The
mock shows `DEPRECATED 3` in `1a` and `Hide deprecated` in `1b`. They do
different things — show only these, versus remove these — so `1a` gets both, the
second right-aligned and dashed exactly as `1b` draws it. They are mutually
exclusive; pressing one releases the other.

**An `All endpoints` row leads the tag rail, and an `All` chip leads the tag
chip row.** The mock shows a tag selected with no drawn way back. Shift-click
(or `+ tag` in roomy) adds a tag to the selection rather than replacing it.

**The header `Try it` button is not repeated in the tabbed layouts.** In roomy
and on phones, Try it is already a tab, and on phones it is also the sticky
footer action. Three controls for one job is two too many.

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
- **Display options** (theme, density, hint bar), following the theming answer.

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

---

## Still not designed, still not invented

- A live response *viewer* beyond status, timing, size, readable headers and a
  pretty-printed body.
- Request history.
- Schema diffing.
- Environment or base-URL switching — explicitly descoped, and left that way.
- `1c`, the palette-only reading view. Rejected in design; the id stays retired.
  The palette accelerates the visible IA and does not replace it.
