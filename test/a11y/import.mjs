/**
 * The import screen: the name on it, the footer under it, and a fetch that
 * failed.
 *
 * A failed fetch is the one place on this screen where the form is rebuilt
 * under the reader. These checks are that the rebuild costs nothing: the
 * address is still in the field, the keyboard is still in the field, and the
 * heading over the problem counts what is actually listed rather than always
 * claiming one thing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, violations } from './lib/harness.mjs';

const MISSING = '/test/fixtures/there-is-no-such-schema.yaml';

/** Ask for a URL that cannot be fetched, and wait for the form to come back. */
async function failedFetch(page, url = MISSING) {
  await page.locator('#schema-url').fill(url);
  await page.getByRole('button', { name: 'Fetch' }).click();
  await page.waitForFunction(
    () => window.__fb?.store.state.schemaState === 'error',
    null,
    { timeout: 15000 },
  );
  await page.waitForTimeout(300);
}

test('the landing page is the mark and the name, and says what it is in the footer', async () => {
  const page = await open('');
  try {
    const heading = await page.getByRole('heading', { level: 1 }).first();
    assert.match((await heading.textContent()).trim(), /^Forbind$/);
    // The mark is decoration beside the word, so it says nothing of its own.
    assert.equal(await heading.locator('svg[aria-hidden="true"]').count(), 1);

    // A real `contentinfo` landmark, which means a footer that is not nested
    // inside `<main>`.
    const foot = page.getByRole('contentinfo');
    assert.equal(await foot.count(), 1);
    assert.match(
      await foot.textContent(),
      /Accessibility centred API browser developed using LLMs guided and checked by Remy Sharp/,
    );
    assert.equal(
      await foot.getByRole('link', { name: 'Remy Sharp' }).getAttribute('href'),
      'https://remysharp.com',
    );
    assert.equal(await page.locator('main footer').count(), 0);

    assert.deepEqual(page.problems, []);
  } finally {
    await page.close();
  }
});

test('a URL that cannot be fetched is still in the field, with the caret in it', async () => {
  const page = await open('');
  try {
    await failedFetch(page);

    assert.equal(await page.locator('#schema-url').inputValue(), MISSING);
    // The button that started the fetch no longer exists; focus must not have
    // gone to the body with it.
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'schema-url');

    // And the retry is a plain edit away, with no retyping.
    await page.keyboard.press('Backspace');
    assert.equal(await page.locator('#schema-url').inputValue(), MISSING.slice(0, -1));

    assert.deepEqual(page.problems, []);
  } finally {
    await page.close();
  }
});

test('the heading over a failure names the list rather than counting it', async () => {
  const page = await open('');
  try {
    await failedFetch(page);

    assert.ok(await page.locator('.notes li').count() > 0, 'the failure listed nothing');
    const heading = await page.locator('.import .detail__section .label').first().textContent();
    assert.equal(heading.trim(), 'Worth knowing');
    // Whatever it says, it must not claim a number the list does not have.
    assert.doesNotMatch(heading, /\d/);

    assert.deepEqual(await violations(page), []);
  } finally {
    await page.close();
  }
});

test('a schema that parses clears the address it was fetched from', async () => {
  const page = await open('');
  try {
    await failedFetch(page);
    await page.locator('#schema-url').fill('/samples/bookings-api.v2.yaml');
    await page.getByRole('button', { name: 'Fetch' }).click();
    await page.waitForFunction(
      () => window.__fb?.store.state.schemaState === 'ready',
      null,
      { timeout: 15000 },
    );

    assert.equal(await page.evaluate(() => window.__fb.store.state.importUrl), '');
  } finally {
    await page.close();
  }
});
