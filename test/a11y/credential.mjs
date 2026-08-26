/**
 * The promises made about the credential and the stored schema, checked in a
 * real browser against real storage and a real clipboard.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, BASE } from './lib/harness.mjs';

test('a saved credential reaches the clipboard from nowhere, and disk only if asked', async () => {
  const page = await open();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const SECRET = 'a-real-secret-token-value-4f2a';
  try {
    await page.getByRole('button', { name: 'Authorise' }).click();
    await page.waitForTimeout(400);
    await page.fill('#auth-credential', `Bearer ${SECRET}`);
    await page.getByRole('button', { name: 'Save for this session' }).click();
    await page.waitForTimeout(400);

    // It is held, and the prefix was stripped as the help text promises.
    assert.equal(await page.evaluate(() => window.__aw.store.state.auth.credential), SECRET);

    // The default is this tab only: sessionStorage, never disk, never a cookie.
    const stored = () => page.evaluate(() => ({
      local: JSON.stringify({ ...localStorage }),
      session: JSON.stringify({ ...sessionStorage }),
      cookie: document.cookie,
    }));
    let where = await stored();
    assert.ok(where.session.includes(SECRET), 'the credential did not survive a reload of this tab');
    assert.ok(!where.local.includes(SECRET), 'the credential reached disk without being asked to');
    assert.ok(!where.cookie.includes(SECRET), 'the credential reached a cookie');

    // Asking for it moves it to disk, and takes the session copy with it.
    await page.getByRole('checkbox', { name: /Remember on this device/ }).check();
    await page.waitForTimeout(400);
    where = await stored();
    assert.ok(where.local.includes(SECRET), '"remember" did not remember');
    assert.ok(!where.session.includes(SECRET), 'the session copy was left behind');

    // Either way, it never reaches a snippet.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await page.waitForTimeout(300);
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(!clipboard.includes(SECRET), 'the credential reached the clipboard');
    assert.match(clipboard, /\$TOKEN/);

    // Forgetting clears both stores.
    await page.getByRole('button', { name: 'Authorise' }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Forget' }).click();
    await page.waitForTimeout(400);
    where = await stored();
    assert.ok(!`${where.local}${where.session}`.includes(SECRET), 'a forgotten credential was still on disk');
  } finally {
    await page.close();
  }
});

test('a reload comes back to the schema that was loaded', async () => {
  const page = await open();
  try {
    assert.equal(await page.evaluate(() => window.__aw.store.state.schema.sourceName), 'bookings-api.v2.yaml');
    // Straight to the bare URL: no `src`, so only what was remembered can help.
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__aw?.store.state.schemaState === 'ready', null, { timeout: 15000 });
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => window.__aw.store.state.schema.sourceName), 'bookings-api.v2.yaml');
    assert.equal(await page.evaluate(() => window.__aw.store.state.browsing), true);
    assert.ok(await page.locator('a.row').count() > 0);

    // Replacing it forgets it, so the next visit starts at the import screen.
    await page.getByRole('button', { name: 'Replace schema' }).click();
    await page.waitForTimeout(500);
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => window.__aw.store.state.schemaState), 'idle');
    assert.match(await page.locator('h1').first().textContent(), /Load an OpenAPI schema/);
  } finally {
    await page.close();
  }
});
