/**
 * The try-it panel: a real form, real validation, and a result that says what
 * happened — including when the browser refuses to let it be read.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, showTab, violations, confirmSend, LOCAL } from './lib/harness.mjs';

const REF_ENUM = '/test/fixtures/ref-enum.yaml';

test('an enum parameter is a dropdown, and Enter in the form sends', async () => {
  const page = await open();
  try {
    // Give the operation an enum parameter to render.
    await page.evaluate(() => {
      const op = window.__aw.store.state.schema.operations.find((o) => o.path === '/v2/bookings' && o.method === 'GET');
      window.__aw.actions.selectOperation(op.id);
    });
    await page.waitForTimeout(600);
    await showTab(page, 'tryit');

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
    await showTab(page, 'tryit');

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
    await showTab(page, 'tryit');
    await page.getByRole('button', { name: /^Send GET$/ }).click();
    await page.waitForTimeout(1500);
    assert.match(await page.locator('.result__head').textContent(), /200/);
    assert.match(await page.locator('#aw-live-polite').textContent(), /200 OK in \d+ milliseconds/);
    assert.ok(await page.locator('.result .kv > div').count() > 0);
  } finally {
    await page.close();
  }
});

test('a big response lands on its status line, not somewhere down its body', async () => {
  const page = await open(`#/?src=${LOCAL}`);
  try {
    await page.locator('a.row').first().click();
    await page.waitForTimeout(400);
    await showTab(page, 'tryit');
    await page.getByRole('button', { name: /^Send GET$/ }).click();
    await page.waitForTimeout(1500);

    // The fixture fetches the bundled sample, so the body is far taller than
    // the pane — the case where "scroll it into view" stops meaning anything.
    const geometry = await page.evaluate(() => {
      const pane = document.querySelector('.pane--detail');
      const result = document.querySelector('.result');
      const head = document.querySelector('.result__head');
      return {
        paneHeight: pane.clientHeight,
        resultHeight: Math.round(result.getBoundingClientRect().height),
        headOffset: Math.round(head.getBoundingClientRect().top - pane.getBoundingClientRect().top),
        focused: document.activeElement?.className,
      };
    });
    assert.ok(
      geometry.resultHeight > geometry.paneHeight * 3,
      `the fixture response was not tall enough to test this (${geometry.resultHeight}px)`,
    );
    assert.ok(
      Math.abs(geometry.headOffset) <= 4,
      `the status line landed ${geometry.headOffset}px from the top of the pane`,
    );
    // Still the thing the keyboard is on, so the next Tab is inside the result.
    assert.equal(geometry.focused, 'result');
  } finally {
    await page.close();
  }
});

test('a response that came back can be copied, and says what was copied', async () => {
  const page = await open(`#/?src=${LOCAL}`);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  try {
    await page.locator('a.row').first().click();
    await page.waitForTimeout(400);
    await showTab(page, 'tryit');
    // Nothing to copy until there is a response.
    assert.equal(await page.getByRole('button', { name: /Copy response/ }).count(), 0);

    await page.getByRole('button', { name: /^Send GET$/ }).click();
    await page.waitForTimeout(1500);

    const copy = page.getByRole('button', { name: 'Copy response' });
    assert.equal(await copy.count(), 1);
    await copy.click();
    await page.waitForTimeout(300);

    // What landed on the clipboard is what is on screen, not a re-serialising
    // of it, and the confirmation is spoken as well as drawn on the button.
    const pasted = await page.evaluate(() => navigator.clipboard.readText());
    const shown = await page.locator('.result .code-block').first().textContent();
    assert.equal(pasted, shown);
    assert.match(await page.locator('#aw-live-polite').textContent(), /Response body copied, \d+ lines?\./);
    assert.match(await page.getByRole('button', { name: /Copied/ }).textContent(), /Copied/);

    // And the label goes back, so the button does not lie about the next press.
    await page.waitForTimeout(2200);
    assert.equal(await page.getByRole('button', { name: 'Copy response' }).count(), 1);
    assert.deepEqual(await violations(page), []);
  } finally {
    await page.close();
  }
});

test('a request the browser cannot read explains CORS rather than shrugging', async () => {
  const page = await open();
  try {
    await showTab(page, 'tryit');
    await page.getByRole('button', { name: /^Send POST$/ }).click();
    await confirmSend(page);
    await page.waitForTimeout(4000);
    const text = await page.locator('.result--error').textContent();
    assert.match(text, /Access-Control-Allow-Origin/);
    assert.match(text, /unreachable/);
    assert.match(await page.locator('#aw-live-assertive').textContent(), /Request failed/);
  } finally {
    await page.close();
  }
});

test('an enum named elsewhere in the document is still a dropdown, not a text box', async () => {
  const page = await open(`#/?src=${REF_ENUM}`);
  try {
    await page.evaluate(() => {
      window.__aw.actions.selectOperation(window.__aw.store.state.schema.operations[0].id);
    });
    await page.waitForTimeout(600);
    await showTab(page, 'tryit');

    // Behind a $ref, and behind an allOf wrapper: both are the same promise.
    const sort = page.getByLabel(/^sort/);
    const group = page.getByLabel(/^group/);
    assert.equal(await sort.evaluate((node) => node.tagName), 'SELECT');
    assert.equal(await group.evaluate((node) => node.tagName), 'SELECT');

    const options = await sort.locator('option').allTextContents();
    assert.equal(options.length, 11, `expected the 11 declared values, got ${options.join(', ')}`);
    assert.deepEqual(options.slice(0, 3), ['title', 'artist', 'albumartist']);
    // Required, so it opens on a value the document allows rather than blank.
    assert.equal(await sort.inputValue(), 'title');
    // Optional, so not sending it stays possible and is named.
    assert.match((await group.locator('option').allTextContents())[0], /not sent/);
    assert.equal(await group.inputValue(), '');

    // The values are in the control now, so the hint does not repeat them.
    const hint = await page.locator('.field-row', { has: page.getByLabel(/^sort/) }).locator('.hint').first().textContent();
    assert.ok(!/one of/.test(hint), `the hint still lists the values: ${hint}`);

    await sort.selectOption('composer');
    await page.waitForTimeout(200);
    assert.match(await page.locator('.tryit__status').textContent(), /sort=composer/);
    assert.deepEqual(page.problems, []);
  } finally {
    await page.close();
  }
});

test('a request that changes something is confirmed before it is sent', async () => {
  // 3.3.6: a real POST cannot be taken back from here, so it gets a question
  // first. Escape has to mean no, and the keyboard has to end up back where
  // it started.
  const page = await open();
  try {
    await showTab(page, 'tryit');
    await page.getByRole('button', { name: /^Send POST$/ }).click();
    await page.waitForTimeout(300);

    const dialog = page.locator('dialog.confirm');
    assert.equal(await dialog.count(), 1, 'a POST went out without being confirmed');
    assert.equal(await dialog.getAttribute('role'), 'alertdialog');
    // Named and described by its own content, not by a bare label.
    const [labelledBy, describedBy] = await dialog.evaluate((d) => [
      d.querySelector(`#${d.getAttribute('aria-labelledby')}`)?.textContent,
      d.querySelector(`#${d.getAttribute('aria-describedby')}`)?.textContent,
    ]);
    assert.match(labelledBy, /Send this POST\?/);
    assert.match(describedBy, /not a sandbox/);

    // It opens on the answer that changes nothing.
    assert.equal(await page.evaluate(() => document.activeElement.dataset.answer), 'no');
    assert.deepEqual(await violations(page), []);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    assert.equal(await dialog.count(), 0);
    assert.equal(await page.locator('aw-try-it .result').count(), 0, 'Escape sent the request anyway');
    assert.match(await page.locator('#aw-live-polite').textContent(), /Nothing sent/);
    // And focus is back on the button that asked.
    assert.equal(await page.evaluate(() => document.activeElement.dataset.focusKey), 'tryit-send');

    // Confirming goes through — it fails on CORS against a host that is not
    // there, which is still proof the send happened.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await confirmSend(page);
    await page.waitForTimeout(4000);
    assert.equal(await page.locator('aw-try-it .result').count(), 1);
  } finally {
    await page.close();
  }
});

test('a request that only reads is not confirmed', async () => {
  // The question is the point; asking it about a GET would train people to
  // dismiss it without reading.
  const page = await open(`#/?src=${LOCAL}`);
  try {
    await page.locator('a.row').first().click();
    await page.waitForTimeout(400);
    await showTab(page, 'tryit');
    await page.getByRole('button', { name: /^Send GET$/ }).click();
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('dialog.confirm').count(), 0);
    assert.match(await page.locator('.result__head').textContent(), /200/);
  } finally {
    await page.close();
  }
});

test('what has been typed survives leaving the tab and coming back', async () => {
  // The panel is rebuilt on every render of the detail pane. Rebuilding it
  // with an empty form throws away work nobody asked to lose; Reset is the
  // control for that, and it is a button.
  const page = await open();
  try {
    await showTab(page, 'tryit');
    const body = page.locator('aw-try-it textarea').first();
    await body.fill('{"typed": "by hand"}');
    await page.waitForTimeout(200);

    await showTab(page, 'overview');
    await showTab(page, 'tryit');
    assert.equal(await body.inputValue(), '{"typed": "by hand"}', 'the tab round trip emptied the form');

    // Reset is how you ask for an empty form, and it says so out loud.
    await page.getByRole('button', { name: 'Reset' }).click();
    await page.waitForTimeout(200);
    assert.notEqual(await body.inputValue(), '{"typed": "by hand"}');
    assert.match(await page.locator('#aw-live-polite').textContent(), /reset/i);
  } finally {
    await page.close();
  }
});

test('the phone\'s sticky action opens the Try it tab', async () => {
  const page = await open(`#/?src=${LOCAL}`, { viewport: { width: 390, height: 780 } });
  try {
    await page.locator('a.row').first().click();
    await page.waitForTimeout(500);

    const action = page.locator('.sticky-action button');
    assert.equal(await action.count(), 1, 'no sticky action on a phone viewport');
    await action.click();
    await page.waitForTimeout(500);

    assert.equal(await page.locator('aw-try-it form').count(), 1, 'the sticky action did not open Try it');
    assert.equal(
      await page.locator('[role="tab"][aria-selected="true"]').textContent(),
      'Try it',
    );
    // And it lands the keyboard in the panel it opened.
    assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('aw-try-it'))), true);
    assert.deepEqual(await violations(page), []);
  } finally {
    await page.close();
  }
});
