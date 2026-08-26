/**
 * The frame: which things scroll, and what happens to the layout at 320px, at
 * 400% zoom, and on a phone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, SRC } from './lib/harness.mjs';

test('the panes scroll inside the window rather than the page scrolling', async () => {
  // Measured with a real wheel gesture: `documentElement.scrollHeight` reports
  // a scrollable document here even when nothing can move, so the honest test
  // is whether the banner stays put while the list underneath it travels.
  for (const density of ['dense', 'roomy']) {
    const page = await open(`#/op/post-v2-bookings?src=${SRC}`, { viewport: { width: 1280, height: 700 } });
    try {
      await page.evaluate((d) => window.__aw.actions.setDensity(d), density);
      await page.waitForTimeout(600);

      const bannerTop = () => page.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().top);
      const listTop = () => page.evaluate(() => document.querySelector('.list-scroll').scrollTop);
      const listBox = await page.locator('.list-scroll').boundingBox();

      assert.equal(await bannerTop(), 0);
      assert.equal(await listTop(), 0);

      await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(300);

      assert.ok(await listTop() > 0, `${density}: the list did not scroll inside its pane`);
      assert.equal(await bannerTop(), 0, `${density}: the whole page scrolled`);

      // The hint bar is pinned to the bottom of the pane, not pushed off screen.
      const hint = await page.locator('.hintbar').boundingBox();
      const viewportHeight = page.viewportSize().height;
      assert.ok(hint.y + hint.height <= viewportHeight + 1, `${density}: the hint bar fell off the bottom`);
    } finally {
      await page.close();
    }
  }
});

test('a long detail pane scrolls without taking the list with it', async () => {
  const page = await open(`#/op/post-v2-bookings?src=${SRC}`, { viewport: { width: 1280, height: 700 } });
  try {
    const detail = await page.locator('.pane--detail').boundingBox();
    const listTop = () => page.evaluate(() => document.querySelector('.list-scroll').scrollTop);
    const detailTop = () => page.evaluate(() => document.querySelector('.pane--detail').scrollTop);

    await page.mouse.move(detail.x + detail.width / 2, detail.y + detail.height / 2);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(300);

    assert.ok(await detailTop() > 0, 'the detail pane did not scroll');
    assert.equal(await listTop(), 0, 'scrolling the detail moved the list too');
    assert.equal(await page.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().top), 0);
  } finally {
    await page.close();
  }
});

test('a phone keeps ordinary page scrolling', async () => {
  const page = await open(`#/?src=${SRC}`, { viewport: { width: 390, height: 720 } });
  try {
    const bannerTop = () => page.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().top);
    assert.equal(await bannerTop(), 0);
    await page.mouse.move(195, 500);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(300);
    assert.ok(await bannerTop() < 0, 'the phone layout stopped scrolling as a page');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1),
      false,
    );
  } finally {
    await page.close();
  }
});

/* --- reflow -------------------------------------------------------------- */

for (const [label, viewport] of [
  ['320px', { width: 320, height: 640 }],
  ['200% zoom', { width: 640, height: 400, deviceScaleFactor: 2 }],
  ['400% zoom', { width: 320, height: 200, deviceScaleFactor: 4 }],
]) {
  test(`the page reflows without horizontal scroll at ${label}`, async () => {
    const page = await open(`#/op/post-v2-bookings?src=${SRC}`, { viewport });
    try {
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      assert.ok(scrollWidth <= clientWidth + 1, `${scrollWidth} > ${clientWidth}`);
    } finally {
      await page.close();
    }
  });
}
