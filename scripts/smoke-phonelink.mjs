/**
 * Mode A (phone-LAN) smoke test: a Node stand-in for the phone's "Serve to web" server serves the
 * built site over plain http plus the /api + /audio endpoints; a real headless browser opens the
 * phone-served page, enters the pairing code, and must actually play the phone's audio.
 *
 * Run: node scripts/smoke-phonelink.mjs   (needs `npm run build` + `npm run fixtures`)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const PORT = 8811;
const BASE = `http://localhost:${PORT}/`;
const CODE = 'LAN123';
const errors = [];
const ok = (m) => console.log('[phonelink] ok —', m);
const fail = (m) => { errors.push(m); console.error('[phonelink][FAIL]', m); };

if (!existsSync('dist/index.html')) { console.error('[phonelink] dist missing'); process.exit(2); }

const sim = spawn(process.execPath, ['scripts/phone-sim.mjs', String(PORT)], { stdio: 'ignore', detached: true });
const kill = () => { try { process.kill(-sim.pid, 'SIGTERM'); } catch {} };
const watchdog = setTimeout(() => { console.error('[phonelink] WATCHDOG'); kill(); process.exit(3); }, 60000);

try {
  // wait for sim
  for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }

  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.brand');
  ok('phone-served website loaded over plain http');

  await page.locator('.nav-item', { hasText: 'Together' }).click();
  await page.waitForSelector('.page-title');

  // Base URL should be prefilled to the phone's own origin (page served by the phone).
  const prefilled = await page.evaluate(() => window.__soundwave.phoneLink.getState().baseUrl);
  if (prefilled === `http://localhost:${PORT}`) ok(`base URL auto-prefilled to the phone origin (${prefilled})`);
  else fail(`base URL not prefilled (got "${prefilled}")`);

  // Wrong code is rejected.
  await page.evaluate((c) => window.__soundwave.phoneLink.getState().setCode(c), 'WRONG1');
  await page.evaluate(() => window.__soundwave.phoneLink.getState().connect());
  await page.waitForTimeout(400);
  let err = await page.evaluate(() => window.__soundwave.phoneLink.getState().error);
  if (err && /wrong code/i.test(err)) ok('wrong code rejected with a clear error');
  else fail(`wrong code not rejected (error=${err})`);

  // Correct code connects and reports the phone's track.
  await page.evaluate((c) => window.__soundwave.phoneLink.getState().setCode(c), CODE);
  await page.evaluate(() => window.__soundwave.phoneLink.getState().connect());
  await page.waitForFunction(() => window.__soundwave.phoneLink.getState().connected === true, null, { timeout: 6000 }).catch(() => {});
  let st = await page.evaluate(() => window.__soundwave.phoneLink.getState());
  if (st.connected) ok(`connected with code ${CODE}; phone track = ${st.state?.track?.title}`);
  else fail('did not connect with correct code');

  // Play: the browser's <audio> must actually start and advance.
  await page.evaluate(() => window.__soundwave.phoneLink.getState().play());
  await page.waitForFunction(() => { const a = window.__soundwave.phoneAudio; return a && !a.paused; }, null, { timeout: 6000 }).catch(() => {});
  let a = await page.evaluate(() => window.__soundwave.phoneAudio);
  if (a && !a.paused) ok('browser <audio> is playing the phone stream');
  else fail('audio element not playing after Play');
  const t0 = a?.currentTime ?? 0;
  await page.waitForTimeout(900);
  a = await page.evaluate(() => window.__soundwave.phoneAudio);
  if ((a?.currentTime ?? 0) > t0 + 0.3) ok(`playhead advancing (${t0.toFixed(2)}s -> ${a.currentTime.toFixed(2)}s)`);
  else fail(`playhead not advancing (${t0} -> ${a?.currentTime})`);

  // Seek from the web moves the phone (and the stream).
  await page.evaluate(() => window.__soundwave.phoneLink.getState().seek(3));
  await page.waitForFunction(() => Math.abs((window.__soundwave.phoneAudio?.currentTime ?? 0) - 3) < 1, null, { timeout: 6000 }).catch(() => {});
  a = await page.evaluate(() => window.__soundwave.phoneAudio);
  if (Math.abs((a?.currentTime ?? 0) - 3) < 1) ok(`seek from web applied (position ${a?.currentTime?.toFixed(2)}s)`);
  else fail(`seek not applied (${a?.currentTime})`);

  // Pause from the web pauses the stream.
  await page.evaluate(() => window.__soundwave.phoneLink.getState().pause());
  await page.waitForFunction(() => window.__soundwave.phoneAudio?.paused === true, null, { timeout: 6000 }).catch(() => {});
  a = await page.evaluate(() => window.__soundwave.phoneAudio);
  if (a?.paused) ok('pause from web paused the stream');
  else fail('stream not paused after Pause');

  // Next from the web switches the phone's track.
  await page.evaluate(() => window.__soundwave.phoneLink.getState().next());
  await page.waitForFunction(() => window.__soundwave.phoneLink.getState().state?.track?.title === 'track2', null, { timeout: 6000 }).catch(() => {});
  st = await page.evaluate(() => window.__soundwave.phoneLink.getState());
  a = await page.evaluate(() => window.__soundwave.phoneAudio);
  if (st.state?.track?.title === 'track2' && a?.src.includes('track2')) ok('next from web switched phone track and reloaded the stream');
  else fail(`next did not switch track (title=${st.state?.track?.title} src=${a?.src})`);

  await browser.close();
} catch (e) {
  errors.push('exception: ' + e.message);
} finally {
  clearTimeout(watchdog);
  kill();
}

console.log('\n[phonelink] ==============================');
if (errors.length === 0) { console.log('[phonelink] PASS — website plays the phone\'s audio over the LAN server'); process.exit(0); }
console.log(`[phonelink] FAIL — ${errors.length} problem(s):`); errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
process.exit(1);
