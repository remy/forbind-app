/**
 * The accessibility guarantees, checked rather than asserted.
 *
 * This drives a real browser: axe-core over every screen and state, plus the
 * behaviours a static scan cannot see — the roving tabindex, the combobox, the
 * focus restoration, reflow at 320px and at 400% zoom, and the promise that a
 * credential never reaches the clipboard or storage.
 *
 * It needs Chromium, so it is a separate script from `npm test` and skips with
 * a clear message rather than failing when the optional dependencies are not
 * installed:
 *
 *     npm install && npm run test:a11y
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8181;
const BASE = `http://localhost:${PORT}`;
const SRC = '/samples/bookings-api.v2.yaml';
const LOCAL = '/test/fixtures/local-echo.yaml';

let chromium = null;
let axeSource = null;
try {
  ({ chromium } = await import('playwright'));
  axeSource = fs.readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
} catch {
  console.log('Skipping: this suite needs `npm install` (playwright and axe-core).');
  process.exit(0);
}

/* --- a dev server and a browser for the whole run ----------------------- */

const server = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(BASE);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the dev server did not start');
}
await waitForServer();

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});

test.after(async () => {
  await browser.close();
  server.kill();
});

/**
 * Open a page, load the sample schema, and hand it over.
 * @param {object} [options] passed to newContext
 */
async function open(hash = `#/op/post-v2-bookings?src=${SRC}`, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ...options });
  const problems = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/ERR_|Failed to load resource/.test(message.text())) {
      problems.push(`console error: ${message.text()}`);
    }
  });
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  page.problems = problems;
  return page;
}

/** @returns {Promise<string[]>} one line per violation */
async function violations(page) {
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(() => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  }));
  return results.violations.map((v) => `${v.id} (${v.impact}) on ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
}

/* --- axe over every screen ---------------------------------------------- */

const SCREENS = [
  ['the import screen', async () => open('')],
  ['the parse report', async () => {
    const page = await open('');
    await page.getByRole('button', { name: /bundled example/i }).click();
    await page.waitForTimeout(900);
    return page;
  }],
  ['the dense browser', async () => open()],
  ['the roomy browser', async () => {
    const page = await open();
    await page.evaluate(() => window.__aw.actions.setDensity('roomy'));
    await page.waitForTimeout(400);
    return page;
  }],
  ['the browser in dark', async () => open(`#/op/post-v2-bookings?src=${SRC}`, { colorScheme: 'dark' })],
  ['a component schema', async () => open(`#/schema/Booking?src=${SRC}`)],
  ['the command palette', async () => {
    const page = await open();
    await page.keyboard.press('Control+k');
    await page.keyboard.type('book');
    await page.waitForTimeout(400);
    return page;
  }],
  ['the auth sheet', async () => {
    const page = await open();
    await page.getByRole('button', { name: 'Authorise' }).click();
    await page.waitForTimeout(400);
    return page;
  }],
  ['the display panel', async () => {
    const page = await open();
    await page.getByRole('button', { name: 'Display' }).click();
    await page.waitForTimeout(400);
    return page;
  }],
  ['the detail on a phone', async () => open(`#/op/post-v2-bookings?src=${SRC}`, { viewport: { width: 390, height: 720 } })],
];

for (const [label, setup] of SCREENS) {
  test(`axe finds nothing to fix on ${label}`, async () => {
    const page = await setup();
    try {
      assert.deepEqual(await violations(page), []);
      assert.deepEqual(page.problems, []);
    } finally {
      await page.close();
    }
  });
}

/* --- landmarks and headings --------------------------------------------- */

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

/* --- the keyboard model -------------------------------------------------- */

test('the endpoint list is one tab stop with a roving cursor', async () => {
  const page = await open();
  try {
    assert.equal(await page.locator('a.row[tabindex="0"]').count(), 1);
    assert.ok(await page.locator('a.row[tabindex="-1"]').count() > 40);

    await page.locator('a.row').first().focus();
    // Identify rows by id, not by path: the first two rows of the sample are
    // GET and POST on the same path.
    const rowAt = () => page.evaluate(() => document.activeElement.dataset.opId);
    const pathAt = () => page.evaluate(() => document.activeElement.querySelector('.row__path')?.textContent);
    const first = await rowAt();

    await page.keyboard.press('ArrowDown');
    assert.notEqual(await rowAt(), first);
    // Still exactly one tab stop after moving.
    assert.equal(await page.locator('a.row[tabindex="0"]').count(), 1);

    await page.keyboard.press('End');
    const last = await rowAt();
    await page.keyboard.press('Home');
    assert.equal(await rowAt(), first);
    assert.notEqual(last, first);

    // A letter jumps to the next matching path.
    await page.keyboard.type('v2/venues');
    await page.waitForTimeout(200);
    assert.match(await pathAt(), /^\/v2\/venues/);

    // Enter opens, and selection is marked three ways.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('a.row[aria-current="true"]').count(), 1);
    assert.match(page.url(), /#\/op\//);
  } finally {
    await page.close();
  }
});

test('the cursor never loses focus to the body while moving', async () => {
  const page = await open();
  try {
    await page.locator('a.row').first().focus();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('ArrowDown');
      const tag = await page.evaluate(() => document.activeElement.tagName);
      assert.equal(tag, 'A', `focus fell off the list after ${i + 1} presses`);
    }
  } finally {
    await page.close();
  }
});

test('the palette is a combobox: focus stays put and activedescendant moves', async () => {
  const page = await open();
  try {
    await page.locator('a.row').nth(2).focus();
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    assert.equal(await page.evaluate(() => document.activeElement.id), 'palette-input');
    const input = page.locator('#palette-input');
    assert.equal(await input.getAttribute('role'), 'combobox');
    assert.equal(await input.getAttribute('aria-expanded'), 'true');
    assert.equal(await input.getAttribute('aria-controls'), 'palette-listbox');
    assert.equal(await input.getAttribute('aria-autocomplete'), 'list');

    await page.keyboard.type('venue');
    await page.waitForTimeout(300);
    const before = await input.getAttribute('aria-activedescendant');
    await page.keyboard.press('ArrowDown');
    const after = await input.getAttribute('aria-activedescendant');
    assert.notEqual(before, after);
    // Focus has not moved to the option.
    assert.equal(await page.evaluate(() => document.activeElement.id), 'palette-input');
    assert.equal(await page.locator('[role="option"][aria-selected="true"]').count(), 1);

    // Escape closes and hands focus back to whatever opened it.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('dialog.palette[open]').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'row');
  } finally {
    await page.close();
  }
});

test('a dialog hands focus back even when the bar it came from re-rendered', async () => {
  const page = await open();
  try {
    await page.getByRole('button', { name: 'Display' }).click();
    await page.waitForTimeout(300);
    // Changing density re-renders the top bar the invoker lives on.
    await page.getByRole('radio', { name: /^Roomy/ }).check();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.density), 'roomy');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Display');
  } finally {
    await page.close();
  }
});

/* --- never colour alone -------------------------------------------------- */

test('meaning is never carried by colour alone', async () => {
  const page = await open();
  try {
    // The verb is a word, and DEL still announces as DELETE.
    const del = page.locator('a.row', { has: page.locator('.pill--delete') }).first();
    assert.match(await del.textContent(), /DELETE/);

    // A deprecated row says so in its accessible name, not just by fading.
    const deprecated = page.locator('a.row.row--deprecated').first();
    assert.match(await deprecated.textContent(), /Deprecated/);

    // Selection is a bar, a tint and aria-current — all three.
    await page.locator('a.row').nth(1).click();
    await page.waitForTimeout(300);
    const selected = page.locator('a.row[aria-current="true"]');
    assert.equal(await selected.count(), 1);
    const style = await selected.evaluate((n) => {
      const computed = getComputedStyle(n);
      return { border: computed.borderLeftWidth, bg: computed.backgroundColor };
    });
    assert.notEqual(style.border, '0px');
    assert.notEqual(style.bg, 'rgba(0, 0, 0, 0)');

    // Required is a word.
    const req = await page.locator('table.params tbody tr').first().locator('td').nth(1).textContent();
    assert.match(req, /^(yes|no)$/);
  } finally {
    await page.close();
  }
});

/* --- reflow -------------------------------------------------------------- */

for (const [label, viewport] of [
  ['320px', { width: 320, height: 640 }],
  ['200% zoom', { width: 640, height: 400, deviceScaleFactor: 2 }],
  ['400% zoom', { width: 320, height: 200, deviceScaleFactor: 4 }],
]) {
  test(`the page reflows without horizontal scroll at ${label}`, async () => {
    const page = await open(`#/op/post-v2-bookings?src=${SRC}`, { viewport });
    try {
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      assert.ok(scrollWidth <= clientWidth + 1, `${scrollWidth} > ${clientWidth}`);
    } finally {
      await page.close();
    }
  });
}

test('reduced motion is honoured', async () => {
  const page = await open(`#/op/post-v2-bookings?src=${SRC}`, { reducedMotion: 'reduce' });
  try {
    assert.equal(await page.locator('a.row').first().evaluate((n) => getComputedStyle(n).transitionDuration), '0s');
  } finally {
    await page.close();
  }
});

test('focus stays visible when the system takes over the colours', async () => {
  const page = await open(`#/op/post-v2-bookings?src=${SRC}`, { forcedColors: 'active' });
  try {
    await page.locator('a.row').nth(3).focus();
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth);
    // box-shadow is discarded in forced colours, so the ring must be an outline.
    assert.notEqual(outline, '0px');
  } finally {
    await page.close();
  }
});

/* --- announcements ------------------------------------------------------- */

test('the live regions exist from first paint and carry the announcements', async () => {
  const page = await open('');
  try {
    assert.equal(await page.locator('#aw-live-polite[aria-live="polite"]').count(), 1);
    assert.equal(await page.locator('#aw-live-assertive[role="alert"]').count(), 1);

    await page.getByRole('button', { name: /bundled example/i }).click();
    await page.waitForTimeout(900);
    assert.match(await page.locator('#aw-live-polite').textContent(), /47 endpoints, 6 tags, 9 schemas/);
  } finally {
    await page.close();
  }
});

test('copying announces what was copied, not just a changed label', async () => {
  const page = await open();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  try {
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await page.waitForTimeout(300);
    assert.match(await page.locator('#aw-live-polite').textContent(), /curl command copied, 5 lines/);
    assert.match(await page.locator('.codeblock__copy').textContent(), /Copied/);
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('.codeblock__copy').textContent(), 'Copy');
  } finally {
    await page.close();
  }
});

/* --- the credential promises --------------------------------------------- */

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

/* --- try it -------------------------------------------------------------- */

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
