# Accessibility audit, and what changed because of it

An external WCAG 2.2 audit read the code and drove the running app in Chromium
across four viewports and three themes, followed by a second pass over the
palette. This file records what it found, what was done, and — as importantly —
what looked like a finding and was withdrawn. `DECISIONS.md` covers every other
awkward part of the design; this one covers only the accessibility work, which
had grown long enough to stop being a section of that file.

It found nothing critical — no unreachable content, no blocked task, no
keyboard trap — and two things worth the word major. Both were promises the
product made about itself that the code kept in some configurations and not
others, which is the shape a bug takes when the automated sweep is already
green.

**Opening an endpoint on a phone kept the keyboard.** Below `48rem` the list
and the detail are separate pages, so activating a row hid the row — and the
focus standing on it went to `<body>`. Recovery was six <kbd>Tab</kbd> presses
through the whole top bar. `selectSchema()` and `backToList()` already moved
focus deliberately; only `selectOperation()` did not, and only the phone layout
suffered, because that is the only layout where the row leaves the screen.
Focus now goes to `#detail` there and the operation is announced. The desktop
path is untouched: the row is still on screen, and moving focus off it would be
the regression.

**`prefers-contrast: more` reaches every theme.** The override was written as
`@media (prefers-contrast: more) { :root { … } }`. A media query adds no
specificity, so `(0,1,0)` lost to `:root[data-theme='light']` at `(0,2,0)` and
to the auto-dark selector at `(0,3,0)`: it applied only when nothing else had
claimed `:root`, which is one of the four ways a reader can arrive. Anyone who
picked a theme, or whose system is dark, asked for more contrast and got none.
The block now names the same selectors it overrides. The values were already
theme-relative (`var(--ink)`), so one block still serves all four — and
`README.md` was listing this preference as honoured the whole time, which is
the part with real exposure attached.

**The title names the screen.** Four screens shared one `document.title` while
the address bar changed under each. Now: `GET /v2/bookings — Bookings API —
forbind`, most specific part first, so a truncated tab still says something.
The logic is a pure function in `js/lib/title.js` and is unit-tested; keying it
off `schemaState` rather than the presence of a schema is what stops *Replace
schema* from leaving the old API's name over the import screen.

**The whole of the search field is the search field.** `.field` is 32px and
centred an 18px input inside it, leaving a 7px dead band top and bottom where
the pointer hit a `<div>` with no handler. `align-self: stretch` costs nothing
visually. It fails AAA target size either way at that height; it no longer
fails to be a target at all.

**Three colour pairs went over 7:1, and one boundary over 3:1.** Nothing was
failing AA. The GET pill (6.28:1), the POST pill (6.42:1) and the hint bar on
`paper-alt` (6.60:1) were the only pairs in the system short of AAA, and the
unfilled chip border was 2.30:1 where 1.4.11 wants 3:1 for a component boundary
carrying no fill. Both are token changes. The tests measure them from computed
styles in the page rather than from the token values, so a token that stops
reaching an element fails rather than passing on paper.

**A mutating request is confirmed, not only warned about.** Try it sends a real
`DELETE` to a real host on one press. The `LIVE` warning said so; 3.3.6 asks for
a reversal, a check or a confirmation, and a client that does not own the API
has only the third. The dialog names the exact URL and opens on *Cancel*, so
<kbd>Esc</kbd> and <kbd>Enter</kbd> both mean no. `GET` is not asked about: a
question raised about everything is a question nobody reads.

**The two hardest sentences were split.** The copy reads at grade 8.4 overall,
but the Try it panel — the surface that fires irreversible requests — was at
12.3, and the single hardest sentence, on which response headers a browser
exposes cross-origin, was 30 words at grade 17.4. It was accurate and worth
saying; it did not have to be said in one breath. `test/a11y/prose.mjs` holds
the line at 25 words per sentence there, which is the mechanism rather than a
readability index — the index would only be a noisier way of saying the same
thing.

**`.focus-inset` was deleted rather than documented.** `README.md` and this
file described an inset ring for anything whose outer ring would be clipped by
a pane edge. The class existed, including its `forced-colors` re-declaration,
and no element in the codebase wore it. Rings were measured at every pane edge
and none is clipped, so it went. The one inset ring left is on `.field`, which
draws its own inside the border it already has, and that one is re-declared
under `forced-colors` exactly as the rule requires.

A second pass, checking the palette as it composites rather than as it is
written, found the one thing the first had no way to see. Contrast was measured
from token values, and `opacity` is applied after those values resolve: it
takes an element's text and its background down together, against whatever is
behind them. Two places fade something.

**A deprecated row was taking its verb pill under AA.** `.row--deprecated` was
`opacity: 0.78`, and the pale-tinted pills lose the most when a row fades —
POST landed at 4.29:1, under the 4.5:1 that 10px text needs. The comment beside
the rule claimed the worst pair was at 5.05:1, and it was measuring the neutral
"Deprecated" marker, which is the *best* of the pills and happens to be the
first one in the row. 0.85 puts the actual worst pair at 5.05:1 in light and
6.87:1 in dark. The row still reads as stood down, and the meaning was never in
the fade: the strikethrough, the marker pill and the accessible name all say
it.

**A busy button was dimmed to 4.21:1 while telling you something.** `.btn` at
`aria-disabled` was `opacity: 0.55`. An inactive control is exempt from 1.4.3,
but both places this state is used put *status* in the label — "Sending…" in
Try it, "Testing…" in the auth sheet — so the exemption covers exactly the
moment the label matters. 0.6 takes it to 5.00:1 and still reads as stood down.

Both are covered by a test that composites through `opacity` from the page's
own computed styles, and that reads the fade off a real row and applies it to
every verb tint on screen — the sample only ever deprecates GETs, so trusting
the rendered rows alone would have missed POST, which is the one that failed.

The same pass simulated the palette for deuteranopia, protanopia and
tritanopia. Every text pair stays above 4.5:1; the weakest is the light DELETE
pill at 4.50:1 under tritanopia. The verb *tints*, though, collapse: they are
within 1.02:1 of each other by luminance even for normal vision, and under
deuteranopia POST and DELETE simulate to the same colour exactly. Nothing is
lost, because the verb is written inside the pill — but those fills are
decorative, and nothing should ever be built that reads them.

Five further findings were chased down by the audit and withdrawn, and are
worth recording because each is the kind of false positive a scan files:
focusing an element from script does not satisfy `:focus-visible` in Chromium
(the rings were real, the measurement was not); predicted ring clipping that
the browser does not actually do; ten targets under 24px that all meet 2.5.8 on
the spacing exception, the tightest by 17px against a 12px requirement; a focus
ring measured against a fill it is held 2px clear of; and a skip link "clipped"
in the state where it is hidden on purpose.

What the audit could not answer still stands: it was Chromium only, no screen
reader was involved, and no disabled person tested it. WCAG conformance is a
floor.

**The frame and its scrollers are `position: relative`, and that is not
decoration.** `.visually-hidden` is absolutely positioned — it has to be, or a
1px box would sit in the flow and disturb the line it is on. An absolutely
positioned box is only clipped by an ancestor that is in its containing-block
chain, so with every ancestor static, each screen-reader-only span inside a
scrolled pane took its static position in the *unclipped* content and pulled
the document's scrollable area down after it. A frame declared `height: 100dvh;
overflow: hidden` could still be wheeled off the top of the window, and a modal
dialog opened onto a document three times the height of the viewport. `.app`,
`.rail`, `.pane--detail` and `.list-scroll` now each establish a containing
block, so hidden text is clipped by the box that scrolls it. `test/a11y/
layout.mjs` holds the line: the document's own overflow must be zero, with and
without a dialog open.
