/**
 * How hard the words are.
 *
 * WCAG 3.1.5 is a AAA criterion and the app is comfortably inside it overall,
 * so this suite does not try to score the whole interface. It guards the one
 * thing that actually went wrong: the panel that fires real, irreversible
 * requests carried the longest sentences in the product, and long sentences
 * are where a reader who is scanning loses the warning.
 *
 * Sentence length is the mechanism, so sentence length is what is measured —
 * a readability index computed here would only be a noisier way of saying the
 * same thing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, showTab, confirmSend, SRC } from './lib/harness.mjs';

/** @param {string} text @returns {{words: number, text: string}[]} */
function sentences(text) {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[a-z]{3}/i.test(s))
    .map((s) => ({ text: s, words: s.split(/\s+/).filter(Boolean).length }));
}

const LIMIT = 25;

test('the panel that sends real requests keeps its sentences short', async () => {
  // A DELETE here is not undoable, so the warning around it has to survive
  // being skimmed.
  const page = await open(`#/op/delete-v2-bookings-booking-id?src=${SRC}`);
  try {
    await showTab(page, 'tryit');
    const text = await page.locator('[role="tabpanel"]').innerText();
    assert.match(text, /LIVE/, 'the mutating-verb warning was not on screen to measure');

    const worst = sentences(text).sort((a, b) => b.words - a.words)[0];
    assert.ok(
      worst.words <= LIMIT,
      `a ${worst.words}-word sentence in the Try it panel: “${worst.text}”`,
    );
  } finally {
    await page.close();
  }
});

test('the CORS explanation says the same thing in shorter sentences', async () => {
  // The longest sentence in the app used to be here, explaining which response
  // headers a browser exposes cross-origin. It is the right thing to say; it
  // does not have to be said in one breath.
  const page = await open();
  try {
    await showTab(page, 'tryit');
    await page.getByRole('button', { name: /^Send POST$/ }).click();
    await confirmSend(page);
    await page.waitForTimeout(4000);

    const text = await page.locator('.result--error').innerText();
    // Still accurate: both causes named, and the header that decides it.
    assert.match(text, /Access-Control-Allow-Origin/);
    assert.match(text, /unreachable/);

    const worst = sentences(text).sort((a, b) => b.words - a.words)[0];
    assert.ok(worst.words <= LIMIT, `a ${worst.words}-word sentence in the CORS error: “${worst.text}”`);
  } finally {
    await page.close();
  }
});
