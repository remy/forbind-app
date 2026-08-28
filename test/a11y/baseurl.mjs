/**
 * The base URL a schema does not declare.
 *
 * A document with no `servers` block is missing the half of the address that
 * only the reader knows. These checks are that the gap is stated rather than
 * discovered at send time, that filling it is a labelled field and not a
 * modal, that refusing a bad value says why out loud, and that browsing
 * without one is still a first-class way through.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, showTab, violations } from './lib/harness.mjs';

const NO_SERVER = '/test/fixtures/no-server.yaml';

/** Load the fixture the long way round, so the parse report is on screen. */
async function openReport() {
  const page = await open('');
  await page.locator('#schema-url').fill(NO_SERVER);
  await page.getByRole('button', { name: 'Fetch' }).click();
  await page.waitForTimeout(1200);
  return page;
}

test('the parse report names the missing server and offers a field for it', async () => {
  const page = await openReport();
  try {
    const notes = await page.locator('.notes li').allTextContents();
    assert.ok(
      notes.some((line) => /WARN/.test(line) && /declares no server URL/.test(line)),
      `the report did not warn about the server: ${notes.join(' | ')}`,
    );

    // A real heading and a real label, not a placeholder doing the work.
    assert.equal(await page.getByRole('heading', { name: /needs a base URL/i }).count(), 1);
    const field = page.getByRole('textbox', { name: 'Base URL' });
    assert.equal(await field.count(), 1);
    assert.equal(await field.getAttribute('aria-invalid'), null);

    // Browsing without one is still right there, and still the filled button.
    const browse = page.getByRole('button', { name: /Browse 2 endpoints/ });
    assert.equal(await browse.count(), 1);
    assert.match(await browse.getAttribute('class'), /btn--filled/);

    assert.deepEqual(await violations(page), []);
    assert.deepEqual(page.problems, []);
  } finally {
    await page.close();
  }
});

test('a base URL that is not one is refused out loud, with focus left on the field', async () => {
  const page = await openReport();
  try {
    const field = page.getByRole('textbox', { name: 'Base URL' });
    await field.fill('ftp://files.example.com');
    await field.press('Enter');
    await page.waitForTimeout(400);

    assert.equal(await field.getAttribute('aria-invalid'), 'true');
    assert.match(await page.locator('#aw-live-assertive').textContent(), /http or https/);
    // The reason is tied to the field, not just floating beside it.
    const describedBy = await field.getAttribute('aria-describedby');
    const errorId = describedBy.split(' ')[0];
    assert.match(await page.locator(`#${errorId}`).textContent(), /http or https/);
    assert.equal(await page.evaluate(() => document.activeElement?.id), await field.getAttribute('id'));

    assert.deepEqual(await violations(page), []);
  } finally {
    await page.close();
  }
});

test('a base URL that is accepted is announced, and can be changed or cleared', async () => {
  const page = await openReport();
  try {
    const field = page.getByRole('textbox', { name: 'Base URL' });
    await field.fill('api.example.com');
    await page.getByRole('button', { name: 'Use this' }).click();
    await page.waitForTimeout(400);

    assert.match(await page.locator('#aw-live-polite').textContent(), /Base URL set to https:\/\/api\.example\.com/);
    assert.equal(await field.getAttribute('aria-invalid'), null);
    // The keyboard is left on the control that was pressed, not on the body.
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.focusKey), 'baseurl-apply');
    assert.equal(await page.getByRole('button', { name: /Clear the base URL/ }).count(), 1);
    assert.equal(await page.evaluate(() => window.__aw.store.state.baseUrl), 'https://api.example.com');

    assert.deepEqual(await violations(page), []);
  } finally {
    await page.close();
  }
});

test('the base URL reaches the snippet and the try-it panel', async () => {
  const page = await openReport();
  try {
    await page.getByRole('textbox', { name: 'Base URL' }).fill('https://api.example.com');
    await page.getByRole('button', { name: 'Use this' }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /Browse 2 endpoints/ }).click();
    await page.waitForTimeout(800);

    await showTab(page, 'code');
    assert.match(await page.locator('.code-block').textContent(), /https:\/\/api\.example\.com\/notes/);

    await showTab(page, 'tryit');
    assert.match(await page.locator('.tryit__status').textContent(), /https:\/\/api\.example\.com\/notes/);
    assert.deepEqual(page.problems, []);
  } finally {
    await page.close();
  }
});

test('try-it asks for the base URL itself, and keeps focus when one arrives', async () => {
  const page = await open(`#/?src=${NO_SERVER}`);
  try {
    // Straight to an operation: the report, and its warning, were never seen.
    await page.evaluate(() => {
      const op = window.__aw.store.state.schema.operations.find((o) => o.method === 'POST');
      window.__aw.actions.selectOperation(op.id);
    });
    await page.waitForTimeout(600);
    await showTab(page, 'tryit');

    // It was said on arrival rather than saved for the send button.
    assert.match(await page.locator('#aw-live-polite').textContent(), /No server URL is declared/);

    const field = page.locator('aw-try-it').getByRole('textbox', { name: 'Base URL' });
    assert.equal(await field.count(), 1);
    assert.match(await page.locator('[data-live-warning]').textContent(), /the declared server/);

    await field.fill('https://api.example.com');
    await field.press('Enter');
    await page.waitForTimeout(400);

    // The form around the field is patched, never rebuilt under the keyboard,
    // and the field itself stays for the operation it was answered on.
    assert.equal(await page.evaluate(() => document.activeElement?.closest('aw-base-url') !== null), true);
    assert.equal(await field.count(), 1);
    assert.match(await page.locator('.tryit__status').textContent(), /https:\/\/api\.example\.com\/notes/);
    assert.match(await page.locator('[data-live-warning]').textContent(), /a real POST to api\.example\.com/);

    assert.deepEqual(await violations(page), []);
    assert.deepEqual(page.problems, []);
  } finally {
    await page.close();
  }
});

test('the question is asked once, not on every operation opened after it', async () => {
  const page = await open(`#/?src=${NO_SERVER}`);
  try {
    await page.evaluate(() => {
      const op = window.__aw.store.state.schema.operations.find((o) => o.method === 'POST');
      window.__aw.actions.selectOperation(op.id);
    });
    await page.waitForTimeout(600);
    await showTab(page, 'tryit');
    await page.locator('aw-try-it').getByRole('textbox', { name: 'Base URL' }).fill('https://api.example.com');
    await page.getByRole('button', { name: 'Use this' }).click();
    await page.waitForTimeout(300);

    // The next operation is not asked a question that has been answered — on
    // screen it is clutter, and read aloud before every set of parameters it
    // is worse than clutter.
    await page.evaluate(() => {
      const op = window.__aw.store.state.schema.operations.find((o) => o.method === 'GET');
      window.__aw.actions.selectOperation(op.id);
    });
    await page.waitForTimeout(600);
    await showTab(page, 'tryit');
    assert.equal(await page.locator('aw-try-it .baseurl').count(), 0);
    // It still reaches the request that operation would send.
    assert.match(await page.locator('.tryit__status').textContent(), /https:\/\/api\.example\.com\/notes/);

    // And it is still changeable, in the one place it lives afterwards.
    await page.evaluate(() => window.__aw.actions.openOptions('base-url'));
    await page.waitForTimeout(400);
    const inSettings = page.locator('dialog[open]').getByRole('textbox', { name: 'Base URL' });
    assert.equal(await inSettings.count(), 1);
    assert.equal(await inSettings.inputValue(), 'https://api.example.com');
    // The command named the field, so the sheet opens on it.
    assert.equal(await page.evaluate(() => document.activeElement?.closest('aw-base-url') !== null), true);

    assert.deepEqual(await violations(page), []);
    assert.deepEqual(page.problems, []);
  } finally {
    await page.close();
  }
});

test('a schema that declares a server is never asked for a base URL', async () => {
  const page = await open();
  try {
    await showTab(page, 'tryit');
    assert.equal(await page.locator('aw-base-url .baseurl').count(), 0);
  } finally {
    await page.close();
  }
});
