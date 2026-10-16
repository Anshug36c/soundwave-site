/**
 * Listen Together integration smoke test.
 *
 * Proves the deployed web client and a *simulated Soundwave app* interoperate through the relay
 * using the real on-the-wire protocol (binary protobuf Envelope frames):
 *
 *   1. app-sim (host) creates a room; the browser joins as guest.
 *   2. host change_track -> the browser resolves the song in its local library and loads it.
 *   3. host play / pause / seek -> the browser's engine mirrors each.
 *   4. host change_track to a song the library lacks -> browser flags it unavailable.
 *   5. reverse: browser creates a room as host and plays locally; app-sim (guest) receives the
 *      broadcast sync_playback (i.e. the phone would follow the web).
 *
 * Requires the built site (`npm run build`) and fixtures (`npm run fixtures`).
 */
import { chromium } from 'playwright';
import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const APP_PORT = 4173;
const RELAY_PORT = 8902;
const BASE = `http://localhost:${APP_PORT}/`;
const RELAY = `ws://127.0.0.1:${RELAY_PORT}`;
const AUDIO_DIR = process.env.SMOKE_AUDIO_DIR || path.join(process.cwd(), '.fixtures/audio');

const enc = new TextEncoder();
const dec = new TextDecoder();
const errors = [];
const ok = (m) => console.log('[lt] ok —', m);
const fail = (m) => { errors.push(m); console.error('[lt][FAIL]', m); };

/* ---- minimal protobuf client codec (mirrors src/lib/ltProto.ts) ---- */
function wv(o, v) { v = Math.max(0, Math.floor(v)); while (v > 0x7f) { o.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); } o.push(v & 0x7f); }
function ld(o, f, b) { wv(o, (f << 3) | 2); wv(o, b.length); o.push(...b); }
function ws_(o, f, s) { if (s) ld(o, f, [...enc.encode(s)]); }
function wi(o, f, n) { if (n) { wv(o, (f << 3) | 0); wv(o, n); } }
function env(type, payload) { const o = []; ws_(o, 1, type); if (payload?.length) ld(o, 2, [...payload]); return Buffer.from(o); }
function rdv(b, p) { let r = 0, sh = 1; for (;;) { const x = b[p.i++]; r += (x & 0x7f) * sh; if (!(x & 0x80)) break; sh *= 128; } return r; }
function rd(b) { const o = []; const p = { i: 0 }; while (p.i < b.length) { const k = rdv(b, p); const n = Math.floor(k / 8); const w = k & 7; if (w === 0) o.push({ n, v: rdv(b, p) }); else if (w === 2) { const l = rdv(b, p); o.push({ n, b: b.slice(p.i, p.i + l) }); p.i += l; } else if (w === 5) p.i += 4; else if (w === 1) p.i += 8; else break; } return o; }
function denv(b) { let type = '', payload = Buffer.alloc(0); for (const f of rd(b)) { if (f.n === 1 && f.b) type = dec.decode(f.b); else if (f.n === 2 && f.b) payload = f.b; } return { type, payload }; }
function dstr(b, n) { for (const f of rd(b)) if (f.n === n && f.b) return dec.decode(f.b); return ''; }
function trackInfo(id, title, artist) { const o = []; ws_(o, 1, id); ws_(o, 2, title); ws_(o, 3, artist); wi(o, 5, 6000); return Buffer.from(o); }
function playback(action, ti, position) { const o = []; ws_(o, 1, action); if (ti) ld(o, 4, [...ti]); wi(o, 3, position); return Buffer.from(o); }

function appClient() {
  const c = { ws: null, inbox: [] };
  c.connect = () => new Promise((res, rej) => {
    c.ws = new WebSocket(RELAY);
    c.ws.on('open', res);
    c.ws.on('error', rej);
    c.ws.on('message', (d) => c.inbox.push(denv(Buffer.from(d))));
  });
  c.expect = (type, timeout = 6000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const poll = setInterval(() => {
      const i = c.inbox.findIndex((m) => m.type === type);
      if (i >= 0) { clearInterval(poll); return res(c.inbox.splice(i, 1)[0]); }
      if (Date.now() - t0 > timeout) { clearInterval(poll); rej(new Error(`app-sim timeout waiting ${type}`)); }
    }, 25);
  });
  c.send = (type, payload) => c.ws.send(env(type, payload));
  return c;
}

if (!existsSync('dist/index.html')) { console.error('[lt] dist/ missing — run npm run build'); process.exit(2); }
const files = readdirSync(AUDIO_DIR).filter((f) => /\.wav$/i.test(f)).sort().map((f) => path.join(AUDIO_DIR, f));

const relay = spawn(process.execPath, ['server/relay.mjs'], { env: { ...process.env, PORT: String(RELAY_PORT), AUTO_APPROVE: '1' }, stdio: 'ignore', detached: true });
const killRelay = () => { try { process.kill(-relay.pid, 'SIGTERM'); } catch {} };
const preview = spawn('npx', ['vite', 'preview', '--host', '0.0.0.0', '--port', String(APP_PORT)], { stdio: 'ignore', detached: true });
const killPreview = () => { try { process.kill(-preview.pid, 'SIGTERM'); } catch {} };
const cleanup = () => { killRelay(); killPreview(); };
const watchdog = setTimeout(() => { console.error('[lt] WATCHDOG'); cleanup(); process.exit(3); }, 90000);

const waitHttp = async () => { for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE); if (r.ok) return; } catch {} await new Promise((r) => setTimeout(r, 300)); } throw new Error('preview did not start'); };

try {
  await waitHttp();
  await new Promise((r) => setTimeout(r, 500)); // relay bind

  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.brand');

  // Import fixtures so the guest has a library to resolve host tracks against.
  await page.locator('input[type="file"]').first().setInputFiles(files);
  await page.waitForSelector('.track-row', { timeout: 20000 });

  // Point the web client at the local relay.
  await page.evaluate((url) => window.__soundwave.store.getState().updateSettings({ ltServerUrl: url, ltUsername: 'WebBrowser' }), RELAY);

  const ltState = () => page.evaluate(() => {
    const s = window.__soundwave.listenTogether.getState();
    return { connection: s.connection, role: s.role, roomCode: s.roomCode, current: s.currentTrack?.title ?? null, isPlaying: s.isPlaying, missing: s.missingTrack?.title ?? null, users: s.users.length };
  });
  const audio = () => page.evaluate(() => window.__soundwave.audioState);

  /* ---- 1. app-sim hosts; browser joins as guest ---- */
  const app = appClient();
  await app.connect();
  app.send('create_room', (() => { const o = []; ws_(o, 1, 'HostPhone'); return Buffer.from(o); })());
  const created = await app.expect('room_created');
  const code = dstr(created.payload, 1);
  ok(`app-sim created room ${code}`);

  await page.evaluate((c) => window.__soundwave.listenTogether.getState().joinRoom(c), code);
  await page.waitForFunction(() => window.__soundwave.listenTogether.getState().role === 'guest', null, { timeout: 8000 });
  let s = await ltState();
  ok(`browser joined as guest (room ${s.roomCode}, users ${s.users})`);

  /* ---- 2. host changes track -> browser loads the matching local song ---- */
  app.send('playback_action', playback('change_track', trackInfo('track1|unknown artist', 'track1', 'Unknown Artist')));
  await page.waitForFunction(() => window.__soundwave.audioState.trackId === 'track1|unknown artist', null, { timeout: 8000 }).catch(() => {});
  let a = await audio();
  if (a.trackId === 'track1|unknown artist') ok('guest resolved host track to local library and loaded it');
  else fail(`guest did not load host track (engine=${a.trackId})`);

  /* ---- 3. host play / pause / seek -> browser mirrors ---- */
  app.send('playback_action', playback('play', null, 1000));
  await page.waitForFunction(() => window.__soundwave.audioState.playing === true, null, { timeout: 6000 }).catch(() => {});
  a = await audio();
  if (a.playing) ok('guest mirrored host PLAY'); else fail('guest did not start playing on host play');

  app.send('playback_action', playback('pause', null, 2000));
  await page.waitForFunction(() => window.__soundwave.audioState.playing === false, null, { timeout: 6000 }).catch(() => {});
  a = await audio();
  if (!a.playing) ok('guest mirrored host PAUSE'); else fail('guest did not pause on host pause');

  app.send('playback_action', playback('seek', null, 4000));
  await page.waitForFunction(() => Math.abs(window.__soundwave.audioState.positionSec - 4) < 0.8, null, { timeout: 6000 }).catch(() => {});
  a = await audio();
  if (Math.abs(a.positionSec - 4) < 0.8) ok(`guest mirrored host SEEK (position ${a.positionSec.toFixed(2)}s)`);
  else fail(`guest seek mismatch (position ${a.positionSec})`);

  /* ---- 4. host track not in library -> flagged unavailable ---- */
  app.send('playback_action', playback('change_track', trackInfo('nope|nobody', 'nope', 'nobody')));
  await page.waitForFunction(() => window.__soundwave.listenTogether.getState().missingTrack !== null, null, { timeout: 6000 }).catch(() => {});
  s = await ltState();
  if (s.missing === 'nope') ok('guest flagged unavailable track instead of silently ignoring');
  else fail(`missingTrack not set (got ${s.missing})`);

  /* ---- 5. reverse: browser hosts, app-sim guest receives broadcast ---- */
  await page.evaluate(() => window.__soundwave.listenTogether.getState().leave());
  await page.evaluate(() => window.__soundwave.listenTogether.getState().createRoom());
  await page.waitForFunction(() => window.__soundwave.listenTogether.getState().role === 'host', null, { timeout: 8000 });
  const webRoom = await page.evaluate(() => window.__soundwave.listenTogether.getState().roomCode);
  const guest = appClient();
  await guest.connect();
  guest.send('join_room', (() => { const o = []; ws_(o, 1, webRoom); ws_(o, 2, 'PhoneGuest'); return Buffer.from(o); })());
  await guest.expect('join_approved');
  ok(`app-sim joined web-hosted room ${webRoom}`);

  await page.evaluate(() => window.__soundwave.store.getState().playTrack('track2|unknown artist'));
  const sync = await guest.expect('sync_playback', 8000);
  const action = dstr(sync.payload, 1);
  ok(`web host broadcast reached app-sim guest (action=${action})`);
  if (action !== 'change_track') fail(`expected change_track broadcast, got ${action}`);

  await browser.close();
} catch (e) {
  errors.push('exception: ' + e.message);
} finally {
  clearTimeout(watchdog);
  cleanup();
}

console.log('\n[lt] ==============================');
if (errors.length === 0) { console.log('[lt] PASS — web and app interoperate over Listen Together'); process.exit(0); }
console.log(`[lt] FAIL — ${errors.length} problem(s):`); errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
process.exit(1);
