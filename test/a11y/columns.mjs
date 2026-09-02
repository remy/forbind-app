/**
 * Folding a column away, and finding the way back.
 *
 * The two column toggles are disclosures, so the checks are the ones a
 * disclosure has to pass: the state is in `aria-expanded` rather than in the
 * fill, the control that hid something stays on screen, focus never falls into
 * the hidden column or onto the body, and every route back — the button, the
 * shortcut, the palette, the skip link — actually arrives.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, violations, SRC } from './lib/harness.mjs';

test('each column toggle is a disclosure that says which way round it is', async () => {
  const page = await open();
  try {
    const rail = page.locator('#toggle-rail');
    const list = page.locator('#toggle-list');

    assert.equal(await rail.getAttribute('aria-expanded'), 'true');
    assert.equal(await rail.getAttribute('aria-controls'), 'tag-nav');
    assert.equal(await list.getAttribute('aria-controls'), 'endpoint-list');
    // The name is the column, not the verb: the state is in aria-expanded.
    assert.match(await rail.getAttribute('aria-label') ?? await rail.textContent(), /Tag rail/);

    await rail.click();
    await page.waitForTimeout(200);
    assert.equal(await rail.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('#tag-nav').isVisible(), false);
    // The control that hid it is still there, and still focused.
    assert.equal(await page.evaluate(() => document.activeElement.id), 'toggle-rail');

    await rail.click();
    await page.waitForTimeout(200);
    assert.equal(await rail.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#tag-nav').isVisible(), true);

    await list.click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#endpoint-list').isVisible(), false);
    assert.equal(await page.locator('#detail').isVisible(), true);
    assert.deepEqual(page.problems, []);
  } finally {
    await page.close();
  }
});

test('a folded column is not carried by colour alone', async () => {
  const page = await open();
  try {
    const list = page.locator('#toggle-list');
    const read = () => list.evaluate((node) => ({
      expanded: node.getAttribute('aria-expanded'),
      caret: node.firstElementChild.textContent,
      background: getComputedStyle(node).backgroundColor,
    }));

    const before = await read();
    await list.click();
    await page.waitForTimeout(200);
    const after = await read();

    assert.notEqual(before.expanded, after.expanded, 'aria-expanded did not change');
    assert.notEqual(before.caret, after.caret, 'the caret did not turn');
    assert.notEqual(before.background, after.background);
  } finally {
    await page.close();
  }
});

test('folding a column away does not drop focus to the body', async () => {
  const page = await open();
  try {
    // Focus a row, then maximise from the keyboard: the row is about to stop
    // being focusable, so focus has to be put somewhere real.
    await page.locator('a.row').nth(2).focus();
    await page.keyboard.press('Control+Shift+m');
    await page.waitForTimeout(300);

    const active = await page.evaluate(() => ({
      id: document.activeElement.id,
      tag: document.activeElement.tagName,
      visible: document.activeElement.getClientRects().length > 0,
    }));
    assert.notEqual(active.tag, 'BODY');
    assert.equal(active.visible, true);
    assert.equal(await page.locator('#endpoint-list').isVisible(), false);
    assert.equal(await page.locator('#tag-nav').isVisible(), false);

    // And back, in one step.
    await page.keyboard.press('Control+Shift+m');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#endpoint-list').isVisible(), true);
    assert.equal(await page.locator('#tag-nav').isVisible(), true);
  } finally {
    await page.close();
  }
});

test('folding the rail hands the tags to the chip row that stands in for it', async () => {
  const page = await open();
  try {
    assert.equal(await page.locator('#tag-chips').count(), 0, 'chips beside the rail');

    await page.locator('#toggle-rail').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#tag-chips').isVisible(), true);

    // The tags skip link lands on whichever of them is on screen, so with the
    // chips standing in it must not undo the fold to reach the rail.
    await page.getByRole('link', { name: /skip to tags and filters/i }).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tag-chips');
    assert.equal(await page.locator('#toggle-rail').getAttribute('aria-expanded'), 'false');
  } finally {
    await page.close();
  }
});

test('the skip link unfolds the column it lands in', async () => {
  const page = await open();
  try {
    await page.locator('#toggle-list').click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#endpoint-list').isVisible(), false);

    const link = page.getByRole('link', { name: /skip to the endpoint list/i });
    await link.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    assert.equal(await page.locator('#endpoint-list').isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'endpoint-list');
    // The route is untouched: the operation that was open is still open.
    assert.match(page.url(), /post-v2-bookings/);
  } finally {
    await page.close();
  }
});

test('a shortcut that needs the list brings it back rather than failing quietly', async () => {
  const page = await open();
  try {
    await page.locator('#toggle-list').click();
    await page.waitForTimeout(200);
    await page.keyboard.press('/');
    await page.waitForTimeout(200);
    // Down from the search field moves into the list, which is not on screen.
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);

    assert.equal(await page.locator('#endpoint-list').isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'row');
  } finally {
    await page.close();
  }
});

test('the fold is remembered, and comes back folded', async () => {
  const page = await open();
  try {
    await page.locator('#toggle-list').click();
    await page.waitForTimeout(200);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1400);

    assert.equal(await page.locator('#endpoint-list').isVisible(), false);
    assert.equal(await page.locator('#toggle-list').getAttribute('aria-expanded'), 'false');
  } finally {
    await page.close();
  }
});

test('a phone keeps its list whatever the preference says', async () => {
  const page = await open();
  try {
    await page.locator('#toggle-list').click();
    await page.waitForTimeout(200);
    await page.setViewportSize({ width: 380, height: 720 });
    await page.waitForTimeout(400);

    // The detail is a pushed page here, so the list is a page of its own and
    // folding it away would leave nothing to navigate from.
    await page.evaluate(() => window.__fb.actions.backToList());
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#endpoint-list').isVisible(), true);
    assert.equal(await page.locator('#toggle-list').count(), 0, 'a toggle for a column that cannot fold');
  } finally {
    await page.close();
  }
});

test('axe finds nothing to fix with the columns folded away', async () => {
  const page = await open(`#/op/post-v2-bookings?src=${SRC}`);
  try {
    await page.keyboard.press('Control+Shift+m');
    await page.waitForTimeout(400);
    const found = await violations(page);
    assert.deepEqual(found, [], found.join('\n'));
  } finally {
    await page.close();
  }
});
