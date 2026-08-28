import test from 'node:test';
import assert from 'node:assert/strict';

import { markdownToHtml, markdownToText } from '../js/lib/markdown.js';

test('a description renders as the markdown OpenAPI says it is', () => {
  const html = markdownToHtml('Use **sort**, one of `title` or `artist`.\n\n- first\n- second');
  assert.match(html, /<strong>sort<\/strong>/);
  assert.match(html, /<code>title<\/code>/);
  assert.match(html, /<ul>\s*<li>first<\/li>/);
});

test('raw HTML in a schema is shown as text, never rendered', () => {
  const html = markdownToHtml('Before <script>alert(1)</script> after <img src=x onerror=alert(1)>');
  assert.ok(!/<script|<img/.test(html), html);
  assert.match(html, /&lt;script&gt;/);
});

test('a javascript: link is not turned into a link at all', () => {
  const html = markdownToHtml('[click](javascript:alert(1))');
  assert.ok(!/<a /.test(html), html);
});

test('links say that they leave, because opening a new tab unannounced is a trap', () => {
  const html = markdownToHtml('See [the guide](https://example.com/docs).');
  assert.match(html, /<a href="https:\/\/example\.com\/docs" target="_blank" rel="noopener noreferrer">/);
  assert.match(html, /<span class="visually-hidden"> \(opens in a new tab\)<\/span><\/a>/);
});

test('headings start below the page, so a description cannot outrank the pane', () => {
  const html = markdownToHtml('# One\n\n## Two\n\n#### Four');
  assert.match(html, /<h3 class="md__h">One<\/h3>/);
  assert.match(html, /<h4[^>]*>Two<\/h4>/);
  // Renumbered in sequence: `####` under `##` is one step down, not two.
  assert.match(html, /<h5[^>]*>Four<\/h5>/);
  assert.ok(!/<h1|<h2/.test(html));
});

test('a description that opens at ### does not skip a level on the way in', () => {
  const html = markdownToHtml('### Deep\n\n#### Deeper\n\n### Back');
  assert.match(html, /<h3 class="md__h">Deep<\/h3>/);
  assert.match(html, /<h4[^>]*>Deeper<\/h4>/);
  assert.match(html, /<h3[^>]*>Back<\/h3>/);
});

test('headings stop at h6 rather than running off the end', () => {
  const html = markdownToHtml('# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f');
  assert.match(html, /<h6[^>]*>e<\/h6>/);
  assert.match(html, /<h6[^>]*>f<\/h6>/);
});

test('an image becomes a link, because the CSP will not load a remote one', () => {
  const html = markdownToHtml('![a screenshot](https://cdn.example.com/a.png)');
  assert.ok(!/<img/.test(html), html);
  assert.match(html, /href="https:\/\/cdn\.example\.com\/a\.png"/);
  assert.match(html, /a screenshot \(image/);
});

test('inline rendering stays inline, for the places that are one line', () => {
  const html = markdownToHtml('a **b**', { inline: true });
  assert.equal(html, 'a <strong>b</strong>');
});

test('where only text will fit, the syntax is removed rather than shown', () => {
  // Concatenated, not joined: punctuation must not be stranded by the markup
  // that was removed from around it.
  assert.equal(markdownToText('Use **sort**, one of `title`.'), 'Use sort, one of title.');
  assert.equal(markdownToText('# Heading\n\nBody text.'), 'Heading Body text.');
  assert.equal(markdownToText('See [the guide](https://example.com).'), 'See the guide.');
  assert.equal(markdownToText('```\ncode block\n```'), 'code block');
  assert.equal(markdownToText(''), '');
  assert.equal(markdownToText(undefined), '');
});

test('nothing in, nothing out — an empty description renders no element', () => {
  assert.equal(markdownToHtml(''), '');
  assert.equal(markdownToHtml('   '), '');
  assert.equal(markdownToHtml(null), '');
});
