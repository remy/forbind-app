/**
 * The live regions, and the announcements that have to reach them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, showTab } from './lib/harness.mjs';

test('the live regions exist from first paint and carry the announcements', async () => {
  const page = await open('');
  try {
    assert.equal(await page.locator('#fb-live-polite[aria-live="polite"]').count(), 1);
    assert.equal(await page.locator('#fb-live-assertive[role="alert"]').count(), 1);

    await page.getByRole('button', { name: /bundled example/i }).click();
    await page.waitForTimeout(900);
    assert.match(await page.locator('#fb-live-polite').textContent(), /47 endpoints, 6 tags, 9 schemas/);
  } finally {
    await page.close();
  }
});

test('copying announces what was copied, not just a changed label', async () => {
  const page = await open();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  try {
    await showTab(page, 'code');
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await page.waitForTimeout(300);
    assert.match(await page.locator('#fb-live-polite').textContent(), /curl command copied, 5 lines/);
    assert.match(await page.locator('.codeblock__copy').textContent(), /Copied/);
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('.codeblock__copy').textContent(), 'Copy');
  } finally {
    await page.close();
  }
});
