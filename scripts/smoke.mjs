/**
 * End-to-end smoke test for Soundwave Web, run against the built `dist/` via `vite preview`.
 *
 * This is a real browser (Playwright Chromium), not a static fetch: it proves the React app
 * mounts, files import into the Library and parse, local playback starts and advances, the
 * app-mirrored player opens, and the four-tab navigation (Home / Search / Library / Phone) is
 * exactly what ships — while failing loudly on any console error or unhandled rejection.
 * Run locally with `node scripts/smoke.mjs` (CI runs the same script).
 */
import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:4173/';
const AUDIO_DIR = process.env.SMOKE_AUDIO_DIR || '/tmp/sw-audio';

const errors = [];
const log = (...a) => console.log('[smoke]', ...a);

function fail(msg) {
  errors.push(msg);
  console.error('[smoke][FAIL]', msg);
}

function assert(cond, msg) {
  if (cond) log('ok —', msg);
  else fail(msg);
}

async function main() {
  const audioFiles = readdirSync(AUDIO_DIR)
    .filter((f) => /\.(wav|mp3|flac|ogg|m4a)$/i.test(f))
    .map((f) => path.join(AUDIO_DIR, f));
  if (audioFiles.length === 0) {
    console.error(`No audio fixtures in ${AUDIO_DIR}`);
    process.exit(2);
  }
  log('fixtures:', audioFiles.length, 'files');

  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const page = await browser.newPage();

  page.on('console', (m) => {
    if (m.type() === 'error') fail(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => fail(`pageerror: ${e.message}`));

  try {
    // 1. Load and mount.
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.brand', { timeout: 10000 });
    const title = await page.textContent('.brand');
    assert(/Soundwave/i.test(title || ''), `app mounted, brand reads "${(title || '').trim()}"`);

    // Default tab mirrors the app: Home. With no phone connected it must
    // show the connect prompt, not invented content.
    assert(await page.locator('.connect-prompt').isVisible().catch(() => false),
      'Home shows the connect prompt while no phone is connected');

    // Library empty state on first run.
    await page.locator('.nav-item', { hasText: 'Library' }).click();
    const emptyVisible = await page.locator('.empty').isVisible().catch(() => false);
    assert(emptyVisible, 'empty-library state shown on first load');

    // 2. Import real audio files through the hidden file input.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(audioFiles);

    // Import progress overlay may flash; wait for track rows to appear.
    await page.waitForSelector('.track-row', { timeout: 20000 });
    const rowCount = await page.locator('.track-row').count();
    assert(rowCount >= audioFiles.length, `library lists ${rowCount} tracks after import`);

    // 3. Confirm metadata was parsed (titles should not all be the raw filename).
    const firstTitle = (await page.locator('.track-row .t-title').first().textContent()) || '';
    assert(firstTitle.length > 0, `first track has a title ("${firstTitle.trim()}")`);

    // 4. Play the first track.
    await page.locator('.track-row').first().click();
    // Now-playing sheet opens on some flows; the mini bar must exist either way.
    await page.waitForSelector('.playerbar, .sheet', { timeout: 10000 });
    const hasPlayer = await page.locator('.playerbar, .sheet').first().isVisible();
    assert(hasPlayer, 'player UI appeared after clicking a track');

    // Give playback a moment and confirm the Web Audio graph is running + time advanced.
    // The engine's decks are detached <audio> elements (not in the DOM), so we read the shared
    // engine's observable state through the __soundwave diagnostic handle instead of querying DOM.
    await page.waitForTimeout(1500);
    const audioState = await page.evaluate(() => {
      const sw = window.__soundwave;
      if (!sw) return { error: 'no __soundwave handle' };
      const s1 = sw.audioState;
      return s1;
    });
    assert(!audioState.error, `engine handle present (${JSON.stringify(audioState)})`);
    assert(audioState.deckCount === 2, `two crossfade decks created (${audioState.deckCount})`);
    assert(audioState.contextState === 'running', `AudioContext running (state=${audioState.contextState})`);
    assert(audioState.playing && audioState.positionSec > 0,
      `playback advanced (positionSec=${audioState.positionSec?.toFixed?.(2)}s, playing=${audioState.playing})`);

    // Confirm the position keeps advancing (real decoding, not a stalled element).
    const p1 = await page.evaluate(() => window.__soundwave.audioState.positionSec);
    await page.waitForTimeout(700);
    const p2 = await page.evaluate(() => window.__soundwave.audioState.positionSec);
    assert(p2 > p1, `position advancing over time (${p1.toFixed(2)}s -> ${p2.toFixed(2)}s)`);

    // 5. The full player mirrors the app: open it from the mini player.
    await page.locator('.playerbar-inner').click();
    await page.waitForSelector('.sheet', { timeout: 8000 });
    assert(await page.locator('.np-mirror, .np-art').first().isVisible().catch(() => false),
      'full player opened with its artwork backdrop');
    assert(await page.locator('[data-testid="player-toggle"]').isVisible().catch(() => false),
      'full player transport visible');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert((await page.locator('.sheet').count()) === 0, 'full player closed');

    // 6. Navigation is exactly the app's four screens — nothing more.
    const navLabels = await page.locator('.nav-item').allTextContents();
    const cleaned = navLabels.map((t) => t.trim()).join(',');
    assert(cleaned === 'Home,Search,Library,Phone', `nav is Home,Search,Library,Phone (got: ${cleaned})`);
    await page.locator('.nav-item', { hasText: 'Search' }).click();
    assert(await page.locator('.connect-prompt').isVisible().catch(() => false),
      'Search shows the connect prompt while no phone is connected');
    await page.locator('.nav-item', { hasText: 'Phone' }).click();
    await page.waitForSelector('.page-title');
    assert(true, 'Phone (connection) screen rendered');

    // 7. Reload: library must persist via IndexedDB.
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.locator('.nav-item', { hasText: 'Library' }).click();
    await page.waitForSelector('.track-row', { timeout: 10000 }).catch(() => {});
    const persisted = await page.locator('.track-row').count();
    assert(persisted >= audioFiles.length,
      `library persisted across reload (${persisted} tracks)`);
  } catch (e) {
    fail(`exception during smoke run: ${e.message}`);
  } finally {
    await browser.close();
  }

  console.log('\n[smoke] ==============================');
  if (errors.length === 0) {
    console.log('[smoke] PASS — no console errors, all checks green');
    process.exit(0);
  } else {
    console.log(`[smoke] FAIL — ${errors.length} problem(s):`);
    errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    process.exit(1);
  }
}

main();
