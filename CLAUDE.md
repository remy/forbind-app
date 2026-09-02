# Working in this repository

Forbind is an accessibility first OpenAPI browser. Everything
below is a constraint on how it is built, not a style preference. `README.md`
says what the app does; `KNOWLEDGE.md` says how it is put together;
`DECISIONS.md` records why the awkward parts are the way they are.

## Prerequisites

**No file over 500 lines.** Code and markdown alike. A file approaching the
line is a file with two subjects in it: split it by subject, give each half a
header comment saying what it covers, and leave the behaviour alone in the same
commit. Splitting is cheap here — there is no build step and no bundler config
to update. Two files are over the line today and are the exception rather than
the licence: `js/lib/openapi.js` (the parser) and `js/main.js` (the entry
point). Split whichever you are substantially editing.

**No React. No framework.** No Vue, no Svelte, no Lit, no htmx. The custom
elements in `js/components/` are the component model, `js/lib/store.js` is the
state model, and neither is to be replaced by a dependency.

**No Tailwind.** No utility-class frameworks, no CSS-in-JS, no preprocessors.
Styling is hand-written CSS in `css/`, driven by the custom properties in
`css/tokens.css`. A new colour, size or spacing value goes in as a token first.

**Web components, in the light DOM.** New UI is a custom element extending
`FbElement` and registered with `define()`. No shadow roots: `aria-controls`,
`aria-describedby`, `aria-activedescendant` and `<label for>` all have to reach
across what would otherwise be a shadow boundary, and cross-root ARIA is still
not something to rely on. One document, one id space.

**Modern CSS, chosen against Baseline.** Prefer the feature the platform now
has over the workaround it used to need — grid, `min()`/`max()`/`clamp()`,
logical properties, `:has()`, container queries, nesting. Decide with
[Baseline](https://web-platform-dx.github.io/web-features/), not with folklore
about old browsers:

- **Baseline Widely available** — use it, no fallback, no comment needed.
- **Baseline Newly available** — usable with a fallback that degrades to
  something legible, and a comment saying what the fallback is for.
- **Not Baseline** — only behind `@supports`, and only with a note in
  `DECISIONS.md` saying why it earns its place.

The same test applies to JavaScript: this repo ships ES modules to the browser
as written, so a feature that is Baseline is a feature you can just use.

**No build step, and no runtime dependencies.** What is in the repository is
what the browser loads. The one vendored dependency is `js-yaml`. Playwright
and axe-core are development-only and nothing in `js/` may import them.

## Accessibility is the product

A change that costs accessibility is a regression even when it looks better.
The non-negotiables:

- Real semantics before ARIA. A list is a `<ul>`, a disclosure is `<details>`
  or a button with `aria-expanded`, a table of parameters is a `<table>`.
- Nothing is said by colour alone. State gets a second and third cue — a word,
  a border, an ARIA attribute.
- Never remove a focus indicator; where an outline would be clipped by a pane
  edge, use an inset ring and re-declare it as an outline under
  `forced-colors`.
- Never move or destroy the element the keyboard is standing on. Patch
  attributes in place rather than re-rendering the subtree that holds focus.
- Every size in `rem`, breakpoints included, so a text-size preference scales
  the whole interface.
- Anything that changes what is on screen without moving focus gets announced
  through `js/lib/announce.js`.

## Before you call it done

```sh
npm test          # node:test over the pure modules — fast, no browser
npm run test:a11y # the browser suites in test/a11y/ (needs npm install)
```

Both suites are part of the deal, not a nicety: the accessibility guarantees in
`README.md` are checked in a real browser, so a new behaviour that touches
focus, keyboard, landmarks or announcements needs a check in `test/a11y/`
alongside it. Update `README.md` when behaviour changes and add to
`DECISIONS.md` when a choice needs defending.
