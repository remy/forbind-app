/**
 * What the interface says without words: never colour alone, motion the system
 * asked to be reduced, and a focus ring that survives forced colours.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { open, showTab, SRC } from './lib/harness.mjs';

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
    await showTab(page, 'body');
    const req = await page.locator('table.params tbody tr').first().locator('td').nth(1).textContent();
    assert.match(req, /^(yes|no)$/);
  } finally {
    await page.close();
  }
});

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

test('a request for more contrast reaches the tokens in every theme', async () => {
  // The override lives in a media query, and media queries add no
  // specificity: a bare :root loses to the theme selectors that also claim
  // :root. Check all four ways a reader can arrive, not just the one where
  // nothing else has claimed it.
  const cases = [
    ['auto theme, light system', { colorScheme: 'light' }, null],
    ['explicit light', { colorScheme: 'light' }, 'light'],
    ['auto theme, dark system', { colorScheme: 'dark' }, null],
    ['explicit dark', { colorScheme: 'dark' }, 'dark'],
  ];

  for (const [label, options, theme] of cases) {
    const page = await open(`#/op/post-v2-bookings?src=${SRC}`, { contrast: 'more', ...options });
    try {
      if (theme) {
        await page.evaluate((t) => window.__aw.actions.setTheme(t), theme);
        await page.waitForTimeout(200);
      }
      const tokens = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const read = (name) => style.getPropertyValue(name).trim();
        return { ink: read('--ink'), quiet: read('--ink-55'), rule: read('--rule-soft') };
      });
      assert.equal(tokens.quiet, tokens.ink, `${label}: --ink-55 did not take the high-contrast value`);
      assert.equal(tokens.rule, tokens.ink, `${label}: --rule-soft did not take the high-contrast value`);
    } finally {
      await page.close();
    }
  }
});

/**
 * The contrast of one element's colour against whatever actually paints
 * behind it, measured from computed styles in the page rather than from the
 * token values — so a token that stops reaching an element shows up here.
 *
 * `from` says where the search for that backdrop starts. Text sits on its own
 * element's background; a border is the boundary against what is outside it,
 * so that measurement has to skip the element's own fill.
 *
 * @param {import('playwright').Locator} locator
 * @param {'color'|'borderTopColor'} property
 * @param {{from?: 'self'|'behind'}} [options]
 */
function ratio(locator, property, { from = 'self' } = {}) {
  return locator.evaluate((node, [prop, start]) => {
    const parse = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const opaque = (value) => {
      const parts = parse(value);
      return value !== 'transparent' && (parts.length < 4 ? !/^rgba/.test(value) : true)
        && !/,\s*0\s*\)$/.test(value.replace(/rgb\(/, 'x('));
    };
    const lum = ([r, g, b]) => {
      const channel = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : (((c / 255) + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    let behind = start === 'self' ? node : node.parentElement;
    let background = null;
    while (behind && background === null) {
      const value = getComputedStyle(behind).backgroundColor;
      if (opaque(value)) background = value;
      behind = behind.parentElement;
    }
    const a = lum(parse(getComputedStyle(node)[prop]));
    const b = lum(parse(background ?? 'rgb(255, 255, 255)'));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, [property, from]);
}

test('a chip border carries 3:1 against the surface behind it', async () => {
  // An unpressed chip has no fill, so its border is the whole of what says
  // "control". 1.4.11 asks 3:1 of that, in both themes. A pressed chip is a
  // different case — it is a filled shape, and the fill does the work.
  for (const theme of ['light', 'dark']) {
    const page = await open(`#/op/post-v2-bookings?src=${SRC}`);
    try {
      await page.evaluate((t) => window.__aw.actions.setTheme(t), theme);
      await page.waitForTimeout(200);
      const chip = page.locator('.chip[aria-pressed="false"]').first();
      assert.ok(await chip.count(), `${theme}: no unpressed chip to measure`);
      const measured = await ratio(chip, 'borderTopColor', { from: 'behind' });
      assert.ok(measured >= 3, `${theme}: the chip border is ${measured.toFixed(2)}:1, under the 3:1 of 1.4.11`);
    } finally {
      await page.close();
    }
  }
});

test('the palette clears AAA, including the pairs that only just did not', async () => {
  // 1.4.6 is AAA and the system is otherwise clean, so the three pairs that
  // used to sit in the 6s are worth holding: GET and POST on their own tints,
  // and the quiet grey where it lands on the tinted surface rather than paper.
  for (const theme of ['light', 'dark']) {
    const page = await open(`#/op/post-v2-bookings?src=${SRC}`);
    try {
      await page.evaluate((t) => window.__aw.actions.setTheme(t), theme);
      await page.waitForTimeout(200);

      const pairs = [
        ['GET pill', page.locator('.pill--get').first()],
        ['POST pill', page.locator('.pill--post').first()],
        ['hint bar', page.locator('.hintbar').first()],
      ];
      for (const [label, locator] of pairs) {
        if (!(await locator.count())) continue;
        const measured = await ratio(locator, 'color');
        assert.ok(measured >= 7, `${theme}: ${label} is ${measured.toFixed(2)}:1, under the 7:1 of 1.4.6`);
      }
    } finally {
      await page.close();
    }
  }
});

test('the whole of the search field is the search field', async () => {
  // The input is shorter than the box that draws it, and the box is a div with
  // no handler, so a centred input leaves dead bands where a slightly high or
  // low click does nothing at all.
  const page = await open(`#/op/post-v2-bookings?src=${SRC}`);
  try {
    const hit = await page.locator('.field').first().evaluate((field) => {
      const box = field.getBoundingClientRect();
      const at = (y) => document.elementFromPoint(box.x + box.width / 2, y)?.tagName;
      return { top: at(box.top + 2), middle: at(box.y + box.height / 2), bottom: at(box.bottom - 2) };
    });
    assert.equal(hit.top, 'INPUT', 'the top of the field is not the input');
    assert.equal(hit.middle, 'INPUT');
    assert.equal(hit.bottom, 'INPUT', 'the bottom of the field is not the input');
  } finally {
    await page.close();
  }
});
