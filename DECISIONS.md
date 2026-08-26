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

## Still not designed, still not invented

- A live response *viewer* beyond status, timing, size, readable headers and a
  pretty-printed body.
- Request history.
- Schema diffing.
- Environment or base-URL switching — explicitly descoped, and left that way.
- `1c`, the palette-only reading view. Rejected in design; the id stays retired.
  The palette accelerates the visible IA and does not replace it.
