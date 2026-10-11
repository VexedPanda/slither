// Generates seeded puzzles for a checkout of this repo and writes their hashes (see harness/main.ts) to a JSON file.
//
// Usage: node .github/consistency/run.mjs <checkout dir> <output json> [cases json]
//
// The harness is copied into the checkout (as consistency-check/, removed afterward) and served with that checkout's
// own Vite config and dependencies, then run in headless Chrome. Vite and Puppeteer are resolved from wherever this
// script lives, so a checkout without this script (e.g. the base of a pull request) can still be run.
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [checkoutArg, outputArg, casesArg] = process.argv.slice(2);
if (!checkoutArg || !outputArg) {
  console.error('Usage: node .github/consistency/run.mjs <checkout dir> <output json> [cases json]');
  process.exit(2);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const checkoutDir = path.resolve(checkoutArg);
const outputPath = path.resolve(outputArg);
const cases = JSON.parse(fs.readFileSync(casesArg ? path.resolve(casesArg) : path.join(scriptDir, 'cases.json'), 'utf8'));

const harnessDir = path.join(checkoutDir, 'consistency-check');
fs.cpSync(path.join(scriptDir, 'harness'), harnessDir, { recursive: true });

let server = null;
let browser = null;
try {
  server = await createServer({
    root: checkoutDir,
    configFile: path.join(checkoutDir, 'vite.config.js'),
    logLevel: 'warn',
    server: { port: 5300, strictPort: false },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls.local[0];

  browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-gpu'],
    protocolTimeout: 0,
  });
  const page = await browser.newPage();
  page.on('console', (message) => {
    if (message.text().startsWith('[consistency]')) {
      console.log(message.text());
    }
  });
  page.on('pageerror', (error) => console.error(`[page error] ${error.message}`));

  const url = `${baseUrl}consistency-check/index.html?cases=${encodeURIComponent(JSON.stringify(cases))}`;
  console.log(`Running ${url}`);
  await page.goto(url);
  await page.waitForFunction(() => window.consistencyResult || window.consistencyError, { timeout: 0, polling: 1000 });

  const error = await page.evaluate(() => window.consistencyError);
  if (error) {
    throw new Error(`Harness failed: ${error}`);
  }

  const results = await page.evaluate(() => window.consistencyResult);
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`Wrote ${results.length} results to ${outputPath}`);
} finally {
  await browser?.close();
  await server?.close();
  fs.rmSync(harnessDir, { recursive: true, force: true });
}
