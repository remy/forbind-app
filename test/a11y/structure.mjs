/**
 * Landmarks, headings, list semantics and the skip links.
 *
 * The structure a screen reader navigates by, and the links that let a
 * keyboard skip straight into it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, SRC } from './lib/harness.mjs';

test('every landmark is present and named', async () => {
  const page = await open();
  try {
    // A <section> with an accessible name is a region; the role is implicit,
    // so match on the element and its label rather than on a role attribute.
    const landmarks = await page.evaluate(() =>
      [...document.querySelectorAll('[role="banner"], nav, main, section[aria-label]')]
        .map((n) => `${n.tagName.toLowerCase()}:${n.getAttribute('aria-label') ?? ''}`));
    assert.ok(landmarks.includes('header:'), landmarks.join(' | '));
    assert.ok(landmarks.includes('nav:Tags and schemas'), landmarks.join(' | '));
    assert.ok(landmarks.includes('main:Endpoint browser'), landmarks.join(' | '));
    assert.ok(landmarks.includes('section:Endpoints'), landmarks.join(' | '));
    assert.ok(landmarks.includes('section:Operation detail'), landmarks.join(' | '));
    // Exactly one h1, naming the tool and the document.
    const h1s = await page.locator('h1').allTextContents();
    assert.equal(h1s.length, 1);
    assert.match(h1s[0], /^allyway — /);
  } finally {
    await page.close();
  }
});

test('the skip links are the first tab stops and land on real targets', async () => {
  const page = await open();
  try {
    const stops = [];
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      stops.push(await page.evaluate(() => document.activeElement.getAttribute('href')));
    }
    assert.deepEqual(stops, ['#endpoint-list', '#detail', '#search', '#tag-nav']);
    for (const href of stops) {
      assert.equal(await page.locator(href).count(), 1, `${href} has no target`);
    }
  } finally {
    await page.close();
  }
});

test('the list is a real list, with no display:contents anywhere in it', async () => {
  for (const density of ['dense', 'roomy']) {
    const page = await open();
    try {
      await page.evaluate((d) => window.__aw.actions.setDensity(d), density);
      await page.waitForTimeout(500);

      const shape = await page.evaluate(() => {
        const scroller = document.querySelector('.list-scroll');
        const lists = [...scroller.querySelectorAll('ul')];
        return {
          lists: lists.length,
          // A list may contain nothing but list items.
          strayChildren: lists.flatMap((ul) => [...ul.children])
            .filter((c) => c.tagName !== 'LI')
            .map((c) => c.tagName),
          rowsNotInListItems: [...scroller.querySelectorAll('a.row')]
            .filter((a) => a.parentElement.tagName !== 'LI').length,
          // display:contents on an <li> is what quietly costs it its role.
          contents: [...scroller.querySelectorAll('*')]
            .filter((n) => getComputedStyle(n).display === 'contents').length,
          namedLists: lists.every((ul) => ul.hasAttribute('aria-label') || ul.hasAttribute('aria-labelledby')),
        };
      });
      assert.ok(shape.lists >= 1, `${density}: no list rendered`);
      assert.deepEqual(shape.strayChildren, [], `${density}: a list contained something other than list items`);
      assert.equal(shape.rowsNotInListItems, 0, `${density}: a row was not inside a list item`);
      assert.equal(shape.contents, 0, `${density}: display:contents found inside the list`);
      assert.ok(shape.namedLists, `${density}: a list had no accessible name`);

      // Every group heading is a real heading, and every row is still reachable.
      const snapshot = await page.locator('.list-scroll').ariaSnapshot();
      assert.match(snapshot, /- list/);
      assert.match(snapshot, /- listitem/);
      if (density === 'roomy') assert.match(snapshot, /- heading .* \[level=2\]/);
    } finally {
      await page.close();
    }
  }
});

test('a skip link lands focus on its target without disturbing the route', async () => {
  const page = await open();
  try {
    // Something worth not losing: a filter and an open operation.
    await page.evaluate(() => {
      window.__aw.actions.setQuery('booking');
      window.__aw.actions.selectOperation(window.__aw.actions.visibleOperations()[1].id);
    });
    await page.waitForTimeout(600);
    const before = await page.evaluate(() => ({
      op: window.__aw.store.state.selectedOperationId,
      query: window.__aw.store.state.filters.query,
      hash: location.hash,
    }));

    const expected = {
      'Skip to the endpoint list': 'endpoint-list',
      'Skip to the operation detail': 'detail',
      'Skip to search': 'search',
      'Skip to tags and filters': 'tag-nav',
    };

    for (const [name, id] of Object.entries(expected)) {
      await page.getByRole('link', { name }).focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => document.activeElement.id), id, `${name} did not focus its target`);
      const after = await page.evaluate(() => ({
        op: window.__aw.store.state.selectedOperationId,
        query: window.__aw.store.state.filters.query,
        hash: location.hash,
      }));
      assert.deepEqual(after, before, `${name} changed the route or the filters`);
    }

    // Skipping to the search selects what is there, so typing replaces it.
    await page.getByRole('link', { name: 'Skip to search' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    await page.keyboard.type('venue');
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__aw.store.state.filters.query), 'venue');
  } finally {
    await page.close();
  }
});

test('the tags skip link follows the tags wherever the layout puts them', async () => {
  // A rail at full width, a chip row once it folds, facets in the roomy IA.
  const cases = [
    [{ width: 1280, height: 900 }, 'dense', 'tag-nav'],
    [{ width: 1000, height: 800 }, 'dense', 'tag-chips'],
    [{ width: 1280, height: 900 }, 'roomy', 'filters'],
  ];
  for (const [viewport, density, id] of cases) {
    const page = await open(`#/op/post-v2-bookings?src=${SRC}`, { viewport });
    try {
      await page.evaluate((d) => window.__aw.actions.setDensity(d), density);
      await page.waitForTimeout(500);
      await page.getByRole('link', { name: 'Skip to tags and filters' }).focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => document.activeElement.id), id,
        `${density} at ${viewport.width}px went somewhere else`);
      assert.ok(await page.evaluate(() => document.activeElement.getClientRects().length > 0),
        `${density} at ${viewport.width}px focused something invisible`);
    } finally {
      await page.close();
    }
  }
});

test('a schema named in the query string loads, and the address is tidied up', async () => {
  // No fragment at all: the shape a link from somewhere else takes.
  const page = await open(`?url=${SRC}`);
  try {
    assert.equal(
      await page.evaluate(() => window.__aw.store.state.schema?.sourceName ?? null),
      'bookings-api.v2.yaml',
      'the query string did not load the schema',
    );
    // Folded into the fragment, and out of the query, so one place holds it.
    const where = await page.evaluate(() => ({ search: location.search, hash: location.hash }));
    assert.equal(where.search, '', 'the query parameter was left behind');
    assert.match(where.hash, /src=/);
  } finally {
    await page.close();
  }
});

test('a query schema lands on the operation the fragment asked for', async () => {
  const page = await open(`?url=${SRC}#/op/post-v2-bookings`);
  try {
    assert.equal(await page.evaluate(() => window.__aw.store.state.selectedOperationId), 'post-v2-bookings');
    assert.match(await page.locator('.detail__path').textContent(), /\/v2\/bookings/);
  } finally {
    await page.close();
  }
});

test('the title names which of the four screens is on show', async () => {
  // One address bar, four screens. A title that never changes leaves the tab,
  // the history entry and the post-navigation announcement all saying the
  // same thing.
  const page = await open(`#/op/post-v2-bookings?src=${SRC}`);
  try {
    const title = () => page.title();
    assert.match(await title(), /^POST \/v2\/bookings — .+ — allyway$/);

    await page.evaluate(() => window.__aw.actions.selectSchema('Booking'));
    await page.waitForTimeout(300);
    assert.match(await title(), /^Booking — .+ — allyway$/);

    await page.evaluate(() => window.__aw.actions.replaceSchema());
    await page.waitForTimeout(400);
    assert.equal(await title(), 'Load a schema — allyway');
  } finally {
    await page.close();
  }
});
