# highlight.js 11.11.1

Vendored, because there is no build step here and nothing is fetched at run
time — what is in the repository is what the browser loads.

These are the published ES module builds, taken verbatim from cdnjs:

    https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/es/core.min.js
    https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/es/languages/json.min.js
    https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/es/languages/xml.min.js
    https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/es/languages/yaml.min.js

Renamed to `.mjs` to match `js-yaml.mjs` and `markdown-it.mjs` beside them, and
otherwise unedited. Unlike those two this dependency is genuinely several
files — the core and one grammar per language — so it gets a directory rather
than being flattened into one.

Only these three grammars are here because only these three turn up as an HTTP
response body worth colouring. Everything else is shown as plain text, which is
a deliberate outcome and not a gap: see `js/lib/highlight.js`, which is the
only thing in the app that imports any of this.

BSD-3-Clause. https://github.com/highlightjs/highlight.js
