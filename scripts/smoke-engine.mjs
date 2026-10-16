/**
 * Engine-behaviour smoke test: verifies the end-of-track behaviours a plain
 * "does it play" check cannot see. Runs against the built site via
 * `vite preview`, driving the local library player.
 *
 *   1. Natural-end auto-advance — a track that reaches its end moves the
 *      queue on by itself, and the store index matches the engine's track.
 *   2. Repeat-one — with repeat set to "one", a natural end replays the
 *      same track instead of advancing.
 *
 * Each scenario seeks near the end of a 6s fixture to trigger the
 * transition quickly.
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

async function importAndPlay(page, files) {
  await page.locator('.nav-item', { hasText: 'Library' }).click();
  await page.locator('input[type="file"]').first().setInputFiles(files);
  await page.waitForSelector('.track-row', { timeout: 20000 });
  // Playing the first row queues the whole visible library list.
  await page.locator('.track-row').first().click();
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

    /* ---------------- Scenario 1: natural end auto-advances ---------------- */
    log('— Scenario 1: natural-end auto-advance');
    await importAndPlay(page, files);

    let s = await snap(page);
    assert(s.queueLength >= 2, `queue built with ${s.queueLength} tracks`);
    const firstId = s.currentQueueId;
    assert(s.queueIndex === 0, 'starts at index 0');

    const dur = (await audio(page)).durationSec;
    await page.evaluate((d) => window.__soundwave.store.getState().seek(Math.max(0, d - 0.4)), dur);
    await page.waitForFunction(
      (prevId) => window.__soundwave.snapshot().currentQueueId !== prevId,
      firstId,
      { timeout: 8000 },
    ).catch(() => {});
    await page.waitForTimeout(400);

    s = await snap(page);
    const a = await audio(page);
    assert(s.queueIndex === 1, `auto-advanced to index 1 after natural end (got ${s.queueIndex})`);
    assert(s.currentQueueId !== firstId, 'queue now on a different track');
    assert(a.trackId === s.currentQueueId,
      `engine's active track matches the store's (engine=${a.trackId}, store=${s.currentQueueId})`);

    /* ---------------- Scenario 2: repeat-one replays ---------------- */
    log('— Scenario 2: repeat-one replays the same track');
    await page.evaluate(() => {
      const st = window.__soundwave.store.getState();
      st.cycleRepeat(); // off -> all
      st.cycleRepeat(); // all -> one
    });
    s = await snap(page);
    assert(s.settings.repeat === 'one', `repeat is 'one' (got ${s.settings.repeat})`);
    const repeatId = s.currentQueueId;
    const dur2 = (await audio(page)).durationSec;
    await page.evaluate((d) => window.__soundwave.store.getState().seek(Math.max(0, d - 0.4)), dur2);
    await page.waitForTimeout(1500);
    s = await snap(page);
    const a2 = await audio(page);
    assert(s.currentQueueId === repeatId, 'repeat-one stayed on the same track after its end');
    assert(a2.playing, 'repeat-one is playing again after replay');
  } catch (e) {
    errors.push('exception: ' + e.message);
  } finally {
    await browser.close();
  }

  console.log('\n[engine] ==============================');
  if (errors.length === 0) {
    console.log('[engine] PASS — auto-advance and repeat-one verified');
    process.exit(0);
  }
  console.log(`[engine] FAIL — ${errors.length} problem(s):`);
  errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  process.exit(1);
}

main();
