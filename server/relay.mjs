/**
 * Soundwave "Listen Together" relay server.
 *
 * Implements the SERVER side of the protocol defined by the Android app
 * (`app/src/main/proto/listentogether.proto`, GPL-3.0): binary protobuf `Envelope` frames over
 * WebSocket, rooms with host/guest roles, join approval, playback-state broadcast, resync,
 * buffer coordination, chat, suggestions, kick/transfer-host.
 *
 * Run anywhere with TLS in front (the web client on https:// requires wss://):
 *   npm install && npm start            # ws://0.0.0.0:8787
 *   PORT=9000 AUTO_APPROVE=1 npm start
 *
 * Point the Soundwave app (Settings → Integrations → Listen Together → server URL) and
 * Soundwave Web (Settings → Listen Together) at the same URL to sync them.
 */
import { WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const AUTO_APPROVE = process.env.AUTO_APPROVE === '1';

/* ------------------------- minimal protobuf wire codec -------------------------
   Mirrors src/lib/ltProto.ts (field numbers from listentogether.proto).            */
const enc = new TextEncoder();
const dec = new TextDecoder();

function writeVarint(out, v) {
  v = Math.max(0, Math.floor(v));
  while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
  out.push(v & 0x7f);
}
function tag(out, f, w) { writeVarint(out, (f << 3) | w); }
function lenDelim(out, f, bytes) { tag(out, f, 2); writeVarint(out, bytes.length); out.push(...bytes); }
function wStr(out, f, s) { if (s) lenDelim(out, f, [...enc.encode(s)]); }
function wInt(out, f, n) { if (n) { tag(out, f, 0); writeVarint(out, n); } }
function wBool(out, f, b) { if (b) { tag(out, f, 0); writeVarint(out, 1); } }
function wFloat(out, f, x) {
  if (x === undefined || x === null) return;
  tag(out, f, 5);
  const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, x, true);
  out.push(...new Uint8Array(b));
}
function readVarint(buf, pos) {
  let r = 0, sh = 1;
  for (;;) { const b = buf[pos.i++]; r += (b & 0x7f) * sh; if (!(b & 0x80)) break; sh *= 128; }
  return r;
}
function readFields(buf) {
  const out = []; const pos = { i: 0 };
  while (pos.i < buf.length) {
    const key = readVarint(buf, pos); const num = Math.floor(key / 8); const wire = key & 7;
    if (wire === 0) out.push({ num, wire, v: readVarint(buf, pos) });
    else if (wire === 2) { const l = readVarint(buf, pos); out.push({ num, wire, b: buf.slice(pos.i, pos.i + l) }); pos.i += l; }
    else if (wire === 5) { out.push({ num, wire, fl: new DataView(buf.buffer, buf.byteOffset + pos.i, 4).getFloat32(0, true) }); pos.i += 4; }
    else if (wire === 1) { pos.i += 8; }
    else break;
  }
  return out;
}
function envelope(type, payloadBytes) {
  const out = []; wStr(out, 1, type); if (payloadBytes && payloadBytes.length) lenDelim(out, 2, [...payloadBytes]);
  return Buffer.from(out);
}
function decodeEnvelope(buf) {
  let type = '', payload = Buffer.alloc(0);
  for (const f of readFields(buf)) {
    if (f.num === 1 && f.b) type = dec.decode(f.b);
    else if (f.num === 2 && f.b) payload = f.b;
  }
  return { type, payload };
}
/* TrackInfo{1 id,2 title,3 artist,4 album,5 duration,6 thumbnail,7 suggested_by} */
function encTrack(t) {
  if (!t) return null;
  const o = [];
  wStr(o, 1, t.id); wStr(o, 2, t.title); wStr(o, 3, t.artist); wStr(o, 4, t.album);
  wInt(o, 5, t.duration); wStr(o, 6, t.thumbnail); wStr(o, 7, t.suggestedBy);
  return Buffer.from(o);
}
function decTrack(buf) {
  const t = { id: '', title: '', artist: '', album: '', duration: 0, thumbnail: '', suggestedBy: '' };
  for (const f of readFields(buf)) {
    if (f.num === 1) t.id = dec.decode(f.b); else if (f.num === 2) t.title = dec.decode(f.b);
    else if (f.num === 3) t.artist = dec.decode(f.b); else if (f.num === 4) t.album = dec.decode(f.b);
    else if (f.num === 5) t.duration = f.v; else if (f.num === 6) t.thumbnail = dec.decode(f.b);
    else if (f.num === 7) t.suggestedBy = dec.decode(f.b);
  }
  return t;
}
/* PlaybackActionPayload{1 action,2 track_id,3 position,4 track_info,5 insert_next,6 queue,7 queue_title,8 volume,9 server_time} */
function decPlayback(buf) {
  const p = { action: '', trackId: '', position: 0, trackInfo: null, insertNext: false, queue: [], queueTitle: '', volume: 0, serverTime: 0 };
  for (const f of readFields(buf)) {
    if (f.num === 1 && f.b) p.action = dec.decode(f.b);
    else if (f.num === 2 && f.b) p.trackId = dec.decode(f.b);
    else if (f.num === 3 && f.wire === 0) p.position = f.v;
    else if (f.num === 4 && f.b) p.trackInfo = decTrack(f.b);
    else if (f.num === 5 && f.wire === 0) p.insertNext = !!f.v;
    else if (f.num === 6 && f.b) p.queue.push(decTrack(f.b));
    else if (f.num === 7 && f.b) p.queueTitle = dec.decode(f.b);
    else if (f.num === 8 && f.wire === 5) p.volume = f.fl;
    else if (f.num === 9 && f.wire === 0) p.serverTime = f.v;
  }
  return p;
}
function encPlayback(p) {
  const o = [];
  wStr(o, 1, p.action); wStr(o, 2, p.trackId); wInt(o, 3, p.position);
  if (p.trackInfo) lenDelim(o, 4, [...encTrack(p.trackInfo)]);
  wBool(o, 5, p.insertNext);
  for (const t of p.queue || []) lenDelim(o, 6, [...encTrack(t)]);
  wStr(o, 7, p.queueTitle); wFloat(o, 8, p.volume); wInt(o, 9, p.serverTime);
  return Buffer.from(o);
}
/* UserInfo{1 user_id,2 username,3 is_host,4 is_connected} */
function encUser(u) { const o = []; wStr(o, 1, u.userId); wStr(o, 2, u.username); wBool(o, 3, u.isHost); wBool(o, 4, u.isConnected !== false); return Buffer.from(o); }
/* RoomState{1 room_code,2 host_id,3 users,4 current_track,5 is_playing,6 position,7 last_update,8 volume,9 queue,10 allow_participant_control} */
function encRoomState(room) {
  const o = [];
  wStr(o, 1, room.code); wStr(o, 2, room.hostId);
  for (const u of room.users.values()) lenDelim(o, 3, [...encUser(u)]);
  if (room.state.currentTrack) lenDelim(o, 4, [...encTrack(room.state.currentTrack)]);
  wBool(o, 5, room.state.isPlaying); wInt(o, 6, room.state.position); wInt(o, 7, room.state.lastUpdate);
  wFloat(o, 8, room.state.volume);
  for (const t of room.state.queue) lenDelim(o, 9, [...encTrack(t)]);
  wBool(o, 10, room.state.allowParticipantControl);
  return Buffer.from(o);
}
function simple(fields) { // build payload from [num, kind, value]
  const o = [];
  for (const [num, kind, val] of fields) {
    if (kind === 's') wStr(o, num, val); else if (kind === 'i') wInt(o, num, val); else if (kind === 'b') wBool(o, num, val);
  }
  return Buffer.from(o);
}

/* ------------------------------------ rooms ------------------------------------ */
const rooms = new Map(); // code -> room
const sessions = new Map(); // sessionToken -> {roomCode, userId}

const rand = (n) => randomBytes(n).toString('hex');
const roomCode = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = ''; for (let i = 0; i < 6; i++) c += A[Math.floor(Math.random() * A.length)];
  return rooms.has(c) ? roomCode() : c;
};

function send(ws, type, payload) { if (ws.readyState === 1) ws.send(envelope(type, payload)); }
function broadcast(room, type, payload, exceptWs) {
  for (const u of room.users.values()) if (u.ws !== exceptWs && u.isConnected !== false) send(u.ws, type, payload);
}
function applyPlayback(room, p) {
  const s = room.state;
  switch (p.action) {
    case 'play': s.isPlaying = true; if (p.position) s.position = p.position; s.lastUpdate = Date.now(); break;
    case 'pause': s.isPlaying = false; if (p.position) s.position = p.position; s.lastUpdate = Date.now(); break;
    case 'seek': s.position = p.position || 0; s.lastUpdate = Date.now(); break;
    case 'change_track': s.currentTrack = p.trackInfo; s.isPlaying = false; s.position = 0; s.lastUpdate = Date.now(); break;
    case 'queue_add': if (p.trackInfo) s.queue = p.insertNext ? [p.trackInfo, ...s.queue] : [...s.queue, p.trackInfo]; break;
    case 'queue_remove': s.queue = s.queue.filter((t) => t.id !== p.trackId); break;
    case 'queue_clear': s.queue = []; break;
    case 'sync_queue': s.queue = p.queue || []; break;
    case 'set_volume': s.volume = p.volume; break;
  }
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[relay] Listen Together relay listening on :${PORT} (autoApprove=${AUTO_APPROVE})`);

wss.on('connection', (ws) => {
  let me = null; // {room, userId, username, sessionToken, isHost}

  ws.on('message', (data) => {
    const buf = Buffer.from(data);
    const { type, payload } = decodeEnvelope(buf);
    switch (type) {
      case 'ping': send(ws, 'pong', simple([[2, 'i', Date.now()], [3, 'i', Date.now()]])); break;

      case 'create_room': {
        const username = decStr(payload, 1) || 'anon';
        const code = roomCode();
        const userId = rand(8); const token = rand(16);
        const room = { code, hostId: userId, users: new Map(), state: { currentTrack: null, isPlaying: false, position: 0, lastUpdate: Date.now(), volume: 1, queue: [], allowParticipantControl: false }, pending: new Map(), buffered: new Set() };
        room.users.set(userId, { userId, username, isHost: true, isConnected: true, ws, sessionToken: token });
        rooms.set(code, room); sessions.set(token, { roomCode: code, userId });
        me = { room, userId, username, sessionToken: token, isHost: true };
        send(ws, 'room_created', simple([[1, 's', code], [2, 's', userId], [3, 's', token]]));
        console.log(`[relay] room ${code} created by ${username}`);
        break;
      }

      case 'join_room': {
        const code = (decStr(payload, 1) || '').toUpperCase();
        const username = decStr(payload, 2) || 'anon';
        const room = rooms.get(code);
        if (!room) { send(ws, 'error', simple([[1, 's', 'room_not_found'], [2, 's', 'Room not found']])); break; }
        const userId = rand(8); const token = rand(16);
        const pending = { userId, username, ws, sessionToken: token };
        room.pending.set(userId, pending);
        sessions.set(token, { roomCode: code, userId });
        me = { room, userId, username, sessionToken: token, isHost: false, pending: true };
        if (AUTO_APPROVE) approveJoin(room, userId);
        else {
          const host = room.users.get(room.hostId);
          if (host) send(host.ws, 'join_request', simple([[1, 's', userId], [2, 's', username]]));
        }
        break;
      }

      case 'approve_join': { if (me?.isHost) approveJoin(me.room, decStr(payload, 1)); break; }
      case 'reject_join': {
        if (!me?.isHost) break;
        const id = decStr(payload, 1); const p = me.room.pending.get(id);
        if (p) { send(p.ws, 'join_rejected', simple([[1, 's', decStr(payload, 2) || 'rejected']])); me.room.pending.delete(id); }
        break;
      }

      case 'playback_action': {
        if (!me?.room) break;
        const allowed = me.isHost || me.room.state.allowParticipantControl;
        if (!allowed) break;
        const p = decPlayback(payload);
        applyPlayback(me.room, p);
        broadcast(me.room, 'sync_playback', encPlayback(p), ws);
        break;
      }

      case 'request_sync': {
        if (me?.room) send(ws, 'sync_state', encSyncState(me.room));
        break;
      }

      case 'buffer_ready': {
        if (!me?.room) break;
        const trackId = decStr(payload, 1);
        me.room.buffered.add(me.userId);
        const connected = [...me.room.users.values()].filter((u) => u.isConnected !== false);
        if (connected.every((u) => me.room.buffered.has(u.userId))) {
          broadcast(me.room, 'buffer_complete', simple([[1, 's', trackId]]));
          me.room.buffered.clear();
        } else {
          const waiting = connected.filter((u) => !me.room.buffered.has(u.userId)).map((u) => u.username);
          broadcast(me.room, 'buffer_wait', encBufferWait(trackId, waiting));
        }
        break;
      }

      case 'update_room_settings': {
        if (!me?.isHost) break;
        me.room.state.allowParticipantControl = !!readVarintField(payload, 1);
        broadcast(me.room, 'room_settings_changed', simple([[1, 'b', me.room.state.allowParticipantControl]]));
        break;
      }

      case 'kick_user': {
        if (!me?.isHost) break;
        const id = decStr(payload, 1); const u = me.room.users.get(id);
        if (u) { send(u.ws, 'kicked', simple([[1, 's', decStr(payload, 2) || 'kicked']])); removeUser(me.room, id, true); }
        break;
      }

      case 'transfer_host': {
        if (!me?.isHost) break;
        const id = decStr(payload, 1); const u = me.room.users.get(id);
        if (!u) break;
        me.room.hostId = id;
        for (const x of me.room.users.values()) x.isHost = x.userId === id;
        me.isHost = id === me.userId;
        broadcast(me.room, 'host_changed', simple([[1, 's', id], [2, 's', u.username]]));
        break;
      }

      case 'suggest_track': {
        if (!me?.room) break;
        const track = decTrackField(payload, 1);
        const host = me.room.users.get(me.room.hostId);
        const sid = rand(6);
        if (host) send(host.ws, 'suggestion_received', encSuggestionReceived(sid, me.userId, me.username, track));
        break;
      }
      case 'approve_suggestion': {
        if (!me?.isHost) break;
        broadcast(me.room, 'suggestion_approved', simple([[1, 's', decStr(payload, 1)]]));
        break;
      }
      case 'reject_suggestion': {
        if (!me?.isHost) break;
        broadcast(me.room, 'suggestion_rejected', simple([[1, 's', decStr(payload, 1)], [2, 's', decStr(payload, 2) || '']]));
        break;
      }

      case 'chat': {
        if (!me?.room) break;
        broadcast(me.room, 'chat', encChat(me.userId, me.username, decStr(payload, 1)), ws);
        break;
      }

      case 'reconnect': {
        const token = decStr(payload, 1);
        const sess = sessions.get(token);
        const room = sess && rooms.get(sess.roomCode);
        if (!room) { send(ws, 'error', simple([[1, 's', 'session_not_found'], [2, 's', 'Session not found']])); break; }
        const u = room.users.get(sess.userId);
        if (!u) { send(ws, 'error', simple([[1, 's', 'session_not_found'], [2, 's', 'Session not found']])); break; }
        u.ws = ws; u.isConnected = true;
        me = { room, userId: u.userId, username: u.username, sessionToken: token, isHost: u.isHost };
        send(ws, 'reconnected', encReconnected(room, u.userId, u.isHost));
        broadcast(room, 'user_reconnected', simple([[1, 's', u.userId], [2, 's', u.username]]), ws);
        break;
      }

      case 'leave_room': { if (me?.room) removeUser(me.room, me.userId, false); me = null; break; }
      default: break;
    }
  });

  ws.on('close', () => {
    if (me?.room) {
      const u = me.room.users.get(me.userId);
      if (u) { u.isConnected = false; broadcast(me.room, 'user_disconnected', simple([[1, 's', u.userId], [2, 's', u.username]]), ws); }
    }
  });
});

function decStr(buf, num) { for (const f of readFields(buf)) if (f.num === num && f.b) return dec.decode(f.b); return ''; }
function readVarintField(buf, num) { for (const f of readFields(buf)) if (f.num === num && f.wire === 0) return f.v; return 0; }
function decTrackField(buf, num) { for (const f of readFields(buf)) if (f.num === num && f.b) return decTrack(f.b); return null; }
function encSyncState(room) {
  const s = room.state; const o = [];
  if (s.currentTrack) lenDelim(o, 1, [...encTrack(s.currentTrack)]);
  wBool(o, 2, s.isPlaying); wInt(o, 3, s.position); wInt(o, 4, s.lastUpdate);
  for (const t of s.queue) lenDelim(o, 5, [...encTrack(t)]);
  wFloat(o, 6, s.volume);
  return Buffer.from(o);
}
function encBufferWait(trackId, waiting) { const o = []; wStr(o, 1, trackId); for (const w of waiting) wStr(o, 2, w); return Buffer.from(o); }
function encChat(userId, username, message) { const o = []; wStr(o, 1, userId); wStr(o, 2, username); wStr(o, 3, message); wInt(o, 4, Date.now()); return Buffer.from(o); }
function encSuggestionReceived(sid, fromId, fromName, track) {
  const o = []; wStr(o, 1, sid); wStr(o, 2, fromId); wStr(o, 3, fromName);
  if (track) lenDelim(o, 4, [...encTrack(track)]);
  return Buffer.from(o);
}
function encReconnected(room, userId, isHost) {
  const o = []; wStr(o, 1, room.code); wStr(o, 2, userId); lenDelim(o, 3, [...encRoomState(room)]); wBool(o, 4, isHost);
  return Buffer.from(o);
}
function approveJoin(room, userId) {
  const p = room.pending.get(userId);
  if (!p) return;
  room.pending.delete(userId);
  room.users.set(userId, { userId, username: p.username, isHost: false, isConnected: true, ws: p.ws, sessionToken: p.sessionToken });
  send(p.ws, 'join_approved', encJoinApproved(room, userId, p.sessionToken));
  broadcast(room, 'user_joined', simple([[1, 's', userId], [2, 's', p.username]]), p.ws);
  console.log(`[relay] ${p.username} joined ${room.code}`);
}
function encJoinApproved(room, userId, token) {
  const o = []; wStr(o, 1, room.code); wStr(o, 2, userId); wStr(o, 3, token); lenDelim(o, 4, [...encRoomState(room)]);
  return Buffer.from(o);
}
function removeUser(room, userId, kicked) {
  const u = room.users.get(userId);
  if (!u) return;
  room.users.delete(userId);
  if (!kicked) broadcast(room, 'user_left', simple([[1, 's', userId], [2, 's', u.username]]), u.ws);
  if (room.hostId === userId) {
    const next = [...room.users.values()][0];
    if (next) { room.hostId = next.userId; next.isHost = true; broadcast(room, 'host_changed', simple([[1, 's', next.userId], [2, 's', next.username]])); }
    else { rooms.delete(room.code); console.log(`[relay] room ${room.code} closed`); }
  }
  if (room.users.size === 0) rooms.delete(room.code);
}
