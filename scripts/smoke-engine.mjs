/**
 * Engine-behaviour smoke test: verifies the three end-of-track fixes that a plain "does it play"
 * check cannot see. Runs against the built site via `vite preview`.
 *
 *   1. Natural-end auto-advance — with crossfade OFF, a track that reaches its end moves the queue
 *      on by itself (the missing native `ended` handler used to stall the queue here).
 *   2. Single history booking — that natural end books the outgoing track's play stats exactly
 *      once (playCount === 1), not twice (the old `ended`+`next()` path double-booked).
 *   3. Crossfade index sync — with crossfade ON, an automatic fade swaps the deck AND the store's
 *      queueIndex follows, so the UI shows the track that is actually playing.
 *
 * Each scenario seeks near the end of a 6s fixture to trigger the transition quickly.
 */
import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:4173/';
const AUDIO_DIR = process.env.SMOKE_AUDIO_DIR || '/tmp/sw-audio';

const errors = [];
const log = (...a) => console.log('[engine]', ...a);
function assert(cond, msg) {
  if (cond) log('ok —', msg);
  else { errors.push(msg); console.error('[engine][FAIL]', msg); }
}

const snap = (page) => page.evaluate(() => window.__soundwave.snapshot());
const audio = (page) => page.evaluate(() => window.__soundwave.audioState);

async function importAndQueue(page, files) {
  await page.locator('input[type="file"]').first().setInputFiles(files);
  await page.waitForSelector('.track-row', { timeout: 20000 });
  // Play all from the library so the queue is the full set.
  await page.locator('.btn.primary', { hasText: 'Play all' }).first().click();
  await page.waitForFunction(() => window.__soundwave.audioState.trackId !== null, null, { timeout: 10000 });
}

async function main() {
  const files = readdirSync(AUDIO_DIR)
    .filter((f) => /\.(wav|mp3|flac|ogg|m4a)$/i.test(f))
    .sort()
    .map((f) => path.join(AUDIO_DIR, f));
  if (files.length < 2) { console.error('need >=2 fixtures'); process.exit(2); }

  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.brand', { timeout: 10000 });

    /* ---------------- Scenario 1 + 2: natural end, crossfade OFF ---------------- */
    log('— Scenario 1/2: natural-end auto-advance + single booking (crossfade off)');
    await page.evaluate(() => window.__soundwave.store.getState().setCrossfade(false, 6));
    await importAndQueue(page, files);

    let s = await snap(page);
    assert(s.queueLength >= 2, `queue built with ${s.queueLength} tracks`);
    const firstId = s.currentQueueId;
    assert(s.queueIndex === 0, `starts at index 0`);

    // Seek near the end of the first track and let it run out.
    const dur = (await audio(page)).durationSec;
    await page.evaluate((d) => window.__soundwave.store.getState().seek(Math.max(0, d - 0.4)), dur);
    await page.waitForFunction(
      (prevId) => window.__soundwave.snapshot().currentQueueId !== prevId,
      firstId,
      { timeout: 8000 },
    ).catch(() => {});
    await page.waitForTimeout(400);

    s = await snap(page);
    assert(s.queueIndex === 1, `auto-advanced to index 1 after natural end (got ${s.queueIndex})`);
    assert(s.currentQueueId !== firstId, `queue now on a different track`);

    // History for the first track must be booked exactly once.
    const firstStats = Object.values(s.stats).find((st) => st.playCount >= 1 || st.totalPlayTimeMs > 0);
    const booked = Object.values(s.stats).filter((st) => st.playCount === 1);
    const doubleBooked = Object.values(s.stats).filter((st) => st.playCount > 1);
    assert(s.statsCount >= 1, `history recorded (${s.statsCount} stat rows)`);
    assert(doubleBooked.length === 0,
      `no track double-booked (playCount>1 rows: ${doubleBooked.length})`);
    assert(booked.length >= 1, `completed play booked once (playCount===1 rows: ${booked.length})`);
    void firstStats;

    /* ---------------- Scenario 3: automatic crossfade syncs the index ---------------- */
    log('— Scenario 3: automatic crossfade syncs store queueIndex');
    // Fresh page so the queue/history start clean, crossfade ON with a short window.
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('.brand', { timeout: 10000 });
    await page.evaluate(() => window.__soundwave.store.getState().setCrossfade(true, 2));
    await importAndQueue(page, files);

    s = await snap(page);
    const cfFirstId = s.currentQueueId;
    assert(s.queueIndex === 0, `crossfade scenario starts at index 0`);

    // Seek so remaining time (<=2s) is inside the crossfade window; the scheduler should fire.
    const dur2 = (await audio(page)).durationSec;
    await page.evaluate((d) => window.__soundwave.store.getState().seek(Math.max(0, d - 1.5)), dur2);

    await page.waitForFunction(
      (prevId) => window.__soundwave.snapshot().currentQueueId !== prevId,
      cfFirstId,
      { timeout: 8000 },
    ).catch(() => {});
    await page.waitForTimeout(500);

    s = await snap(page);
    const a = await audio(page);
    assert(s.currentQueueId !== cfFirstId,
      `crossfade advanced to the next track (store index ${s.queueIndex})`);
    assert(s.queueIndex === 1, `store queueIndex synced to 1 after auto-crossfade (got ${s.queueIndex})`);
    assert(a.trackId === s.currentQueueId,
      `engine's active track matches the store's (engine=${a.trackId}, store=${s.currentQueueId})`);
  } catch (e) {
    errors.push('exception: ' + e.message);
  } finally {
    await browser.close();
  }

  console.log('\n[engine] ==============================');
  if (errors.length === 0) {
    console.log('[engine] PASS — auto-advance, single booking, and crossfade sync all verified');
    process.exit(0);
  }
  console.log(`[engine] FAIL — ${errors.length} problem(s):`);
  errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  process.exit(1);
}

main();
