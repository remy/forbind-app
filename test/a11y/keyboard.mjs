/**
 * The keyboard model: the roving cursor in the endpoint list, the combobox in
 * the palette, and focus surviving the re-renders around them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open } from './lib/harness.mjs';

test('the endpoint list is one tab stop with a roving cursor', async () => {
  const page = await open();
  try {
    assert.equal(await page.locator('a.row[tabindex="0"]').count(), 1);
    assert.ok(await page.locator('a.row[tabindex="-1"]').count() > 40);

    await page.locator('a.row').first().focus();
    // Identify rows by id, not by path: the first two rows of the sample are
    // GET and POST on the same path.
    const rowAt = () => page.evaluate(() => document.activeElement.dataset.opId);
    const pathAt = () => page.evaluate(() => document.activeElement.querySelector('.row__path')?.textContent);
    const first = await rowAt();

    await page.keyboard.press('ArrowDown');
    assert.notEqual(await rowAt(), first);
    // Still exactly one tab stop after moving.
    assert.equal(await page.locator('a.row[tabindex="0"]').count(), 1);

    await page.keyboard.press('End');
    const last = await rowAt();
    await page.keyboard.press('Home');
    assert.equal(await rowAt(), first);
    assert.notEqual(last, first);

    // A letter jumps to the next matching path.
    await page.keyboard.type('v2/venues');
    await page.waitForTimeout(200);
    assert.match(await pathAt(), /^\/v2\/venues/);

    // Enter opens, and selection is marked three ways.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('a.row[aria-current="true"]').count(), 1);
    assert.match(page.url(), /#\/op\//);
  } finally {
    await page.close();
  }
});

test('the cursor follows the rows as rendered, not some other ordering', async () => {
  // The roomy layout groups rows by tag, so the order on screen and the order
  // the filter returns are different lists. The arrows have to follow the eye.
  for (const density of ['dense', 'roomy']) {
    const page = await open();
    try {
      await page.evaluate((d) => window.__aw.actions.setDensity(d), density);
      await page.waitForTimeout(500);

      const domOrder = () => page.evaluate(() => [...document.querySelectorAll('a.row')].map((a) => a.dataset.opId));
      const expected = await domOrder();

      await page.locator('a.row').first().focus();
      const walked = [];
      for (let i = 0; i < 8; i += 1) {
        walked.push(await page.evaluate(() => document.activeElement.dataset.opId));
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(60);
      }
      assert.deepEqual(walked, expected.slice(0, 8), `${density}: the cursor did not follow the rendered order`);

      // And again with a query, where the filter sorts by score.
      await page.evaluate(() => window.__aw.actions.setQuery('booking'));
      await page.waitForTimeout(600);
      const queried = await domOrder();
      await page.locator('a.row').first().focus();
      const walkedQ = [];
      for (let i = 0; i < 5; i += 1) {
        walkedQ.push(await page.evaluate(() => document.activeElement.dataset.opId));
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(60);
      }
      assert.deepEqual(walkedQ, queried.slice(0, 5), `${density}: filtered cursor did not follow the rendered order`);

      // End lands on the last row on screen, Home on the first.
      await page.keyboard.press('End');
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.opId), queried.at(-1));
      await page.keyboard.press('Home');
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.opId), queried[0]);
    } finally {
      await page.close();
    }
  }
});

test('the cursor never loses focus to the body while moving', async () => {
  const page = await open();
  try {
    await page.locator('a.row').first().focus();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('ArrowDown');
      const tag = await page.evaluate(() => document.activeElement.tagName);
      assert.equal(tag, 'A', `focus fell off the list after ${i + 1} presses`);
    }
  } finally {
    await page.close();
  }
});

test('the palette is a combobox: focus stays put and activedescendant moves', async () => {
  const page = await open();
  try {
    await page.locator('a.row').nth(2).focus();
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    assert.equal(await page.evaluate(() => document.activeElement.id), 'palette-input');
    const input = page.locator('#palette-input');
    assert.equal(await input.getAttribute('role'), 'combobox');
    assert.equal(await input.getAttribute('aria-expanded'), 'true');
    assert.equal(await input.getAttribute('aria-controls'), 'palette-listbox');
    assert.equal(await input.getAttribute('aria-autocomplete'), 'list');

    await page.keyboard.type('venue');
    await page.waitForTimeout(300);
    const before = await input.getAttribute('aria-activedescendant');
    await page.keyboard.press('ArrowDown');
    const after = await input.getAttribute('aria-activedescendant');
    assert.notEqual(before, after);
    // Focus has not moved to the option.
    assert.equal(await page.evaluate(() => document.activeElement.id), 'palette-input');
    assert.equal(await page.locator('[role="option"][aria-selected="true"]').count(), 1);

    // Escape closes and hands focus back to whatever opened it.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('dialog.palette[open]').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'row');
  } finally {
    await page.close();
  }
});

test('a dialog hands focus back even when the bar it came from re-rendered', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Display' }).click();
    await page.waitForTimeout(300);
    // Changing density re-renders the top bar the invoker lives on.
    await page.getByRole('radio', { name: /^Roomy/ }).check();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.density), 'roomy');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Display');
  } finally {
    await page.close();
  }
});
