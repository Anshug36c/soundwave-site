/**
 * Listen Together WebSocket client for the browser.
 *
 * A faithful port of the Android `ListenTogetherClient.kt` wire behaviour (GPL-3.0):
 *  - sends **binary protobuf `Envelope` frames** (what the public servers accept; verified live),
 *  - receives with the app's auto-detection (JSON text vs protobuf) and gunzips `compressed`
 *    payloads,
 *  - `ping` every 25s expecting `pong` (RTT), exponential-backoff reconnect, and session-token
 *    `reconnect` on reopen.
 *
 * It is transport-only: room state and playback bridging live in `state/listenTogether.ts`.
 */
import {
  ApproveJoinSchema,
  ApproveSuggestionSchema,
  BufferReadySchema,
  BufferWaitSchema,
  ChatMessageSchema,
  CreateRoomSchema,
  decodeEnvelope,
  decodeMessage,
  encodeEnvelope,
  encodeMessage,
  ErrorSchema,
  HostChangedSchema,
  JoinApprovedSchema,
  JoinRejectedSchema,
  JoinRequestSchema,
  JoinRoomSchema,
  KickedSchema,
  looksLikeJson,
  PlaybackActionSchema,
  ReconnectedSchema,
  ReconnectSchema,
  RejectJoinSchema,
  RejectSuggestionSchema,
  RoomCreatedSchema,
  SuggestTrackSchema,
  SuggestionApprovedSchema,
  SuggestionReceivedSchema,
  SuggestionRejectedSchema,
  SyncStateSchema,
  UpdateRoomSettingsSchema,
  UserJoinedSchema,
  type LTPlaybackAction,
  type LTRoomState,
  type LTTrackInfo,
  type LTUserInfo,
} from './ltProto';

export const DEFAULT_LT_SERVER = 'wss://metroserverx.meowery.eu/ws';

export type LTConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
export type LTRole = 'host' | 'guest' | 'none';

export type LTEvent =
  | { type: 'connected'; userId: string | null }
  | { type: 'disconnected' }
  | { type: 'connectionError'; message: string }
  | { type: 'reconnecting'; attempt: number; max: number }
  | { type: 'roomCreated'; roomCode: string; userId: string }
  | { type: 'joinRequest'; userId: string; username: string }
  | { type: 'joinApproved'; roomCode: string; userId: string; state: LTRoomState }
  | { type: 'joinRejected'; reason: string }
  | { type: 'userJoined'; userId: string; username: string }
  | { type: 'userLeft'; userId: string; username: string }
  | { type: 'hostChanged'; newHostId: string; newHostName: string }
  | { type: 'kicked'; reason: string }
  | { type: 'reconnected'; roomCode: string; userId: string; state: LTRoomState; isHost: boolean }
  | { type: 'userReconnected'; userId: string; username: string }
  | { type: 'userDisconnected'; userId: string; username: string }
  | { type: 'playbackSync'; action: LTPlaybackAction }
  | { type: 'bufferWait'; trackId: string; waitingFor: string[] }
  | { type: 'bufferComplete'; trackId: string }
  | { type: 'syncState'; state: Partial<LTRoomState> }
  | { type: 'serverError'; code: string; message: string }
  | { type: 'chat'; userId: string; username: string; message: string; timestamp: number }
  | { type: 'roomSettingsChanged'; allowParticipantControl: boolean }
  | { type: 'suggestionReceived'; suggestionId: string; fromUsername: string; track: LTTrackInfo }
  | { type: 'suggestionApproved'; suggestionId: string; track: LTTrackInfo }
  | { type: 'suggestionRejected'; suggestionId: string; reason: string }
  | { type: 'pong'; rtt: number };

export interface LTClientOptions {
  serverUrl: string;
  username: string;
  onEvent: (e: LTEvent) => void;
  onState: (s: LTConnectionState) => void;
}

const PING_INTERVAL_MS = 25000;
const MAX_RECONNECT_ATTEMPTS = 15;
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 120000;

/** Recursively convert snake_case keys (the JSON wire form) to the camelCase shapes we use. */
function snakeToCamel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeToCamel);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      out[camel] = snakeToCamel(v);
    }
    return out;
  }
  return value;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  try {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return bytes;
  }
}

export class ListenTogetherClient {
  private ws: WebSocket | null = null;
  private pingTimer: number | null = null;
  private pingSentAt = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private sessionToken: string | null = null;
  private roomCode: string | null = null;
  private pending: { kind: 'create' | 'join'; code?: string } | null = null;
  private intentionalClose = false;

  state: LTConnectionState = 'disconnected';
  role: LTRole = 'none';
  userId: string | null = null;

  constructor(private opts: LTClientOptions) {}

  private setState(s: LTConnectionState): void {
    this.state = s;
    this.opts.onState(s);
  }
  private emit(e: LTEvent): void {
    this.opts.onEvent(e);
  }

  connect(): void {
    if (this.state === 'connected' || this.state === 'connecting') return;
    this.intentionalClose = false;
    this.setState(this.sessionToken ? 'reconnecting' : 'connecting');
    try {
      this.ws = new WebSocket(this.opts.serverUrl);
    } catch (e) {
      this.setState('error');
      this.emit({ type: 'connectionError', message: String(e) });
      return;
    }
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.setState('connected');
      this.reconnectAttempts = 0;
      this.startPing();
      if (this.sessionToken) {
        this.send('reconnect', encodeMessage({ sessionToken: this.sessionToken }, ReconnectSchema));
      } else if (this.pending) {
        this.flushPending();
      }
      this.emit({ type: 'connected', userId: this.userId });
    };

    this.ws.onmessage = (ev) => {
      const bytes =
        typeof ev.data === 'string'
          ? new TextEncoder().encode(ev.data)
          : new Uint8Array(ev.data as ArrayBuffer);
      void this.handleFrame(bytes);
    };

    this.ws.onclose = () => {
      this.stopPing();
      if (this.intentionalClose) {
        this.setState('disconnected');
        this.emit({ type: 'disconnected' });
        return;
      }
      this.handleFailure('connection closed');
    };
    this.ws.onerror = () => {
      /* onclose follows; failure handled there */
    };
  }

  private flushPending(): void {
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    if (p.kind === 'create') this.createRoom();
    else if (p.code) this.joinRoom(p.code);
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.stopPing();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.sessionToken = null;
    this.roomCode = null;
    this.role = 'none';
    this.userId = null;
    this.pending = null;
    try {
      this.ws?.close(1000, 'user disconnected');
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.setState('disconnected');
    this.emit({ type: 'disconnected' });
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      this.pingSentAt = Date.now();
      this.send('ping');
    }, PING_INTERVAL_MS);
  }
  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private handleFailure(reason: string): void {
    this.stopPing();
    const shouldReconnect = this.sessionToken !== null || this.pending !== null || this.roomCode !== null;
    if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS && shouldReconnect) {
      this.reconnectAttempts++;
      this.setState('reconnecting');
      this.emit({ type: 'reconnecting', attempt: this.reconnectAttempts, max: MAX_RECONNECT_ATTEMPTS });
      const exp = INITIAL_RECONNECT_DELAY_MS * 2 ** Math.min(this.reconnectAttempts - 1, 4);
      const capped = Math.min(exp, MAX_RECONNECT_DELAY_MS);
      const delay = capped + capped * 0.2 * Math.random();
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    } else {
      this.setState('error');
      this.emit({ type: 'connectionError', message: reason });
    }
  }

  private send(type: string, payload?: Uint8Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(encodeEnvelope(type, payload));
  }

  private async handleFrame(bytes: Uint8Array): Promise<void> {
    try {
      if (looksLikeJson(bytes)) {
        const msg = JSON.parse(new TextDecoder().decode(bytes)) as {
          type: string;
          payload?: unknown;
        };
        this.dispatch(msg.type, (snakeToCamel(msg.payload ?? null) ?? null) as Record<string, unknown> | null);
        return;
      }
      const env = decodeEnvelope(bytes);
      let payloadBytes = env.payload;
      if (env.compressed) payloadBytes = await gunzip(payloadBytes);
      this.dispatch(env.type, this.decodePayload(env.type, payloadBytes));
    } catch {
      /* ignore malformed frame */
    }
  }

  private decodePayload(type: string, bytes: Uint8Array): Record<string, unknown> | null {
    if (!bytes.length) return null;
    switch (type) {
      case 'room_created':
        return decodeMessage(bytes, RoomCreatedSchema);
      case 'join_request':
        return decodeMessage(bytes, JoinRequestSchema);
      case 'join_approved':
        return decodeMessage(bytes, JoinApprovedSchema);
      case 'join_rejected':
        return decodeMessage(bytes, JoinRejectedSchema);
      case 'user_joined':
      case 'user_left':
      case 'user_reconnected':
      case 'user_disconnected':
        return decodeMessage(bytes, UserJoinedSchema);
      case 'sync_playback':
        return decodeMessage(bytes, PlaybackActionSchema);
      case 'buffer_wait':
        return decodeMessage(bytes, BufferWaitSchema);
      case 'sync_state':
        return decodeMessage(bytes, SyncStateSchema);
      case 'error':
        return decodeMessage(bytes, ErrorSchema);
      case 'host_changed':
        return decodeMessage(bytes, HostChangedSchema);
      case 'kicked':
        return decodeMessage(bytes, KickedSchema);
      case 'reconnected':
        return decodeMessage(bytes, ReconnectedSchema);
      case 'room_settings_changed':
        return decodeMessage(bytes, UpdateRoomSettingsSchema);
      case 'suggestion_received':
        return decodeMessage(bytes, SuggestionReceivedSchema);
      case 'suggestion_approved':
        return decodeMessage(bytes, SuggestionApprovedSchema);
      case 'suggestion_rejected':
        return decodeMessage(bytes, SuggestionRejectedSchema);
      case 'chat':
        return decodeMessage(bytes, ChatMessageSchema);
      default:
        return null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private dispatch(type: string, p: any): void {
    switch (type) {
      case 'room_created':
        this.userId = p?.userId ?? null;
        this.role = 'host';
        this.sessionToken = p?.sessionToken ?? null;
        this.roomCode = p?.roomCode ?? null;
        this.emit({ type: 'roomCreated', roomCode: p.roomCode, userId: p.userId });
        break;
      case 'join_request':
        this.emit({ type: 'joinRequest', userId: p.userId, username: p.username });
        break;
      case 'join_approved':
        this.userId = p.userId;
        this.role = 'guest';
        this.sessionToken = p.sessionToken;
        this.roomCode = p.roomCode;
        this.emit({ type: 'joinApproved', roomCode: p.roomCode, userId: p.userId, state: p.state });
        break;
      case 'join_rejected':
        this.emit({ type: 'joinRejected', reason: p?.reason ?? '' });
        break;
      case 'user_joined':
        this.emit({ type: 'userJoined', userId: p.userId, username: p.username });
        break;
      case 'user_left':
        this.emit({ type: 'userLeft', userId: p.userId, username: p.username });
        break;
      case 'user_reconnected':
        this.emit({ type: 'userReconnected', userId: p.userId, username: p.username });
        break;
      case 'user_disconnected':
        this.emit({ type: 'userDisconnected', userId: p.userId, username: p.username });
        break;
      case 'host_changed':
        if (p.newHostId === this.userId) this.role = 'host';
        else if (this.role === 'host') this.role = 'guest';
        this.emit({ type: 'hostChanged', newHostId: p.newHostId, newHostName: p.newHostName });
        break;
      case 'kicked':
        this.sessionToken = null;
        this.roomCode = null;
        this.role = 'none';
        this.emit({ type: 'kicked', reason: p?.reason ?? '' });
        break;
      case 'reconnected':
        this.userId = p.userId;
        this.role = p.isHost ? 'host' : 'guest';
        this.roomCode = p.roomCode;
        this.emit({ type: 'reconnected', roomCode: p.roomCode, userId: p.userId, state: p.state, isHost: p.isHost });
        break;
      case 'sync_playback':
        this.emit({ type: 'playbackSync', action: p as LTPlaybackAction });
        break;
      case 'buffer_wait':
        this.emit({ type: 'bufferWait', trackId: p.trackId, waitingFor: p.waitingFor ?? [] });
        break;
      case 'buffer_complete':
        this.emit({ type: 'bufferComplete', trackId: p?.trackId ?? '' });
        break;
      case 'sync_state':
        this.emit({ type: 'syncState', state: p as Partial<LTRoomState> });
        break;
      case 'error':
        this.emit({ type: 'serverError', code: p?.code ?? '', message: p?.message ?? '' });
        break;
      case 'room_settings_changed':
        this.emit({ type: 'roomSettingsChanged', allowParticipantControl: !!p?.allowParticipantControl });
        break;
      case 'suggestion_received':
        this.emit({
          type: 'suggestionReceived',
          suggestionId: p.suggestionId,
          fromUsername: p.fromUsername,
          track: p.trackInfo,
        });
        break;
      case 'suggestion_approved':
        this.emit({ type: 'suggestionApproved', suggestionId: p.suggestionId, track: p.trackInfo });
        break;
      case 'suggestion_rejected':
        this.emit({ type: 'suggestionRejected', suggestionId: p.suggestionId, reason: p?.reason ?? '' });
        break;
      case 'chat':
        this.emit({ type: 'chat', userId: p.userId, username: p.username, message: p.message, timestamp: p.timestamp });
        break;
      case 'pong':
        this.emit({ type: 'pong', rtt: this.pingSentAt ? Date.now() - this.pingSentAt : 0 });
        this.pingSentAt = 0;
        break;
      default:
        break;
    }
  }

  /* ------------------------------- client -> server ------------------------------- */

  createRoom(): void {
    if (this.state !== 'connected') {
      this.pending = { kind: 'create' };
      this.connect();
      return;
    }
    this.sessionToken = null;
    this.roomCode = null;
    this.send('create_room', encodeMessage({ username: this.opts.username }, CreateRoomSchema));
  }

  joinRoom(code: string): void {
    if (this.state !== 'connected') {
      this.pending = { kind: 'join', code };
      this.connect();
      return;
    }
    this.sessionToken = null;
    this.roomCode = null;
    this.send('join_room', encodeMessage({ roomCode: code.toUpperCase(), username: this.opts.username }, JoinRoomSchema));
  }

  leaveRoom(): void {
    this.send('leave_room');
    this.sessionToken = null;
    this.roomCode = null;
    this.role = 'none';
    this.userId = null;
  }

  approveJoin(userId: string): void {
    this.send('approve_join', encodeMessage({ userId }, ApproveJoinSchema));
  }
  rejectJoin(userId: string, reason?: string): void {
    this.send('reject_join', encodeMessage({ userId, reason: reason ?? '' }, RejectJoinSchema));
  }
  kickUser(userId: string, reason?: string): void {
    this.send('kick_user', encodeMessage({ userId, reason: reason ?? '' }, RejectJoinSchema));
  }
  transferHost(newHostId: string): void {
    this.send('transfer_host', encodeMessage({ newHostId }, [{ num: 1, name: 'newHostId', kind: 'string' }]));
  }
  updateRoomSettings(allowParticipantControl: boolean): void {
    this.send(
      'update_room_settings',
      encodeMessage({ allowParticipantControl }, UpdateRoomSettingsSchema),
    );
  }

  sendPlaybackAction(action: LTPlaybackAction): void {
    this.send('playback_action', encodeMessage(action as unknown as Record<string, unknown>, PlaybackActionSchema));
  }

  requestSync(): void {
    this.send('request_sync');
  }
  sendBufferReady(trackId: string): void {
    this.send('buffer_ready', encodeMessage({ trackId }, BufferReadySchema));
  }
  suggestTrack(track: LTTrackInfo): void {
    this.send('suggest_track', encodeMessage({ trackInfo: track }, SuggestTrackSchema));
  }
  approveSuggestion(id: string): void {
    this.send('approve_suggestion', encodeMessage({ suggestionId: id }, ApproveSuggestionSchema));
  }
  rejectSuggestion(id: string, reason?: string): void {
    this.send('reject_suggestion', encodeMessage({ suggestionId: id, reason: reason ?? '' }, RejectSuggestionSchema));
  }
  sendChat(message: string): void {
    this.send(
      'chat',
      encodeMessage({ message }, [{ num: 1, name: 'message', kind: 'string' }]),
    );
  }

  get roomCodeValue(): string | null {
    return this.roomCode;
  }
}

export type { LTTrackInfo, LTUserInfo };
