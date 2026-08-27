/**
 * What the interface says without words: never colour alone, motion the system
 * asked to be reduced, and a focus ring that survives forced colours.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, showTab, SRC } from './lib/harness.mjs';

test('meaning is never carried by colour alone', async () => {
  const page = await open();
  try {
    // The verb is a word, and DEL still announces as DELETE.
    const del = page.locator('a.row', { has: page.locator('.pill--delete') }).first();
    assert.match(await del.textContent(), /DELETE/);

    // A deprecated row says so in its accessible name, not just by fading.
    const deprecated = page.locator('a.row.row--deprecated').first();
    assert.match(await deprecated.textContent(), /Deprecated/);

    // Selection is a bar, a tint and aria-current — all three.
    await page.locator('a.row').nth(1).click();
    await page.waitForTimeout(300);
    const selected = page.locator('a.row[aria-current="true"]');
    assert.equal(await selected.count(), 1);
    const style = await selected.evaluate((n) => {
      const computed = getComputedStyle(n);
      return { border: computed.borderLeftWidth, bg: computed.backgroundColor };
    });
    assert.notEqual(style.border, '0px');
    assert.notEqual(style.bg, 'rgba(0, 0, 0, 0)');

    // Required is a word.
    await showTab(page, 'body');
    const req = await page.locator('table.params tbody tr').first().locator('td').nth(1).textContent();
    assert.match(req, /^(yes|no)$/);
  } finally {
    await page.close();
  }
});

test('reduced motion is honoured', async () => {
  const page = await open(`#/op/post-v2-bookings?src=${SRC}`, { reducedMotion: 'reduce' });
  try {
    assert.equal(await page.locator('a.row').first().evaluate((n) => getComputedStyle(n).transitionDuration), '0s');
  } finally {
    await page.close();
  }
});

test('focus stays visible when the system takes over the colours', async () => {
  const page = await open(`#/op/post-v2-bookings?src=${SRC}`, { forcedColors: 'active' });
  try {
    await page.locator('a.row').nth(3).focus();
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth);
    // box-shadow is discarded in forced colours, so the ring must be an outline.
    assert.notEqual(outline, '0px');
  } finally {
    await page.close();
  }
});
