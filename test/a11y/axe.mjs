/**
 * axe-core over every screen and state the app can be in.
 *
 * A static scan cannot see the keyboard model or the live regions — those are
 * the other files here — but it catches the whole class of things that are
 * simply wrong in the markup, on every screen rather than on the one being
 * worked on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, violations, SRC } from './lib/harness.mjs';

const SCREENS = [
  ['the import screen', async () => open('')],
  ['the parse report', async () => {
    const page = await open('');
    await page.getByRole('button', { name: /bundled example/i }).click();
    await page.waitForTimeout(900);
    return page;
  }],
  ['the dense browser', async () => open()],
  ['the roomy browser', async () => {
    const page = await open();
    await page.evaluate(() => window.__aw.actions.setDensity('roomy'));
    await page.waitForTimeout(400);
    return page;
  }],
  ['the browser in dark', async () => open(`#/op/post-v2-bookings?src=${SRC}`, { colorScheme: 'dark' })],
  ['a component schema', async () => open(`#/schema/Booking?src=${SRC}`)],
  ['the command palette', async () => {
    const page = await open();
    await page.keyboard.press('Control+k');
    await page.keyboard.type('book');
    await page.waitForTimeout(400);
    return page;
  }],
  ['the auth sheet', async () => {
    const page = await open();
    await page.getByRole('button', { name: 'Authorise' }).click();
    await page.waitForTimeout(400);
    return page;
  }],
  ['the settings panel', async () => {
    const page = await open();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.waitForTimeout(400);
    return page;
  }],
  ['the detail on a phone', async () => open(`#/op/post-v2-bookings?src=${SRC}`, { viewport: { width: 390, height: 720 } })],
];

for (const [label, setup] of SCREENS) {
  test(`axe finds nothing to fix on ${label}`, async () => {
    const page = await setup();
    try {
      assert.deepEqual(await violations(page), []);
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
  });
}
