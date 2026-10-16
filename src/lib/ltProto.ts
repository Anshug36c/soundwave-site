/**
 * Minimal protobuf wire codec for the Soundwave/Echo "Listen Together" protocol.
 *
 * Ported from `app/src/main/proto/listentogether.proto` (Android, GPL-3.0). The public Listen
 * Together servers speak **binary protobuf `Envelope` frames** over WebSocket (verified live:
 * `ping` -> `pong`), so the web client must produce/consume exactly this wire format to
 * interoperate with the real app. Field numbers and types mirror the .proto one-for-one.
 *
 * Only the wire subset the web client needs is implemented (varint, length-delimited, fixed32
 * float). No protobuf library is required.
 */

export type WireKind = 'string' | 'int64' | 'bool' | 'float' | 'msg' | 'repmsg' | 'repstr';

export interface FieldSpec {
  num: number;
  name: string;
  kind: WireKind;
  /** For kind 'msg'/'repmsg': the submessage schema. */
  schema?: Schema;
}
export type Schema = FieldSpec[];

/* ---------------------------------- shared message shapes ---------------------------------- */

export interface LTTrackInfo {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number; // ms
  thumbnail?: string;
  suggestedBy?: string;
}
export interface LTUserInfo {
  userId: string;
  username: string;
  isHost: boolean;
  isConnected: boolean;
}
export interface LTRoomState {
  roomCode: string;
  hostId: string;
  users: LTUserInfo[];
  currentTrack: LTTrackInfo | null;
  isPlaying: boolean;
  position: number; // ms
  lastUpdate: number; // epoch ms
  volume: number;
  queue: LTTrackInfo[];
  allowParticipantControl: boolean;
}
export interface LTPlaybackAction {
  action: string;
  trackId?: string | null;
  position?: number | null; // ms
  trackInfo?: LTTrackInfo | null;
  insertNext?: boolean | null;
  queue?: LTTrackInfo[] | null;
  queueTitle?: string | null;
  volume?: number | null;
  serverTime?: number | null;
}

/* --------------------------------------- schemas --------------------------------------- */

export const TrackInfoSchema: Schema = [
  { num: 1, name: 'id', kind: 'string' },
  { num: 2, name: 'title', kind: 'string' },
  { num: 3, name: 'artist', kind: 'string' },
  { num: 4, name: 'album', kind: 'string' },
  { num: 5, name: 'duration', kind: 'int64' },
  { num: 6, name: 'thumbnail', kind: 'string' },
  { num: 7, name: 'suggestedBy', kind: 'string' },
];

export const UserInfoSchema: Schema = [
  { num: 1, name: 'userId', kind: 'string' },
  { num: 2, name: 'username', kind: 'string' },
  { num: 3, name: 'isHost', kind: 'bool' },
  { num: 4, name: 'isConnected', kind: 'bool' },
];

export const RoomStateSchema: Schema = [
  { num: 1, name: 'roomCode', kind: 'string' },
  { num: 2, name: 'hostId', kind: 'string' },
  { num: 3, name: 'users', kind: 'repmsg', schema: UserInfoSchema },
  { num: 4, name: 'currentTrack', kind: 'msg', schema: TrackInfoSchema },
  { num: 5, name: 'isPlaying', kind: 'bool' },
  { num: 6, name: 'position', kind: 'int64' },
  { num: 7, name: 'lastUpdate', kind: 'int64' },
  { num: 8, name: 'volume', kind: 'float' },
  { num: 9, name: 'queue', kind: 'repmsg', schema: TrackInfoSchema },
  { num: 10, name: 'allowParticipantControl', kind: 'bool' },
];

export const PlaybackActionSchema: Schema = [
  { num: 1, name: 'action', kind: 'string' },
  { num: 2, name: 'trackId', kind: 'string' },
  { num: 3, name: 'position', kind: 'int64' },
  { num: 4, name: 'trackInfo', kind: 'msg', schema: TrackInfoSchema },
  { num: 5, name: 'insertNext', kind: 'bool' },
  { num: 6, name: 'queue', kind: 'repmsg', schema: TrackInfoSchema },
  { num: 7, name: 'queueTitle', kind: 'string' },
  { num: 8, name: 'volume', kind: 'float' },
  { num: 9, name: 'serverTime', kind: 'int64' },
];

export const CreateRoomSchema: Schema = [{ num: 1, name: 'username', kind: 'string' }];
export const JoinRoomSchema: Schema = [
  { num: 1, name: 'roomCode', kind: 'string' },
  { num: 2, name: 'username', kind: 'string' },
];
export const ApproveJoinSchema: Schema = [{ num: 1, name: 'userId', kind: 'string' }];
export const RejectJoinSchema: Schema = [
  { num: 1, name: 'userId', kind: 'string' },
  { num: 2, name: 'reason', kind: 'string' },
];
export const BufferReadySchema: Schema = [{ num: 1, name: 'trackId', kind: 'string' }];
export const ReconnectSchema: Schema = [{ num: 1, name: 'sessionToken', kind: 'string' }];
export const RoomCreatedSchema: Schema = [
  { num: 1, name: 'roomCode', kind: 'string' },
  { num: 2, name: 'userId', kind: 'string' },
  { num: 3, name: 'sessionToken', kind: 'string' },
];
export const JoinRequestSchema: Schema = [
  { num: 1, name: 'userId', kind: 'string' },
  { num: 2, name: 'username', kind: 'string' },
];
export const JoinApprovedSchema: Schema = [
  { num: 1, name: 'roomCode', kind: 'string' },
  { num: 2, name: 'userId', kind: 'string' },
  { num: 3, name: 'sessionToken', kind: 'string' },
  { num: 4, name: 'state', kind: 'msg', schema: RoomStateSchema },
];
export const JoinRejectedSchema: Schema = [{ num: 1, name: 'reason', kind: 'string' }];
export const UserJoinedSchema: Schema = [
  { num: 1, name: 'userId', kind: 'string' },
  { num: 2, name: 'username', kind: 'string' },
];
export const UserLeftSchema: Schema = UserJoinedSchema;
export const BufferWaitSchema: Schema = [
  { num: 1, name: 'trackId', kind: 'string' },
  { num: 2, name: 'waitingFor', kind: 'repstr' },
];
export const BufferCompleteSchema: Schema = [{ num: 1, name: 'trackId', kind: 'string' }];
export const ErrorSchema: Schema = [
  { num: 1, name: 'code', kind: 'string' },
  { num: 2, name: 'message', kind: 'string' },
];
export const HostChangedSchema: Schema = [
  { num: 1, name: 'newHostId', kind: 'string' },
  { num: 2, name: 'newHostName', kind: 'string' },
];
export const KickedSchema: Schema = [{ num: 1, name: 'reason', kind: 'string' }];
export const SyncStateSchema: Schema = [
  { num: 1, name: 'currentTrack', kind: 'msg', schema: TrackInfoSchema },
  { num: 2, name: 'isPlaying', kind: 'bool' },
  { num: 3, name: 'position', kind: 'int64' },
  { num: 4, name: 'lastUpdate', kind: 'int64' },
  { num: 5, name: 'queue', kind: 'repmsg', schema: TrackInfoSchema },
  { num: 6, name: 'volume', kind: 'float' },
];
export const ReconnectedSchema: Schema = [
  { num: 1, name: 'roomCode', kind: 'string' },
  { num: 2, name: 'userId', kind: 'string' },
  { num: 3, name: 'state', kind: 'msg', schema: RoomStateSchema },
  { num: 4, name: 'isHost', kind: 'bool' },
];
export const UserReconnectedSchema: Schema = UserJoinedSchema;
export const UserDisconnectedSchema: Schema = UserJoinedSchema;
export const UpdateRoomSettingsSchema: Schema = [
  { num: 1, name: 'allowParticipantControl', kind: 'bool' },
];
export const SuggestTrackSchema: Schema = [
  { num: 1, name: 'trackInfo', kind: 'msg', schema: TrackInfoSchema },
];
export const SuggestionReceivedSchema: Schema = [
  { num: 1, name: 'suggestionId', kind: 'string' },
  { num: 2, name: 'fromUserId', kind: 'string' },
  { num: 3, name: 'fromUsername', kind: 'string' },
  { num: 4, name: 'trackInfo', kind: 'msg', schema: TrackInfoSchema },
];
export const ApproveSuggestionSchema: Schema = [{ num: 1, name: 'suggestionId', kind: 'string' }];
export const RejectSuggestionSchema: Schema = [
  { num: 1, name: 'suggestionId', kind: 'string' },
  { num: 2, name: 'reason', kind: 'string' },
];
export const SuggestionApprovedSchema: Schema = [
  { num: 1, name: 'suggestionId', kind: 'string' },
  { num: 2, name: 'trackInfo', kind: 'msg', schema: TrackInfoSchema },
];
export const SuggestionRejectedSchema: Schema = [
  { num: 1, name: 'suggestionId', kind: 'string' },
  { num: 2, name: 'reason', kind: 'string' },
];
export const ChatMessageSchema: Schema = [
  { num: 1, name: 'userId', kind: 'string' },
  { num: 2, name: 'username', kind: 'string' },
  { num: 3, name: 'message', kind: 'string' },
  { num: 4, name: 'timestamp', kind: 'int64' },
];

/* ------------------------------------ low-level wire ------------------------------------ */

const WT_VARINT = 0;
const WT_FIXED32 = 5;
const WT_LEN = 2;

function writeVarint(out: number[], value: number): void {
  // Non-negative integers only (positions/durations/timestamps). Safe below 2^53.
  let v = Math.max(0, Math.floor(value));
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v & 0x7f);
}

function writeTag(out: number[], field: number, wire: number): void {
  writeVarint(out, (field << 3) | wire);
}

function writeLenDelimited(out: number[], field: number, bytes: number[]): void {
  writeTag(out, field, WT_LEN);
  writeVarint(out, bytes.length);
  for (const b of bytes) out.push(b);
}

function utf8Bytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

/** Encode a message object against a schema into protobuf bytes. */
export function encodeMessage(msg: Record<string, unknown>, schema: Schema): Uint8Array {
  const out: number[] = [];
  for (const f of schema) {
    const value = msg[f.name];
    if (value === undefined || value === null) continue;
    switch (f.kind) {
      case 'string': {
        const s = value as string;
        if (s === '') continue; // proto3 default omission
        writeLenDelimited(out, f.num, utf8Bytes(s));
        break;
      }
      case 'int64':
        writeTag(out, f.num, WT_VARINT);
        writeVarint(out, value as number);
        break;
      case 'bool':
        writeTag(out, f.num, WT_VARINT);
        writeVarint(out, value ? 1 : 0);
        break;
      case 'float': {
        writeTag(out, f.num, WT_FIXED32);
        const buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, value as number, true);
        for (const b of new Uint8Array(buf)) out.push(b);
        break;
      }
      case 'msg': {
        const inner = Array.from(encodeMessage(value as Record<string, unknown>, f.schema!));
        writeLenDelimited(out, f.num, inner);
        break;
      }
      case 'repmsg': {
        for (const item of value as Record<string, unknown>[]) {
          const inner = Array.from(encodeMessage(item, f.schema!));
          writeLenDelimited(out, f.num, inner);
        }
        break;
      }
      case 'repstr': {
        for (const s of value as string[]) writeLenDelimited(out, f.num, utf8Bytes(s));
        break;
      }
    }
  }
  return Uint8Array.from(out);
}

interface RawField {
  num: number;
  wire: number;
  varint?: number;
  float?: number;
  bytes?: Uint8Array;
}

function readVarintAt(buf: Uint8Array, pos: { i: number }): number {
  let result = 0;
  let shift = 1;
  for (;;) {
    const b = buf[pos.i++];
    result += (b & 0x7f) * shift;
    if ((b & 0x80) === 0) break;
    shift *= 128;
  }
  return result;
}

function readFields(buf: Uint8Array): RawField[] {
  const fields: RawField[] = [];
  const pos = { i: 0 };
  while (pos.i < buf.length) {
    const key = readVarintAt(buf, pos);
    const num = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === WT_VARINT) {
      fields.push({ num, wire, varint: readVarintAt(buf, pos) });
    } else if (wire === WT_LEN) {
      const len = readVarintAt(buf, pos);
      fields.push({ num, wire, bytes: buf.slice(pos.i, pos.i + len) });
      pos.i += len;
    } else if (wire === WT_FIXED32) {
      const dv = new DataView(buf.buffer, buf.byteOffset + pos.i, 4);
      fields.push({ num, wire, float: dv.getFloat32(0, true) });
      pos.i += 4;
    } else if (wire === 1) {
      pos.i += 8; // fixed64 — not used by this protocol; skip
    } else {
      break; // unknown wire type; stop safely
    }
  }
  return fields;
}

/** Decode protobuf bytes against a schema into a message object (missing fields -> defaults). */
export function decodeMessage<T = Record<string, unknown>>(buf: Uint8Array, schema: Schema): T {
  const out: Record<string, unknown> = {};
  // Defaults so callers can rely on shape (mirrors proto3 + the Kotlin data-class defaults).
  for (const f of schema) {
    if (f.kind === 'repmsg' || f.kind === 'repstr') out[f.name] = [];
    else if (f.kind === 'bool') out[f.name] = false;
    else if (f.kind === 'int64') out[f.name] = 0;
    else if (f.kind === 'float') out[f.name] = 0;
    else if (f.kind === 'string') out[f.name] = '';
    else if (f.kind === 'msg') out[f.name] = null;
  }
  for (const raw of readFields(buf)) {
    const f = schema.find((s) => s.num === raw.num);
    if (!f) continue;
    switch (f.kind) {
      case 'string':
        out[f.name] = new TextDecoder().decode(raw.bytes);
        break;
      case 'int64':
        out[f.name] = raw.varint ?? 0;
        break;
      case 'bool':
        out[f.name] = (raw.varint ?? 0) !== 0;
        break;
      case 'float':
        out[f.name] = raw.float ?? 0;
        break;
      case 'msg':
        out[f.name] = decodeMessage(raw.bytes!, f.schema!);
        break;
      case 'repmsg':
        (out[f.name] as unknown[]).push(decodeMessage(raw.bytes!, f.schema!));
        break;
      case 'repstr':
        (out[f.name] as string[]).push(new TextDecoder().decode(raw.bytes));
        break;
    }
  }
  return out as T;
}

/* ------------------------------------- Envelope I/O ------------------------------------- */

export interface LTEnvelope {
  type: string;
  payload: Uint8Array;
  compressed: boolean;
}

/** Envelope{1:type,2:payload,3:compressed}. */
export function encodeEnvelope(type: string, payload?: Uint8Array): Uint8Array {
  const out: number[] = [];
  writeLenDelimited(out, 1, utf8Bytes(type));
  if (payload && payload.length) writeLenDelimited(out, 2, Array.from(payload));
  return Uint8Array.from(out);
}

export function decodeEnvelope(buf: Uint8Array): LTEnvelope {
  let type = '';
  let payload = new Uint8Array(0);
  let compressed = false;
  for (const raw of readFields(buf)) {
    if (raw.num === 1 && raw.bytes) type = new TextDecoder().decode(raw.bytes);
    else if (raw.num === 2 && raw.bytes) payload = raw.bytes;
    else if (raw.num === 3) compressed = (raw.varint ?? 0) !== 0;
  }
  return { type, payload, compressed };
}

/** True when a frame looks like JSON text (`{...}`) rather than protobuf — mirrors the app's
 *  receive-side auto-detection in MessageCodec.detectMessageFormat. */
export function looksLikeJson(buf: Uint8Array): boolean {
  return buf.length > 0 && buf[0] === 0x7b; // '{'
}
