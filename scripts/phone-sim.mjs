/**
 * Reference implementation of the Soundwave app's "Serve to web" (Mode A) HTTP server, in Node.
 *
 * It mirrors exactly what the embedded Android server must expose, so the web client can be tested
 * against a stand-in for the phone:
 *   GET  /                -> the built website (dist/)
 *   GET  /api/state?code  -> transport snapshot
 *   POST /api/action?code -> {action: play|pause|seek|next|prev|playTrack, positionMs?, index?}
 *   GET  /api/audio?code  -> the current track's bytes (what the browser's <audio> plays)
 *
 * Run: node scripts/phone-sim.mjs [port] [audioDir]
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.argv[2] || 8811);
const AUDIO_DIR = process.argv[3] || path.join(process.cwd(), '.fixtures/audio');
const CODE = process.env.PHONE_CODE || 'LAN123';
const DIST = path.join(process.cwd(), 'dist');

const files = ['track1.wav', 'track2.wav', 'track3.wav']
  .map((f) => path.join(AUDIO_DIR, f))
  .filter((f) => existsSync(f));
if (files.length === 0) {
  console.error('no fixtures; run npm run fixtures');
  process.exit(2);
}

const player = { index: 0, playing: false, baseMs: 0, startedAt: 0 };
const durationMs = 6000;

function positionMs() {
  return player.playing ? player.baseMs + (Date.now() - player.startedAt) : player.baseMs;
}
function trackMeta(i) {
  const name = path.basename(files[i], '.wav');
  return { id: `${name}|unknown artist`, title: name, artist: 'Unknown Artist' };
}
function stateJson() {
  return JSON.stringify({
    playing: player.playing,
    positionMs: Math.min(positionMs(), durationMs),
    durationMs,
    volume: 0.9,
    track: trackMeta(player.index),
    queue: files.map((_, i) => trackMeta(i)),
  });
}
function doAction(a) {
  switch (a.action) {
    case 'play':
      if (!player.playing) { player.playing = true; player.startedAt = Date.now(); }
      break;
    case 'pause':
      if (player.playing) { player.baseMs = positionMs(); player.playing = false; }
      break;
    case 'seek':
      player.baseMs = Math.max(0, Math.min(a.positionMs ?? 0, durationMs));
      player.startedAt = Date.now();
      break;
    case 'next':
      player.index = (player.index + 1) % files.length; player.baseMs = 0; player.startedAt = Date.now();
      break;
    case 'prev':
      player.index = (player.index - 1 + files.length) % files.length; player.baseMs = 0; player.startedAt = Date.now();
      break;
    case 'playTrack':
      if (typeof a.index === 'number' && files[a.index]) { player.index = a.index; player.baseMs = 0; player.startedAt = Date.now(); player.playing = true; }
      break;
  }
}

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.wav': 'audio/wav' };

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');
  const p = url.pathname;

  if (p.startsWith('/api/') || p === '/api/audio') {
    if (code !== CODE) { res.writeHead(401).end('bad code'); return; }
  }

  if (p === '/api/state') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(stateJson()); return; }
  if (p === '/api/action' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { try { doAction(JSON.parse(body)); } catch {} res.writeHead(200, { 'Content-Type': 'application/json' }).end(stateJson()); });
    return;
  }
  if (p === '/api/audio') {
    const data = readFileSync(files[player.index]);
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : data.length - 1;
      if (start >= data.length || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }).end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': 'audio/wav',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${data.length}`,
        'Content-Length': end - start + 1,
        'Cache-Control': 'no-store',
      });
      res.end(data.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Accept-Ranges': 'bytes',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    res.end(data);
    return;
  }

  // static site
  let file = p === '/' ? '/index.html' : p;
  const full = path.join(DIST, file);
  if (!full.startsWith(DIST) || !existsSync(full) || statSync(full).isDirectory()) { res.writeHead(404).end('nf'); return; }
  const ext = path.extname(full);
  res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
  res.end(readFileSync(full));
});

server.listen(PORT, '0.0.0.0', () => console.log(`[phone-sim] serving site + audio on http://localhost:${PORT} (code ${CODE})`));
