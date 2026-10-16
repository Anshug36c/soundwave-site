/**
 * Captures screenshots of the site for reports. Not part of the test gate —
 * a convenience for showing the result. Usage: node scripts/screenshot.mjs <baseUrl> <outDir>
 */
import { chromium } from 'playwright';
import { readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'https://anshug36c.github.io/soundwave-site/';
const OUT = process.argv[3] || '/home/user/shots';
const AUDIO_DIR = process.env.SMOKE_AUDIO_DIR || '/tmp/sw-audio';

mkdirSync(OUT, { recursive: true });
const files = readdirSync(AUDIO_DIR).filter((f) => /\.wav$/i.test(f)).sort().map((f) => path.join(AUDIO_DIR, f));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });

const shot = (name) => page.screenshot({ path: path.join(OUT, name) });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('.brand');
await shot('01-home.png');

await page.locator('.nav-item', { hasText: 'Library' }).click();
await page.locator('input[type="file"]').first().setInputFiles(files);
await page.waitForSelector('.track-row');
await page.waitForTimeout(400);
await shot('02-library.png');

await page.locator('.track-row').first().click();
await page.waitForFunction(() => window.__soundwave.audioState.trackId !== null, null, { timeout: 10000 });
await page.waitForTimeout(1200);
await shot('03-minibar.png');

// Open the full player via the mini player.
await page.locator('.playerbar-inner').click();
await page.waitForSelector('.sheet');
await page.waitForTimeout(1400);
await shot('04-player.png');
await page.locator('.sheet .btn.icon.ghost').first().click();
await page.waitForTimeout(300);

await page.locator('.nav-item', { hasText: 'Search' }).click();
await page.waitForTimeout(400);
await shot('05-search.png');

await page.locator('.nav-item', { hasText: 'Phone' }).click();
await page.waitForSelector('.page-title');
await page.waitForTimeout(400);
await shot('06-phone.png');

await browser.close();
console.log('screenshots written to', OUT);
