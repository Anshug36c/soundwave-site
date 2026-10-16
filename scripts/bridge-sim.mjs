/**
 * Protocol simulator for the SoundWave Remote Web Player bridge.
 *
 * This is NOT the phone and contains no YouTube anything: it implements the
 * bridge HTTP protocol (the same one the Android `RemoteHttpServer`
 * implements and is JVM-tested against) with two synthesized WAV tones, so
 * the web client can be exercised end-to-end in CI without a device:
 *   GET  /api/health            -> {ok, service:"soundwave-remote", ...}
 *   POST /api/pair {code}       -> {sessionToken, ...}   (code: env BRIDGE_CODE, default 246810)
 *   GET  /api/session           -> session info          (Bearer token)
 *   DELETE /api/session         -> revoke                (Bearer token)
 *   GET  /api/search?q=         -> fake catalog matches  (Bearer token)
 *   GET  /api/recommendations   -> the fake catalog as home feed (Bearer token)
 *   GET  /api/home|charts|explore, /api/browse, /api/album|artist|playlist/<id>
 *                               -> fake catalogue shelves + detail pages
 *   POST /api/resolve {trackId} -> {streamPath, ...}     (Bearer token)
 *   GET  /api/stream/<grant>?t= -> WAV bytes, Range-capable
 *   POST /api/state             -> records the web player's own state
 *
 * Run: node scripts/bridge-sim.mjs [port]   (default 8931)
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.argv[2] || 8931);
const CODE = process.env.BRIDGE_CODE || '246810';

function makeWav(freq, seconds = 8, sampleRate = 22050) {
  const frames = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + frames * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22); data.writeUInt32LE(sampleRate, 24); data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36);
  data.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.35 * 32767);
    data.writeInt16LE(v, 44 + i * 2);
  }
  return data;
}

const TRACKS = [
  { id: 'simtone0001', title: 'Sim Tone One', artist: 'Bridge Simulator', album: 'CI Fixtures', durationSec: 8, thumbnailUrl: null, explicit: false, wav: makeWav(440) },
  { id: 'simtone0002', title: 'Sim Tone Two', artist: 'Bridge Simulator', album: 'CI Fixtures', durationSec: 8, thumbnailUrl: null, explicit: false, wav: makeWav(660) },
];

const sessions = new Map(); // token -> {createdAtMs, expiresAtMs, state}
const grants = new Map(); // grantId -> {token, trackId}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function errorJson(res, status, code, message) {
  json(res, status, { error: { code, message } });
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
function auth(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !sessions.has(token)) return null;
  return token;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://sim');
  const path = url.pathname;

  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return;
  }

  try {
    if (path === '/api/health' && req.method === 'GET') {
      return json(res, 200, { ok: true, service: 'soundwave-remote', apiVersion: 1, pairingRequired: true, nowMs: Date.now() });
    }
    if (path === '/api/pair' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (body.code !== CODE) return errorJson(res, 401, 'PAIRING_INVALID', 'Incorrect pairing code.');
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { createdAtMs: Date.now(), expiresAtMs: Date.now() + 12 * 3600_000, state: null });
      return json(res, 200, { sessionToken: token, expiresAtMs: Date.now() + 12 * 3600_000, label: 'session …' + token.slice(-4) });
    }

    if (path.startsWith('/api/stream/')) {
      const grantId = path.split('/').pop();
      const token = (req.headers.authorization || '').replace('Bearer ', '') || url.searchParams.get('t');
      const grant = grants.get(grantId);
      if (!token || !sessions.has(token)) return errorJson(res, 401, 'UNAUTHORIZED', 'Missing or expired session. Pair again.');
      if (!grant || grant.token !== token) return errorJson(res, 404, 'NOT_FOUND', 'Unknown or expired stream.');
      const track = TRACKS.find((t) => t.id === grant.trackId);
      const data = track.wav;
      const range = req.headers.range;
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!m) return errorJson(res, 400, 'VALIDATION', 'Unsupported Range header.');
        let start = m[1] === '' ? data.length - Number(m[2]) : Number(m[1]);
        let end = m[2] === '' || m[1] === '' ? data.length - 1 : Math.min(Number(m[2]), data.length - 1);
        if (end < start) return errorJson(res, 400, 'VALIDATION', 'Bad Range header.');
        const slice = data.subarray(start, end + 1);
        res.writeHead(206, { 'Content-Type': 'audio/wav', 'Content-Length': slice.length, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Accept-Ranges': 'bytes' });
        return res.end(req.method === 'HEAD' ? undefined : slice);
      }
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': data.length, 'Accept-Ranges': 'bytes' });
      return res.end(req.method === 'HEAD' ? undefined : data);
    }

    const token = auth(req);
    if (!token) return errorJson(res, 401, 'UNAUTHORIZED', 'Missing or expired session. Pair again.');

    if (path === '/api/session' && req.method === 'GET') {
      const s = sessions.get(token);
      return json(res, 200, { session: { createdAtMs: s.createdAtMs, expiresAtMs: s.expiresAtMs, lastSeenAtMs: Date.now(), label: 'session …' + token.slice(-4) }, apiVersion: 1 });
    }
    if (path === '/api/session' && req.method === 'DELETE') {
      sessions.delete(token);
      return json(res, 200, { ok: true });
    }
    if (path === '/api/search' && req.method === 'GET' && !(url.searchParams.get('type') && url.searchParams.get('type') !== 'song')) {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const results = TRACKS.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(q) || q.length === 0)
        .map(({ wav, ...meta }) => meta);
      return json(res, 200, { query: q, results });
    }
    if (path === '/api/recommendations' && req.method === 'GET') {
      const results = TRACKS.map(({ wav, ...meta }) => meta);
      return json(res, 200, { results });
    }
    const meta = ({ wav, ...m }) => m;
    const songItem = (t) => ({ type: 'song', id: t.id, title: t.title, subtitle: t.artist, thumbnailUrl: null, durationSec: t.durationSec, explicit: false, extra: t.album });
    if (path === '/api/home' && req.method === 'GET') {
      return json(res, 200, { sections: [
        { title: 'Quick picks', label: null, items: TRACKS.map(songItem) },
        { title: 'Albums for you', label: null, items: [{ type: 'album', id: 'MPREb_sim', title: 'Sim Album', subtitle: 'Bridge Simulator', thumbnailUrl: null, durationSec: null, explicit: false, extra: '2024' }] },
        { title: 'Artists', label: null, items: [{ type: 'artist', id: 'UCsim', title: 'Bridge Simulator', subtitle: null, thumbnailUrl: null, durationSec: null, explicit: false, extra: null }] },
      ] });
    }
    if (path === '/api/charts' && req.method === 'GET') {
      return json(res, 200, { sections: [{ title: 'Top songs', label: 'top', items: TRACKS.map(songItem) }] });
    }
    if (path === '/api/explore' && req.method === 'GET') {
      return json(res, 200, { sections: [
        { title: 'New releases', label: null, items: [{ type: 'album', id: 'MPREb_sim', title: 'Sim Album', subtitle: 'Bridge Simulator', thumbnailUrl: null, durationSec: null, explicit: false, extra: '2024' }] },
        { title: 'Moods & genres', label: null, items: [{ type: 'mood', id: 'FEmusic_moods|abc', title: 'Focus', subtitle: null, thumbnailUrl: null, durationSec: null, explicit: false, extra: '#4455aa' }] },
      ] });
    }
    if (path === '/api/browse' && req.method === 'GET') {
      return json(res, 200, { sections: [{ title: 'Focus mixes', label: null, items: [{ type: 'playlist', id: 'VLPLsim', title: 'Sim Focus Mix', subtitle: 'YouTube Music', thumbnailUrl: null, durationSec: null, explicit: false, extra: '2 songs' }] }] });
    }
    if ((path.startsWith('/api/album/') || path.startsWith('/api/artist/') || path.startsWith('/api/playlist/')) && req.method === 'GET') {
      const kind = path.split('/')[2];
      return json(res, 200, { detail: {
        kind, id: path.split('/')[3] || 'sim',
        title: kind === 'album' ? 'Sim Album' : kind === 'artist' ? 'Bridge Simulator' : 'Sim Focus Mix',
        subtitle: 'Bridge Simulator', description: 'Synthesised catalogue page for CI.',
        thumbnailUrl: null, songs: TRACKS.map(meta), sections: [],
      } });
    }
    if (path === '/api/search' && req.method === 'GET' && url.searchParams.get('type') && url.searchParams.get('type') !== 'song') {
      const type = url.searchParams.get('type');
      const items = type === 'album'
        ? [{ type: 'album', id: 'MPREb_sim', title: 'Sim Album', subtitle: 'Bridge Simulator', thumbnailUrl: null, durationSec: null, explicit: false, extra: '2024' }]
        : type === 'artist'
          ? [{ type: 'artist', id: 'UCsim', title: 'Bridge Simulator', subtitle: null, thumbnailUrl: null, durationSec: null, explicit: false, extra: null }]
          : [{ type: 'playlist', id: 'VLPLsim', title: 'Sim Focus Mix', subtitle: 'YouTube Music', thumbnailUrl: null, durationSec: null, explicit: false, extra: '2 songs' }];
      return json(res, 200, { query: url.searchParams.get('q') || '', type, results: items });
    }
    if (path === '/api/resolve' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const track = TRACKS.find((t) => t.id === body.trackId);
      if (!track) return errorJson(res, 502, 'RESOLUTION_FAILED', 'SoundWave could not resolve a playable source for this track.');
      const grantId = randomBytes(32).toString('hex');
      grants.set(grantId, { token, trackId: track.id });
      const { wav, ...meta } = track;
      return json(res, 200, { track: meta, streamPath: `/api/stream/${grantId}`, contentType: 'audio/wav', safariCompatible: true, streamExpiresAtMs: Date.now() + 20 * 60_000, upstreamExpiresAtMs: Date.now() + 6 * 3600_000, resolverClient: 'bridge-sim' });
    }
    if (path === '/api/state' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      sessions.get(token).state = body;
      return json(res, 200, { ok: true });
    }
    if (path === '/api/state' && req.method === 'GET') {
      return json(res, 200, { remoteState: sessions.get(token).state ?? { queue: [], queueIndex: -1, playing: false, positionMs: 0 } });
    }
    return errorJson(res, 404, 'NOT_FOUND', 'Not found.');
  } catch (e) {
    return errorJson(res, 500, 'INTERNAL', 'Simulator error: ' + e.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[bridge-sim] listening on http://127.0.0.1:${PORT} (pairing code ${CODE})`);
});
