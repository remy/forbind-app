/**
 * Landmarks, headings, list semantics and the skip links.
 *
 * The structure a screen reader navigates by, and the links that let a
 * keyboard skip straight into it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, SRC, violations } from './lib/harness.mjs';

test('the rail keeps its schemas in a real disclosure, shut on arrival', async () => {
  const page = await open(`#/op/get-v2-bookings?src=${SRC}`);
  try {
    const drawer = page.locator('.rail__schemas');
    // A `<details>`, so the expanded state, the keyboard and the name all come
    // from the element rather than from ARIA bolted onto a div.
    assert.equal(await drawer.evaluate((node) => node.tagName), 'DETAILS');
    assert.equal(await drawer.evaluate((node) => node.open), false);
    assert.equal(await page.locator('.rail__schema').first().isVisible(), false);

    // The count is on the summary, so a shut drawer still says what is in it.
    const summary = page.locator('.rail__disclosure');
    assert.match(await summary.textContent(), /Schemas\s*9/);

    // And a marker that is actually painted. The native `::marker` gives up
    // once the summary's content is a block box, which left the drawer with
    // no visible affordance at all — so it is drawn here, and checked here.
    const marker = () => summary.evaluate((node) => {
      const before = getComputedStyle(node, '::before');
      return {
        content: before.content,
        width: parseFloat(before.borderTopWidth),
        transform: before.transform,
        borders: [before.borderTopColor, before.borderRightColor,
          before.borderBottomColor, before.borderLeftColor]
          .filter((_, i) => parseFloat([before.borderTopWidth, before.borderRightWidth,
            before.borderBottomWidth, before.borderLeftWidth][i]) > 0)
          .join(' '),
      };
    });
    const shut = await marker();
    assert.notEqual(shut.content, 'none');
    assert.ok(shut.width > 0, 'the disclosure marker has no box to paint');
    // Nothing about it is transparent, so forced colours cannot fill the shape
    // in and flatten it into a block.
    assert.ok(
      !/transparent|rgba\(0, 0, 0, 0\)/.test(shut.borders),
      `the marker leans on a transparent border: ${shut.borders}`,
    );
    // And it names the list it controls, whichever state it is in.
    const listedBy = await page.locator('.rail__schemas ul').getAttribute('aria-labelledby');
    assert.match(await page.locator(`#${listedBy}`).textContent(), /Schemas/);

    await summary.click();
    await page.waitForTimeout(400);
    assert.equal(await drawer.evaluate((node) => node.open), true);
    assert.equal(await page.locator('.rail__schema').first().isVisible(), true);

    // Open and shut do not look the same: the marker turns, so the state has
    // a shape and not only a position in the list.
    assert.notEqual((await marker()).transform, shut.transform);

    assert.deepEqual(await violations(page), []);
    assert.deepEqual(page.problems, []);
  } finally {
    await page.close();
  }
});

test('a schema opened from elsewhere unfolds the drawer it is listed in', async () => {
  const page = await open(`#/schema/Booking?src=${SRC}`);
  try {
    // Landing on a schema, the rail must not mark a current item inside a
    // drawer nobody can see.
    assert.equal(await page.locator('.rail__schemas').evaluate((node) => node.open), true);
    assert.equal(
      await page.locator('.rail__schema[aria-current="page"]').textContent(),
      'Booking',
    );

    // Shut it, then reach a schema from a link in the fields table.
    await page.locator('.rail__disclosure').click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.rail__schemas').evaluate((node) => node.open), false);

    await page.getByRole('link', { name: 'Customer', exact: true }).first().click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.rail__schemas').evaluate((node) => node.open), true);
    assert.equal(
      await page.locator('.rail__schema[aria-current="page"]').textContent(),
      'Customer',
    );
  } finally {
    await page.close();
  }
});

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
    assert.match(h1s[0], /^forbind — /);
  } finally {
    await page.close();
  }
});

/*
 * The dense list used to carry a row of method chips above the rows. They are
 * gone; the two ways left to narrow by method have to keep working, or their
 * removal took something with it. Reading a verb back out of the address is
 * the check below this one.
 */
test('the list panel offers no method filters, and still filters by method', async () => {
  const page = await open(`#/?src=${SRC}`);
  try {
    const groups = await page.evaluate(() =>
      [...document.querySelectorAll('.pane--list [role="group"]')].map((n) => n.getAttribute('aria-label')));
    assert.ok(!groups.includes('Filter by method'), `the method filter group is still there: ${groups.join(' | ')}`);
    assert.ok(groups.includes('Deprecated endpoints'), `the deprecated controls went too: ${groups.join(' | ')}`);
    assert.equal(await page.getByRole('button', { name: /^GET \d+$/ }).count(), 0, 'a method chip is still on screen');

    // The counter is the honest reading of what the list is showing.
    const shown = () => page.locator('.statusbar').textContent();
    assert.match(await shown(), /47 of 47 shown/);

    // Typing a verb into the filter narrows by it, on its own and in front of
    // a word: `post book` is POST endpoints about books.
    await page.locator('#search').fill('delete');
    await page.waitForTimeout(500);
    assert.match(await shown(), /6 of 47 shown/, 'typing a verb did not narrow the list');
    await page.locator('#search').fill('post book');
    await page.waitForTimeout(500);
    assert.match(await shown(), /6 of 47 shown/, 'a verb in front of a word did not narrow the list');
    await page.locator('#search').fill('');
    await page.waitForTimeout(500);

    // And the roomy layout keeps `+ verb` among its facets.
    await page.evaluate(() => window.__fb.actions.setDensity('roomy'));
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: '+ verb' }).click();
    await page.waitForTimeout(400);
    // The facet values are toggle buttons carrying `aria-pressed`, not
    // checkboxes, so they are pressed rather than checked.
    const get = page.locator('#facet-panel button', { hasText: /^GET$/ });
    await get.click();
    await page.waitForTimeout(500);
    assert.equal(await get.getAttribute('aria-pressed'), 'true');
    assert.match(await shown(), /21 of 47 shown/, 'the verb facet did not narrow the list');
    // The filter reaches the address, so the view is still shareable.
    assert.match(await page.evaluate(() => location.hash), /verb=GET/);
  } finally {
    await page.close();
  }
});

/*
 * A shared link names a document and how to look at it in one address, and the
 * document always arrives second — the fetch has not started when the filters
 * are read. So the load has to hand them back rather than clear them with the
 * previous document's.
 */
test('a filter named in the address survives the schema load', async () => {
  const page = await open(`#/?src=${SRC}&verb=GET`);
  try {
    assert.match(await page.locator('.statusbar').textContent(), /21 of 47 shown/,
      'the verb in the link was thrown away by the schema load');
    // Not just the count: the rows on screen are the GET ones. The pill is
    // where a row says its method, abbreviated or not.
    const methods = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll('.pane--list .row .pill')].map((n) => n.textContent.trim()))]);
    assert.deepEqual(methods, ['GET'], `the list is showing ${methods.join(', ')}`);
    // The store agrees, so the applied-filter controls can clear it.
    assert.deepEqual(await page.evaluate(() => window.__fb.store.state.filters.verbs), ['GET']);
    // And it is still in the address, so the link a reader copies onward says
    // the same thing as the one they were given.
    assert.match(await page.evaluate(() => location.hash), /verb=GET/);

    // The other three spellings arrive the same way.
    for (const [query, expected] of [['q=book', /18 of 47 shown/], ['tag=Bookings', /12 of 47 shown/], ['deprecated=only', /3 of 47 shown/]]) {
      const other = await open(`#/?src=${SRC}&${query}`);
      try {
        assert.match(await other.locator('.statusbar').textContent(), expected, `${query} did not survive the load`);
      } finally {
        await other.close();
      }
    }
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
      await page.evaluate((d) => window.__fb.actions.setDensity(d), density);
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
      window.__fb.actions.setQuery('booking');
      window.__fb.actions.selectOperation(window.__fb.actions.visibleOperations()[1].id);
    });
    await page.waitForTimeout(600);
    const before = await page.evaluate(() => ({
      op: window.__fb.store.state.selectedOperationId,
      query: window.__fb.store.state.filters.query,
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
        op: window.__fb.store.state.selectedOperationId,
        query: window.__fb.store.state.filters.query,
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
    assert.equal(await page.evaluate(() => window.__fb.store.state.filters.query), 'venue');
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
      await page.evaluate((d) => window.__fb.actions.setDensity(d), density);
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
      await page.evaluate(() => window.__fb.store.state.schema?.sourceName ?? null),
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
    assert.equal(await page.evaluate(() => window.__fb.store.state.selectedOperationId), 'post-v2-bookings');
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
    assert.match(await title(), /^POST \/v2\/bookings — .+ — forbind$/);

    await page.evaluate(() => window.__fb.actions.selectSchema('Booking'));
    await page.waitForTimeout(300);
    assert.match(await title(), /^Booking — .+ — forbind$/);

    await page.evaluate(() => window.__fb.actions.replaceSchema());
    await page.waitForTimeout(400);
    assert.equal(await title(), 'Load a schema — forbind');
  } finally {
    await page.close();
  }
});
