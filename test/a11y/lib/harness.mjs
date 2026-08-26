/**
 * The browser harness the accessibility suites share.
 *
 * One dev server and one browser per suite file, plus the two things every
 * check starts from: a page with the sample schema loaded, and axe-core run
 * over whatever is on it. The suites themselves are the files beside this
 * one, split by subject so each stays readable in one sitting.
 *
 * Chromium is needed, so a suite skips with a clear message rather than
 * failing when the optional dependencies are not installed:
 *
 *     npm install && npm run test:a11y
 */

import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 8181;
export const BASE = `http://localhost:${PORT}`;
export const SRC = '/samples/bookings-api.v2.yaml';
export const LOCAL = '/test/fixtures/local-echo.yaml';

let chromium = null;
let axeSource = null;
try {
  ({ chromium } = await import('playwright'));
  axeSource = fs.readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');
} catch {
  console.log('Skipping: this suite needs `npm install` (playwright and axe-core).');
  process.exit(0);
}

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
 * @param {string} [hash]
 * @param {object} [options] passed to newPage
 */
export async function open(hash = `#/op/post-v2-bookings?src=${SRC}`, options = {}) {
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
export async function violations(page) {
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(() => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  }));
  return results.violations.map((v) => `${v.id} (${v.impact}) on ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`);
}
