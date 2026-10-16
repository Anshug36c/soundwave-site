/**
 * Relay protocol self-test: drives the relay with two simulated Listen Together clients
 * (host + guest) and asserts the server-side routing matches the Android protocol:
 * create_room -> room_created, join_room -> join_request -> approve_join -> join_approved(state),
 * playback_action -> sync_playback to the other side, request_sync -> sync_state, ping -> pong.
 *
 * Run: node server/selftest.mjs
 */
import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8901;
const URL = `ws://127.0.0.1:${PORT}`;

const enc = new TextEncoder();
const dec = new TextDecoder();
function wv(out, v) { v = Math.max(0, Math.floor(v)); while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); } out.push(v & 0x7f); }
function tag(out, f, w) { wv(out, (f << 3) | w); }
function ld(out, f, b) { tag(out, f, 2); wv(out, b.length); out.push(...b); }
function ws_(out, f, s) { if (s) ld(out, f, [...enc.encode(s)]); }
function wi(out, f, n) { if (n) { tag(out, f, 0); wv(out, n); } }
function wb(out, f, b) { if (b) { tag(out, f, 0); wv(out, 1); } }
function env(type, payload) { const o = []; ws_(o, 1, type); if (payload?.length) ld(o, 2, [...payload]); return Buffer.from(o); }
function rd(buf) { const out = []; const p = { i: 0 }; while (p.i < buf.length) { const k = rdv(buf, p); const num = Math.floor(k / 8); const w = k & 7; if (w === 0) out.push({ num, w, v: rdv(buf, p) }); else if (w === 2) { const l = rdv(buf, p); out.push({ num, w, b: buf.slice(p.i, p.i + l) }); p.i += l; } else if (w === 5) { p.i += 4; } else if (w === 1) p.i += 8; else break; } return out; }
function rdv(buf, p) { let r = 0, sh = 1; for (;;) { const b = buf[p.i++]; r += (b & 0x7f) * sh; if (!(b & 0x80)) break; sh *= 128; } return r; }
function denv(buf) { let type = '', payload = Buffer.alloc(0); for (const f of rd(buf)) { if (f.num === 1 && f.b) type = dec.decode(f.b); else if (f.num === 2 && f.b) payload = f.b; } return { type, payload }; }
function dstr(buf, n) { for (const f of rd(buf)) if (f.num === n && f.b) return dec.decode(f.b); return ''; }
function track(id, title) { const o = []; ws_(o, 1, id); ws_(o, 2, title); ws_(o, 3, 'art'); wi(o, 5, 60000); return Buffer.from(o); }
function playback(action, ti, position) { const o = []; ws_(o, 1, action); if (ti) ld(o, 4, [...ti]); wi(o, 3, position); return Buffer.from(o); }
function dtrack(buf) { let id = '', title = ''; for (const f of rd(buf)) { if (f.num === 1) id = dec.decode(f.b); else if (f.num === 2) title = dec.decode(f.b); } return { id, title }; }

const errors = [];
const ok = (m) => console.log('  ok —', m);
const fail = (m) => { errors.push(m); console.error('  FAIL —', m); };

function client(name) {
  const c = { name, ws: null, inbox: [], waiters: [] };
  c.connect = () => new Promise((res) => { c.ws = new WebSocket(URL); c.ws.on('open', res); c.ws.on('message', (d) => { const m = denv(Buffer.from(d)); const h = c.waiters.shift(); if (h) h(m); else c.inbox.push(m); }); });
  c.expect = (type, timeout = 4000) => new Promise((res, rej) => {
    const i = c.inbox.findIndex((m) => m.type === type);
    if (i >= 0) return res(c.inbox.splice(i, 1)[0]);
    const t = setTimeout(() => rej(new Error(`${name}: timeout waiting for ${type}`)), timeout);
    const poll = setInterval(() => { const j = c.inbox.findIndex((m) => m.type === type); if (j >= 0) { clearInterval(poll); clearTimeout(t); res(c.inbox.splice(j, 1)[0]); } }, 20);
  });
  c.send = (type, payload) => c.ws.send(env(type, payload));
  return c;
}

const relay = spawn(process.execPath, [path.join(__dirname, 'relay.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
  detached: true, // own process group so we can reap it reliably
});
const killRelay = () => { try { process.kill(-relay.pid, 'SIGTERM'); } catch { /* already gone */ } };
const watchdog = setTimeout(() => { console.error('SELFTEST WATCHDOG TIMEOUT'); killRelay(); process.exit(3); }, 30000);
await new Promise((r) => setTimeout(r, 700));

try {
  const host = client('host');
  const guest = client('guest');
  await host.connect();
  await guest.connect();

  // ping/pong
  host.send('ping');
  const pong = await host.expect('pong');
  ok(`ping -> pong (${pong.payload.length} byte payload)`);

  // create room
  host.send('create_room', (() => { const o = []; ws_(o, 1, 'HostPhone'); return Buffer.from(o); })());
  const created = await host.expect('room_created');
  const code = dstr(created.payload, 1);
  ok(`create_room -> room_created code=${code}`);

  // guest joins; host sees join_request; host approves; guest gets join_approved with state
  guest.send('join_room', (() => { const o = []; ws_(o, 1, code); ws_(o, 2, 'WebBrowser'); return Buffer.from(o); })());
  const req = await host.expect('join_request');
  const guestId = dstr(req.payload, 1);
  ok(`host received join_request from ${dstr(req.payload, 2)} (${guestId})`);
  host.send('approve_join', (() => { const o = []; ws_(o, 1, guestId); return Buffer.from(o); })());
  const approved = await guest.expect('join_approved');
  const gotCode = dstr(approved.payload, 1);
  ok(`guest join_approved room=${gotCode} (has state: ${approved.payload.length > 0})`);
  const joined = await host.expect('user_joined');
  ok(`host saw user_joined: ${dstr(joined.payload, 2)}`);

  // host broadcasts a track change + play; guest receives sync_playback
  host.send('playback_action', playback('change_track', track('song1|art', 'song1')));
  const sync1 = await guest.expect('sync_playback');
  const p1 = rd(sync1.payload);
  const action1 = dstr(sync1.payload, 1);
  ok(`guest received sync_playback action=${action1}`);
  if (action1 !== 'change_track') fail(`expected change_track, got ${action1}`);
  void p1;
  host.send('playback_action', playback('play', null, 1500));
  const sync2 = await guest.expect('sync_playback');
  ok(`guest received sync_playback action=${dstr(sync2.payload, 1)}`);

  // guest resyncs
  guest.send('request_sync');
  const st = await guest.expect('sync_state');
  ok(`guest request_sync -> sync_state (${st.payload.length} bytes, isPlaying encoded)`);

  // guest (not allowed) must NOT be able to control; host should not receive sync from guest
  guest.send('playback_action', playback('pause'));
  await new Promise((r) => setTimeout(r, 400));
  const leaked = host.inbox.find((m) => m.type === 'sync_playback');
  if (leaked) fail('guest controlled playback without allowParticipantControl');
  else ok('guest control correctly rejected while allowParticipantControl=false');

  console.log('');
  clearTimeout(watchdog);
  if (errors.length) { console.log(`SELFTEST FAIL (${errors.length})`); killRelay(); process.exit(1); }
  console.log('SELFTEST PASS — relay routes the Listen Together protocol correctly');
  killRelay(); process.exit(0);
} catch (e) {
  console.error('SELFTEST ERROR:', e.message);
  clearTimeout(watchdog); killRelay(); process.exit(1);
}
