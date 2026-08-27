/**
 * A response opened up: the shape of its body as nested disclosures, walked
 * with the keyboard and expanded in bulk.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, showTab } from './lib/harness.mjs';

test('a response opens up to the shape of its payload', async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      const op = window.__aw.store.state.schema.operations.find((o) => o.path === '/v2/bookings' && o.method === 'POST');
      window.__aw.actions.selectOperation(op.id);
    });
    await page.waitForTimeout(700);
    await showTab(page, 'responses');

    // Collapsed, a response still reads as the row the design draws.
    const summaries = await page.locator('.response-summary').allTextContents();
    assert.ok(summaries.some((t) => /201/.test(t) && /Created/.test(t)));
    // …with what it carries said in the summary, so it is worth opening.
    assert.ok(summaries.some((t) => /fields/.test(t)), `no shape hint: ${summaries.join(' | ')}`);

    // The success response starts open; the error ones wait to be asked.
    assert.equal(await page.locator('details.response-detail[open]').count(), 1);
    const open201 = page.locator('details.response-detail[open]');
    assert.match(await open201.locator('.response-summary').textContent(), /201/);

    // Its fields are there, with type and whether they have to be present.
    const fields = await open201.locator('.schema-tree').first()
      .evaluate((ul) => [...ul.children].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
    assert.ok(fields.some((f) => f.startsWith('id')));
    assert.ok(fields.some((f) => /partySize/.test(f) && /integer/.test(f) && /required/.test(f)));
    // An enum is listed rather than hidden behind a count.
    assert.ok(fields.some((f) => /one of: held, pending, confirmed, cancelled/.test(f)), fields.join(' | '));

    // And an example built from the same schema.
    const example = await open201.locator('pre.code-block').textContent();
    assert.doesNotThrow(() => JSON.parse(example), 'the example was not valid JSON');
    assert.ok(JSON.parse(example).partySize !== undefined);
  } finally {
    await page.close();
  }
});

test('a nested payload is walked with the keyboard alone', async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      const op = window.__aw.store.state.schema.operations.find((o) => o.path === '/v2/bookings' && o.method === 'POST');
      window.__aw.actions.selectOperation(op.id);
    });
    await page.waitForTimeout(700);
    await showTab(page, 'responses');

    const branch = page.locator('details.response-detail[open] details.field-branch').first();
    const summary = branch.locator('> summary');
    assert.ok(await branch.count() > 0, 'nothing in the payload was expandable');

    // A <summary> is a disclosure: it takes focus, and Enter works on it. No
    // ARIA needed, and the expanded state is the element's own.
    await summary.focus();
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'SUMMARY');

    const wasOpen = await branch.evaluate((n) => n.open);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    assert.equal(await branch.evaluate((n) => n.open), !wasOpen);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    assert.equal(await branch.evaluate((n) => n.open), wasOpen);

    // Opening builds the level below rather than it being there all along.
    if (!wasOpen) {
      assert.ok(await branch.locator('.schema-tree').count() > 0);
    }
  } finally {
    await page.close();
  }
});

test('the payload is nested lists, not a hand-rolled tree widget', async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      const op = window.__aw.store.state.schema.operations.find((o) => o.path === '/v2/bookings' && o.method === 'POST');
      window.__aw.actions.selectOperation(op.id);
    });
    await page.waitForTimeout(700);
    await showTab(page, 'responses');
    const tree = page.locator('details.response-detail[open] aw-schema-tree');

    const shape = await tree.evaluate((root) => ({
      treeRoles: root.querySelectorAll('[role="tree"], [role="treeitem"]').length,
      lists: root.querySelectorAll('ul').length,
      strays: [...root.querySelectorAll('ul')].flatMap((ul) => [...ul.children])
        .filter((c) => c.tagName !== 'LI').map((c) => c.tagName),
      contents: [...root.querySelectorAll('*')].filter((n) => getComputedStyle(n).display === 'contents').length,
      // A <summary> is a button; a link inside one is a focusable thing inside
      // a focusable thing, and axe is right to call that a trap.
      linksInSummaries: root.querySelectorAll('summary a, summary button').length,
    }));
    assert.equal(shape.treeRoles, 0, 'a tree role appeared where native disclosures are used');
    assert.ok(shape.lists >= 1);
    assert.deepEqual(shape.strays, []);
    assert.equal(shape.contents, 0);
    assert.equal(shape.linksInSummaries, 0);

    const snapshot = await tree.ariaSnapshot();
    assert.match(snapshot, /- list/);
    assert.match(snapshot, /- listitem/);
    assert.match(snapshot, /- group|expanded|collapsed|button/i);
  } finally {
    await page.close();
  }
});

test('expand all opens every level and says what it did', async () => {
  const page = await open();
  try {
    await page.evaluate(() => {
      const op = window.__aw.store.state.schema.operations.find((o) => o.path === '/v2/bookings' && o.method === 'POST');
      window.__aw.actions.selectOperation(op.id);
    });
    await page.waitForTimeout(700);
    await showTab(page, 'responses');
    const tree = page.locator('details.response-detail[open] aw-schema-tree');

    await tree.getByRole('button', { name: 'Expand all' }).click();
    await page.waitForTimeout(600);
    assert.equal(await tree.locator('details.field-branch:not([open])').count(), 0, 'expand all left a branch closed');
    assert.match(await page.locator('#aw-live-polite').textContent(), /expanded/);

    await tree.getByRole('button', { name: 'Collapse all' }).click();
    await page.waitForTimeout(400);
    assert.equal(await tree.locator('details.field-branch[open]').count(), 0);
    assert.match(await page.locator('#aw-live-polite').textContent(), /collapsed/);
  } finally {
    await page.close();
  }
});
