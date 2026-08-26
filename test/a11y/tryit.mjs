/**
 * The try-it panel: a real form, real validation, and a result that says what
 * happened — including when the browser refuses to let it be read.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, LOCAL } from './lib/harness.mjs';

test('an enum parameter is a dropdown, and Enter in the form sends', async () => {
  const page = await open();
  try {
    // Give the operation an enum parameter to render.
    await page.evaluate(() => {
      const op = window.__aw.store.state.schema.operations.find((o) => o.path === '/v2/bookings' && o.method === 'GET');
      window.__aw.actions.selectOperation(op.id);
    });
    await page.waitForTimeout(600);

    const status = page.locator('aw-try-it select').filter({ hasText: 'confirmed' }).first();
    assert.ok(await page.locator('aw-try-it select').count() > 0, 'no enum parameter rendered as a select');
    assert.ok(await status.count() > 0);
    // Optional, so "not sent" has to be reachable and is where it starts.
    const options = await status.locator('option').allTextContents();
    assert.match(options[0], /not sent/);
    assert.equal(await status.inputValue(), '');
    assert.deepEqual(options.slice(1), ['held', 'pending', 'confirmed', 'cancelled']);

    // The form submits on Enter, from a field rather than the button.
    assert.equal(await page.locator('aw-try-it form').count(), 1);
    assert.equal(await page.locator('aw-try-it button[type="submit"]').count(), 1);
    await status.selectOption('confirmed');
    await page.waitForTimeout(200);
    assert.match(await page.locator('.tryit__status').textContent(), /status=confirmed/);
    await status.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
    // It will fail on CORS against a host that does not exist, which still
    // proves Enter reached the sender.
    assert.equal(await page.locator('aw-try-it .result').count(), 1);
  } finally {
    await page.close();
  }
});

test('a required parameter left empty stops the send and says which one', async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      const op = window.__aw.store.state.schema.operations.find((o) => o.path === '/v2/bookings/{bookingId}' && o.method === 'GET');
      window.__aw.actions.selectOperation(op.id);
    });
    await page.waitForTimeout(600);

    const field = page.locator('aw-try-it input').first();
    await field.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    assert.equal(await page.locator('aw-try-it .result').count(), 0, 'an incomplete request was sent anyway');
    const invalid = page.locator('aw-try-it [aria-invalid="true"]');
    assert.equal(await invalid.count(), 1);
    // The message is tied to the field and led by a word, not a colour.
    const describedBy = await invalid.getAttribute('aria-describedby');
    assert.match(describedBy, /-error$/);
    const message = await page.locator(`#${(await invalid.getAttribute('id'))}-error`).textContent();
    assert.match(message, /^NEEDED/);
    assert.match(message, /bookingId needs a value/);
    assert.match(await page.locator('#aw-live-assertive').textContent(), /Cannot send: bookingId is required/);
    // Focus is on the field being complained about.
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-invalid')), 'true');

    // Typing clears it rather than leaving a stale complaint on screen.
    await page.keyboard.type('01J8QW');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('aw-try-it [aria-invalid="true"]').count(), 0);
    assert.equal(await page.locator('aw-try-it .hint--error').count(), 0);
  } finally {
    await page.close();
  }
});

test('a request that succeeds reports its status, timing and readable headers', async () => {
  const page = await open(`#/?src=${LOCAL}`);
  try {
    await page.locator('a.row').first().click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /^Send GET$/ }).click();
    await page.waitForTimeout(1500);
    assert.match(await page.locator('.result__head').textContent(), /200/);
    assert.match(await page.locator('#aw-live-polite').textContent(), /200 OK in \d+ milliseconds/);
    assert.ok(await page.locator('.result .kv > div').count() > 0);
  } finally {
    await page.close();
  }
});

test('a request the browser cannot read explains CORS rather than shrugging', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: /^Send POST$/ }).click();
    await page.waitForTimeout(4000);
    const text = await page.locator('.result--error').textContent();
    assert.match(text, /Access-Control-Allow-Origin/);
    assert.match(text, /unreachable/);
    assert.match(await page.locator('#aw-live-assertive').textContent(), /Request failed/);
  } finally {
    await page.close();
  }
});
