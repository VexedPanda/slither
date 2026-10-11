// Runs the QUnit test pages (test/*.html) in headless Chrome against the Vite dev server, and exits non-zero if any
// test fails, a page throws, or a page doesn't finish in time.
//
// Usage: node .github/tests/run-qunit.mjs [page ...]   (defaults to every test/*.html)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';

const PAGE_TIMEOUT_MS = 20 * 60 * 1000;

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pages =
  process.argv.length > 2 ?
    process.argv.slice(2)
  : fs
      .readdirSync(path.join(repoDir, 'test'))
      .filter((name) => name.endsWith('.html'))
      .map((name) => `test/${name}`);

let server = null;
let browser = null;
let failed = false;
try {
  server = await createServer({
    root: repoDir,
    configFile: path.join(repoDir, 'vite.config.js'),
    logLevel: 'warn',
    server: { port: 5400, strictPort: false },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls.local[0];

  browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-gpu'], protocolTimeout: 0 });

  for (const pagePath of pages) {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        pageErrors.push(message.text());
      }
    });

    const start = Date.now();
    console.log(`Running ${pagePath}`);
    await page.goto(`${baseUrl}${pagePath}`);

    // QUnit writes its summary into #qunit-testresult when the run ends
    let result = null;
    try {
      await page.waitForFunction(
        () =>
          document.querySelector('#qunit-testresult .total') ||
          document.querySelector('#qunit-testresult-display .total'),
        { timeout: PAGE_TIMEOUT_MS, polling: 1000 },
      );
      result = await page.evaluate(() => {
        const number = (selector) => parseInt(document.querySelector(selector)?.textContent ?? '0', 10);
        return {
          total: number('#qunit-testresult .total, #qunit-testresult-display .total'),
          passed: number('#qunit-testresult .passed, #qunit-testresult-display .passed'),
          failed: number('#qunit-testresult .failed, #qunit-testresult-display .failed'),
          failures: [...document.querySelectorAll('#qunit-tests > li.fail')].map((li) =>
            [
              li.querySelector('.module-name')?.textContent,
              li.querySelector('.test-name')?.textContent,
              ...[...li.querySelectorAll('.qunit-assert-list li.fail')].map((assert) => `  ${assert.textContent}`),
            ]
              .filter(Boolean)
              .join(' / '),
          ),
        };
      });
    } catch (e) {
      console.error(`  did not finish within ${PAGE_TIMEOUT_MS / 60000} minutes`);
    }

    const seconds = ((Date.now() - start) / 1000).toFixed(1);
    if (!result) {
      failed = true;
    } else {
      console.log(`  ${result.passed}/${result.total} assertions passed, ${result.failed} failed (${seconds}s)`);
      result.failures.forEach((failure) => console.error(`  FAIL ${failure}`));
      if (result.failed > 0 || result.total === 0) {
        failed = true;
      }
    }
    if (pageErrors.length) {
      failed = true;
      pageErrors.forEach((error) => console.error(`  page error: ${error}`));
    }
    await page.close();
  }
} finally {
  await browser?.close();
  await server?.close();
}

process.exit(failed ? 1 : 0);
