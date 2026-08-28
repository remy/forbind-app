/**
 * Descriptions are markdown, and are rendered as such — without letting the
 * document write HTML into the page, take over the heading outline, or send
 * someone to a new tab without saying so.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, showTab, violations } from './lib/harness.mjs';

const DOCS = '/test/fixtures/markdown-docs.yaml';

test('a description renders as elements, not as its own syntax', async () => {
  const page = await open(`#/op/get-notes?src=${DOCS}`);
  try {
    const lede = page.locator('.detail__lede.md').first();
    assert.equal(await lede.count(), 1);
    assert.equal(await lede.locator('strong').first().textContent(), 'every');
    assert.equal(await lede.locator('code').first().textContent(), 'limit');
    assert.equal(await lede.locator('ul li').count(), 2);
    // The asterisks and backticks are gone from the text, not shown in it.
    const text = await lede.textContent();
    assert.ok(!/\*\*|^- /m.test(text), text);

    assert.deepEqual(await violations(page), []);
    assert.deepEqual(page.problems, []);
  } finally {
    await page.close();
  }
});

test('a heading in a description cannot outrank the pane it sits in', async () => {
  const page = await open(`#/op/get-notes?src=${DOCS}`);
  try {
    // h3, because the pane's own title above it is the h2.
    assert.equal(await page.locator('.detail__lede.md h3').count(), 1);
    assert.equal(await page.locator('.detail__lede.md h1, .detail__lede.md h2').count(), 0);
    // One h1 for the page, still.
    assert.equal(await page.locator('h1').count(), 1);
  } finally {
    await page.close();
  }
});

test('raw HTML in a description is text, and a link says where it goes', async () => {
  const page = await open(`#/op/get-notes?src=${DOCS}`);
  try {
    // `.md` is the rendered description; the plain `.detail__lede` above it is
    // the summary, which is not markdown and never was.
    assert.equal(await page.locator('.detail__lede.md script').count(), 0);
    assert.match(await page.locator('.detail__lede.md').first().textContent(), /<script>alert\(1\)<\/script>/);

    const link = page.locator('.detail__lede.md a').first();
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    // The warning is in the accessible name, not only in the markup.
    assert.match(await link.textContent(), /opens in a new tab/);
  } finally {
    await page.close();
  }
});

test('a parameter description is markdown in the table it lands in', async () => {
  const page = await open(`#/op/get-notes?src=${DOCS}`);
  try {
    await showTab(page, 'body');
    const notes = page.locator('.col-notes').first();
    assert.equal(await notes.locator('code').first().textContent(), 'maxLimit');
    assert.equal(await notes.locator('strong').first().textContent(), 'settings');
    // A description is regularly a table of what the field accepts. Inline
    // rendering leaves that as raw pipes, so the cell takes a block.
    const table = page.locator('.col-notes table');
    assert.equal(await table.count(), 1);
    assert.equal(await table.locator('tbody tr').count(), 3);
    assert.ok(!(await page.locator('.col-notes').last().textContent()).includes('| ---'));
  } finally {
    await page.close();
  }
});

test('a parameter description is markdown in the try-it form as well', async () => {
  const page = await open(`#/op/get-notes?src=${DOCS}`);
  try {
    await showTab(page, 'tryit');
    // The facts stay a terse line; the prose gets the room it needs.
    const row = page.locator('.field-row', { has: page.getByLabel(/^q/) });
    const facts = row.locator('.hint').first();
    assert.equal((await facts.textContent()).trim(), 'string · optional');

    const prose = row.locator('.hint--prose');
    assert.equal(await prose.locator('table tbody tr').count(), 3);
    assert.equal(await prose.locator('code').first().textContent(), 'elvis');
    assert.ok(!(await prose.textContent()).includes('| ---'));

    // Both are tied to the field, so neither is only there for the sighted.
    const described = await page.getByLabel(/^q/).getAttribute('aria-describedby');
    assert.equal(described.split(' ').length, 2);
    for (const id of described.split(' ')) assert.equal(await page.locator(`#${id}`).count(), 1);

    assert.deepEqual(await violations(page), []);
    assert.deepEqual(page.problems, []);
  } finally {
    await page.close();
  }
});

test('where only one line fits, the syntax is stripped rather than printed', async () => {
  const page = await open(`#/op/get-notes?src=${DOCS}`);
  try {
    await showTab(page, 'responses');
    const summary = await page.locator('.response-summary__text').first().textContent();
    assert.equal(summary, 'The notes, newest first.');
    assert.ok(!summary.includes('**'));
  } finally {
    await page.close();
  }
});

test('a field and its notes read as one entry, in that order', async () => {
  const page = await open(`#/op/get-notes?src=${DOCS}`);
  try {
    await showTab(page, 'body');
    // The notes take the width, so they are a row under the field rather than
    // a column beside it. Reading down the table that is the field, its type
    // and its required flag, then the notes for that same field.
    const shape = await page.evaluate(() =>
      [...document.querySelector('table.params tbody').rows].slice(0, 2).map((row) => ({
        cls: row.className,
        cells: [...row.cells].map((cell) => ({
          tag: cell.tagName.toLowerCase(),
          id: cell.id,
          headers: cell.getAttribute('headers'),
          span: cell.colSpan,
          text: cell.textContent.trim().slice(0, 20),
        })),
      })));
    assert.equal(shape[0].cells.length, 3);
    assert.equal(shape[0].cells[0].tag, 'th');
    assert.equal(shape[1].cells.length, 1);
    assert.equal(shape[1].cells[0].span, 3);
    // The association the row order lost is made explicitly, so the field's
    // name is what a screen reader announces before its notes.
    assert.equal(shape[1].cells[0].headers, shape[0].cells[0].id);
    assert.ok(shape[1].cells[0].headers);
    assert.match(shape[1].cells[0].text, /^Notes:/);

    // Ids are the one document's id space: they have to stay unique.
    const dupes = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map((n) => n.id);
      return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    });
    assert.deepEqual(dupes, []);

    assert.deepEqual(await violations(page), []);
    assert.deepEqual(page.problems, []);
  } finally {
    await page.close();
  }
});
