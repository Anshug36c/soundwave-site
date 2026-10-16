/**
 * Remote Web Player smoke test: the built site (vite preview) talks to a
 * bridge and actually plays phone-provided audio in the browser.
 *
 * Default: spawns scripts/bridge-sim.mjs (protocol simulator with generated
 * WAV tones — no phone, no YouTube). For a REAL bridge, set:
 *   BRIDGE_URL=http://<bridge-address> BRIDGE_CODE=<code from SoundWave>
 * and the simulator is skipped (used locally against the Kotlin server and
 * through a real tunnel).
 *
 * Asserts: health-gated pairing (wrong code rejected), Home recommendations
 * and search via phone,
 * browser-side playback advancing, Range seek, pause/resume, queue + next,
 * and that the site's local library player is never started by any of it.
 *
 * Run: node scripts/smoke-bridge.mjs   (needs `npm run build`)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const SIM_PORT = 8931;
const PREVIEW_PORT = Number(process.env.SMOKE_PORT || 4173);
const BASE = process.env.SMOKE_BASE_URL || `http://localhost:${PREVIEW_PORT}/`;
const BRIDGE_URL = process.env.BRIDGE_URL || `http://127.0.0.1:${SIM_PORT}`;
const CODE = process.env.BRIDGE_CODE || '246810';

const errors = [];
const ok = (m) => console.log('[bridge] ok —', m);
const fail = (m) => { errors.push(m); console.error('[bridge][FAIL]', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync('dist/index.html')) { console.error('[bridge] dist missing — run npm run build'); process.exit(2); }

const children = [];
function spawnChild(args, opts = {}) {
  const child = spawn(args[0], args.slice(1), { stdio: 'ignore', detached: true, ...opts });
  children.push(child);
  return child;
}
function cleanup() {
  for (const c of children) { try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch {} } }
}
const watchdog = setTimeout(() => { console.error('[bridge] WATCHDOG'); cleanup(); process.exit(3); }, 120000);

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await sleep(300);
  }
  throw new Error(`${label} did not come up at ${url}`);
}

try {
  if (!process.env.BRIDGE_URL) {
    spawnChild([process.execPath, 'scripts/bridge-sim.mjs', String(SIM_PORT)]);
    await waitFor(`${BRIDGE_URL}/api/health`, 'bridge simulator');
    ok('bridge simulator up');
  } else {
    await waitFor(`${BRIDGE_URL}/api/health`, 'real bridge');
    ok(`real bridge reachable at ${BRIDGE_URL}`);
  }
  if (!process.env.SMOKE_BASE_URL) {
    spawnChild(['npx', 'vite', 'preview', '--host', '0.0.0.0', '--port', String(PREVIEW_PORT)]);
    await waitFor(BASE, 'vite preview');
  }

  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // The deliberate wrong-pairing-code probe returns 401, which Chromium
    // logs as a resource error. That one is the test working as intended.
    if (/Failed to load resource:.*\b401\b/.test(m.text())) return;
    errors.push('console: ' + m.text());
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.brand');
  await page.locator('.nav-item', { hasText: 'Phone' }).click();
  await page.waitForSelector('.page-title');
  ok('Phone tab opened');

  const remote = (expr) => page.evaluate(new Function('return window.__soundwave.remote.getState().' + expr));
  const snapshot = () => page.evaluate(() => window.__soundwave.snapshot());

  // Pairing: health check passes but a wrong code must be rejected clearly.
  await page.locator('input[placeholder*="lhr.life"]').fill(BRIDGE_URL);
  await page.locator('input[placeholder*="pairing code"]').fill('000000');
  await page.locator('button', { hasText: 'Connect' }).click();
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="alert"]');
    return el && /pairing code/i.test(el.textContent || '');
  }, null, { timeout: 8000 }).catch(() => {});
  let alertText = await page.locator('[role="alert"]').first().textContent().catch(() => '');
  if (/pairing code/i.test(alertText || '')) ok('wrong pairing code rejected with a clear message');
  else fail(`wrong code not rejected (alert=${JSON.stringify(alertText)})`);
  if ((await remote('phase')) === 'online') fail('marked online after a wrong pairing code');
  else ok('never reported Connected for a failed pairing');

  // Correct code connects (verified session, not just health).
  await page.locator('input[placeholder*="pairing code"]').fill(CODE);
  await page.locator('button', { hasText: 'Connect' }).click();
  await page.waitForFunction(() => window.__soundwave.remote.getState().phase === 'online', null, { timeout: 10000 }).catch(() => {});
  if ((await remote('phase')) === 'online') ok('paired and online after health + session check');
  else fail(`did not come online (error=${await remote('error')})`);

  const before = await snapshot();
  if (!before.playing && before.queueLength === 0) ok('local library player idle before remote playback');
  else fail(`local player unexpectedly active: ${JSON.stringify(before)}`);

  // Home shelves come from the phone's home feed (simulator here).
  await page.locator('.nav-item', { hasText: 'Home' }).click();
  await page.waitForSelector('[data-testid="recommended-track"]', { timeout: 8000 });
  const sectionCount = await page.locator('[data-testid="remote-section"]').count();
  if (sectionCount >= 2) ok(`Home shelves arrived from the bridge (${sectionCount} sections)`);
  else fail(`expected multiple home sections, got ${sectionCount}`);

  // Album page via typed search: open the detail page and play its first
  // song — full catalogue navigation, still browser-side playback only.
  await page.locator('.nav-item', { hasText: 'Search' }).click();
  await page.locator('.chip', { hasText: 'Albums' }).click();
  await page.locator('input[placeholder*="Search songs"]').fill('tone');
  await page.locator('input[placeholder*="Search songs"]').press('Enter');
  await page.waitForSelector('[data-testid="search-item"]', { timeout: 8000 });
  await page.locator('[data-testid="search-item"]').first().click();
  await page.waitForSelector('[data-testid="detail"]', { timeout: 8000 });
  ok('album detail page opened from search');
  await page.locator('[data-testid="detail-play-all"]').click();
  await page.waitForFunction(() => {
    const a = window.__soundwave.remoteAudio;
    return a && !a.paused && a.readyState >= 2;
  }, null, { timeout: 10000 }).catch(() => {});
  if ((await page.evaluate(() => window.__soundwave.remoteAudio))?.paused === false) ok('album Play-all plays in the browser');
  else fail('album Play-all did not start playback');
  await page.evaluate(() => window.__soundwave.remote.getState().disconnect());
  await page.waitForFunction(() => window.__soundwave.remote.getState().phase === 'offline', null, { timeout: 8000 }).catch(() => {});
  // Reconnect for the rest of the flow.
  await page.locator('.nav-item', { hasText: 'Phone' }).click();
  await page.locator('input[placeholder*="pairing code"]').fill(CODE);
  await page.locator('button', { hasText: 'Connect' }).click();
  await page.waitForFunction(() => window.__soundwave.remote.getState().phase === 'online', null, { timeout: 10000 }).catch(() => {});
  if ((await remote('phase')) === 'online') ok('reconnected after detail-page detour');
  else fail('reconnect after detail page failed');

  // Search runs on the phone (simulator), results render here.
  await page.locator('.nav-item', { hasText: 'Search' }).click();
  await page.locator('.chip', { hasText: 'Songs' }).click();
  await page.locator('input[placeholder*="Search songs"]').fill('tone');
  await page.locator('input[placeholder*="Search songs"]').press('Enter');
  await page.waitForSelector('[data-testid="remote-track"]', { timeout: 8000 });
  ok('search results arrived from the bridge');

  // Play: the browser must actually play, and time must advance.
  await page.locator('[data-testid="remote-track"]').first().click();
  await page.waitForFunction(() => {
    const a = window.__soundwave.remoteAudio;
    return a && !a.paused && a.readyState >= 2;
  }, null, { timeout: 10000 }).catch(() => {});
  let audioState = await page.evaluate(() => window.__soundwave.remoteAudio);
  if (audioState && !audioState.paused) ok(`browser playing bridge audio (src=${audioState.src.slice(0, 80)}…)`);
  else fail(`audio not playing: ${JSON.stringify(audioState)}`);
  const t1 = (await page.evaluate(() => window.__soundwave.remoteAudio))?.currentTime ?? 0;
  await sleep(1500);
  const t2 = (await page.evaluate(() => window.__soundwave.remoteAudio))?.currentTime ?? 0;
  if (t2 > t1 + 0.8) ok(`playhead advancing (${t1.toFixed(2)}s -> ${t2.toFixed(2)}s)`);
  else fail(`playhead stuck (${t1} -> ${t2})`);

  const during = await snapshot();
  if (!during.playing && during.queueLength === 0 && (await remote('playing')) === true) {
    ok('remote playback independent: site local player still idle, remote state playing');
  } else {
    fail(`isolation broken: local=${JSON.stringify(during)} remotePlaying=${await remote('playing')}`);
  }

  // Seek via Range.
  await page.evaluate(() => window.__soundwave.remote.getState().seek(5));
  await page.waitForFunction(() => (window.__soundwave.remoteAudio?.currentTime ?? 0) >= 4.2, null, { timeout: 8000 }).catch(() => {});
  const seeked = (await page.evaluate(() => window.__soundwave.remoteAudio))?.currentTime ?? 0;
  if (seeked >= 4.2) ok(`seek landed at ${seeked.toFixed(2)}s`);
  else fail(`seek failed (at ${seeked})`);

  // Pause / resume are local to this player.
  await page.evaluate(() => window.__soundwave.remote.getState().toggle());
  await sleep(400);
  if ((await page.evaluate(() => window.__soundwave.remoteAudio))?.paused) ok('pause works');
  else fail('pause failed');
  await page.evaluate(() => window.__soundwave.remote.getState().toggle());
  await sleep(600);
  if (!(await page.evaluate(() => window.__soundwave.remoteAudio))?.paused) ok('resume works');
  else fail('resume failed');

  // Queue + next: playing a result made the 2 results the queue; enqueue
  // appends one more, then Next skips to the second track.
  const queueBefore = await remote('queue.length');
  await page.evaluate(() => {
    const s = window.__soundwave.remote.getState();
    s.enqueue(s.results[1]);
  });
  if ((await remote('queue.length')) === queueBefore + 1) ok('enqueue grew the remote queue only');
  else fail(`queue length=${await remote('queue.length')} (was ${queueBefore})`);
  await page.evaluate(() => window.__soundwave.remote.getState().next());
  await page.waitForFunction(() => {
    const s = window.__soundwave.remote.getState();
    const a = window.__soundwave.remoteAudio;
    return s.index === 1 && a && !a.paused;
  }, null, { timeout: 10000 }).catch(() => {});
  const nowTitle = await page.evaluate(() => {
    const s = window.__soundwave.remote.getState();
    return s.queue[s.index]?.title;
  });
  if (nowTitle === 'Sim Tone Two') ok('next advanced to the queued track');
  else fail(`next failed (now=${nowTitle})`);

  // The phone sees this player's state (its own player untouched by design).
  const token = await page.evaluate(() => sessionStorage.getItem('sw.remote.token'));
  if (token) {
    const st = await fetch(`${BRIDGE_URL}/api/state`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).catch(() => null);
    if (st?.remoteState?.track?.id === 'simtone0002' && st?.remoteState?.playing === true) {
      ok('bridge received the web player state (track + playing)');
    } else {
      fail(`bridge state mismatch: ${JSON.stringify(st?.remoteState)}`);
    }
  } else {
    fail('no session token in sessionStorage');
  }

  // Disconnect revokes and stops.
  await page.evaluate(() => window.__soundwave.remote.getState().disconnect());
  await sleep(400);
  if ((await remote('phase')) === 'offline') ok('disconnect returned to offline');
  else fail('disconnect failed');

  await browser.close();
} catch (e) {
  fail('exception: ' + (e?.message || e));
} finally {
  clearTimeout(watchdog);
  cleanup();
}

if (errors.length) {
  console.error(`\n[bridge] ${errors.length} FAILURE(S)`);
  for (const e of errors) console.error('[bridge] -', e);
  process.exit(1);
}
console.log('\n[bridge] ALL OK');
