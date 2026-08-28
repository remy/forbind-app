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
