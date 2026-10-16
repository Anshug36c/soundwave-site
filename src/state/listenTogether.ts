/**
 * Listen Together session store + bridge between the relay protocol and local playback.
 *
 * Roles, mirroring the Android app:
 *  - **host** — this browser drives playback; local transport changes are broadcast as
 *    `playback_action` so phones/other browsers in the room follow.
 *  - **guest** — the room drives this browser: incoming `sync_playback`/`sync_state` resolve the
 *    track against the *local* library (by title/artist, the same `trackKeyOf` identity the app
 *    uses) and mirror play/pause/seek/track/queue. A track the library doesn't have cannot be
 *    sourced (a static page can't stream the phone's files or YouTube), so it surfaces as
 *    `missingTrack` instead of silently doing nothing.
 */
import { create } from 'zustand';
import { store } from './store';
import {
  ListenTogetherClient,
  type LTConnectionState,
  type LTEvent,
  type LTRole,
} from '../lib/ltClient';
import type { LTPlaybackAction, LTRoomState, LTTrackInfo, LTUserInfo } from '../lib/ltProto';
import { trackKeyOf } from '../lib/tasteScoring';
import type { Track } from '../lib/types';

export interface LTPendingJoin {
  userId: string;
  username: string;
}

interface ListenTogetherState {
  connection: LTConnectionState;
  role: LTRole;
  roomCode: string | null;
  userId: string | null;
  users: LTUserInfo[];
  pendingJoins: LTPendingJoin[];
  roomQueue: LTTrackInfo[];
  currentTrack: LTTrackInfo | null;
  isPlaying: boolean;
  positionMs: number;
  volume: number;
  allowParticipantControl: boolean;
  missingTrack: LTTrackInfo | null;
  rtt: number;
  notice: string | null;

  createRoom: () => void;
  joinRoom: (code: string) => void;
  leave: () => void;
  approve: (userId: string) => void;
  reject: (userId: string) => void;
  setAllowParticipantControl: (allow: boolean) => void;
  dismissNotice: () => void;
}

let client: ListenTogetherClient | null = null;
let clientKey = '';
let applyingRemote = false;
let unsubStore: (() => void) | null = null;

function toInfo(t: Track | undefined): LTTrackInfo | null {
  if (!t) return null;
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: Math.round(t.durationSec * 1000),
    thumbnail: '',
    suggestedBy: '',
  };
}

function resolveLocal(info: LTTrackInfo | null | undefined): Track | null {
  if (!info) return null;
  const tracks = store.getState().tracks;
  const byId = tracks.find((t) => t.id === info.id);
  if (byId) return byId;
  const key = trackKeyOf(info.title, info.artist);
  return tracks.find((t) => trackKeyOf(t.title, t.artist) === key) ?? null;
}

export const listenTogether = create<ListenTogetherState>((set, get) => {
  function resetRoom(): void {
    stopHostBroadcast();
    set({
      role: 'none',
      roomCode: null,
      userId: null,
      users: [],
      pendingJoins: [],
      roomQueue: [],
      currentTrack: null,
      isPlaying: false,
      positionMs: 0,
      missingTrack: null,
      allowParticipantControl: false,
    });
  }

  function applyUsers(mut: (users: LTUserInfo[]) => LTUserInfo[]): void {
    set((s) => ({ users: mut(s.users) }));
  }

  /** Make the local engine match a remote track + queue (guest side). */
  async function mirrorTrack(info: LTTrackInfo | null, queue: LTTrackInfo[]): Promise<void> {
    const local = resolveLocal(info);
    if (!info) return;
    if (!local) {
      set({ missingTrack: info });
      await store.getState().pause();
      return;
    }
    set({ missingTrack: null });
    const mapped = queue.map((q) => resolveLocal(q)).filter((t): t is Track => t !== null);
    const st = store.getState();
    const currentId = st.queue[st.queueIndex];
    if (currentId !== local.id && mapped.includes(local)) {
      applyingRemote = true;
      try {
        await st.playQueue(mapped.map((t) => t.id), mapped.indexOf(local));
      } finally {
        applyingRemote = false;
      }
    } else if (currentId !== local.id) {
      applyingRemote = true;
      try {
        await st.playTrack(local.id);
      } finally {
        applyingRemote = false;
      }
    }
  }

  async function alignTransport(isPlaying: boolean, positionMs: number): Promise<void> {
    const st = store.getState();
    applyingRemote = true;
    try {
      if (isPlaying && !st.playing) await st.play();
      else if (!isPlaying && st.playing) await st.pause();
      const targetSec = positionMs / 1000;
      if (Math.abs(st.positionSec - targetSec) > 1) st.seek(targetSec);
    } finally {
      applyingRemote = false;
    }
  }

  function applyRoomState(state: LTRoomState): void {
    set({
      users: state.users ?? [],
      roomQueue: state.queue ?? [],
      currentTrack: state.currentTrack ?? null,
      isPlaying: state.isPlaying,
      positionMs: state.position ?? 0,
      volume: state.volume ?? 1,
      allowParticipantControl: state.allowParticipantControl ?? false,
    });
    if (get().role === 'guest') {
      void mirrorTrack(state.currentTrack, state.queue ?? []).then(() =>
        alignTransport(state.isPlaying, state.position ?? 0),
      );
    }
  }

  async function applyPlayback(a: LTPlaybackAction): Promise<void> {
    switch (a.action) {
      case 'change_track':
        set({ currentTrack: a.trackInfo ?? null, isPlaying: false, positionMs: 0, roomQueue: a.queue?.length ? a.queue : get().roomQueue });
        await mirrorTrack(a.trackInfo ?? null, a.queue?.length ? a.queue : get().roomQueue);
        break;
      case 'play':
        set({ isPlaying: true, positionMs: a.position ?? get().positionMs });
        await alignTransport(true, a.position ?? get().positionMs);
        break;
      case 'pause':
        set({ isPlaying: false, positionMs: a.position ?? get().positionMs });
        await alignTransport(false, a.position ?? get().positionMs);
        break;
      case 'seek':
        set({ positionMs: a.position ?? 0 });
        await alignTransport(get().isPlaying, a.position ?? 0);
        break;
      case 'set_volume':
        if (typeof a.volume === 'number') set({ volume: a.volume });
        break;
      case 'queue_add':
      case 'queue_remove':
      case 'queue_clear':
      case 'sync_queue':
        set((s) => ({ roomQueue: a.queue?.length ? a.queue : s.roomQueue }));
        break;
      default:
        break;
    }
  }

  function handleEvent(e: LTEvent): void {
    switch (e.type) {
      case 'roomCreated':
        set({ role: 'host', roomCode: e.roomCode, userId: e.userId, missingTrack: null });
        applyUsers(() => [
          { userId: e.userId, username: store.getState().settings.ltUsername, isHost: true, isConnected: true },
        ]);
        startHostBroadcast();
        break;
      case 'joinApproved':
        set({ role: 'guest', roomCode: e.roomCode, userId: e.userId });
        applyRoomState(e.state);
        break;
      case 'reconnected':
        set({ role: e.isHost ? 'host' : 'guest', roomCode: e.roomCode, userId: e.userId });
        if (e.isHost) startHostBroadcast();
        applyRoomState(e.state);
        break;
      case 'joinRequest':
        set((s) => ({ pendingJoins: [...s.pendingJoins, { userId: e.userId, username: e.username }] }));
        break;
      case 'userJoined':
        applyUsers((u) => [...u.filter((x) => x.userId !== e.userId), { userId: e.userId, username: e.username, isHost: false, isConnected: true }]);
        set((s) => ({ pendingJoins: s.pendingJoins.filter((p) => p.userId !== e.userId) }));
        break;
      case 'userLeft':
        applyUsers((u) => u.filter((x) => x.userId !== e.userId));
        break;
      case 'userReconnected':
        applyUsers((u) => u.map((x) => (x.userId === e.userId ? { ...x, isConnected: true } : x)));
        break;
      case 'userDisconnected':
        applyUsers((u) => u.map((x) => (x.userId === e.userId ? { ...x, isConnected: false } : x)));
        break;
      case 'hostChanged':
        applyUsers((u) => u.map((x) => ({ ...x, isHost: x.userId === e.newHostId })));
        set((s) => ({ role: e.newHostId === s.userId ? 'host' : s.role === 'host' ? 'guest' : s.role }));
        if (e.newHostId === get().userId) startHostBroadcast();
        else stopHostBroadcast();
        break;
      case 'kicked':
        resetRoom();
        set({ notice: `Removed from room: ${e.reason || 'kicked'}` });
        break;
      case 'playbackSync':
        if (get().role === 'guest') void applyPlayback(e.action);
        break;
      case 'syncState':
        set((s) => ({
          currentTrack: e.state.currentTrack ?? s.currentTrack,
          isPlaying: e.state.isPlaying ?? s.isPlaying,
          positionMs: e.state.position ?? s.positionMs,
          roomQueue: e.state.queue?.length ? e.state.queue : s.roomQueue,
        }));
        if (get().role === 'guest') {
          void mirrorTrack(e.state.currentTrack ?? null, e.state.queue ?? get().roomQueue).then(() =>
            alignTransport(e.state.isPlaying ?? false, e.state.position ?? 0),
          );
        }
        break;
      case 'roomSettingsChanged':
        set({ allowParticipantControl: e.allowParticipantControl });
        break;
      case 'serverError':
        set({ notice: `Server: ${e.code} — ${e.message}` });
        break;
      case 'pong':
        set({ rtt: e.rtt });
        break;
      case 'connectionError':
        set({ notice: e.message });
        break;
      default:
        break;
    }
  }

  function ensureClient(): ListenTogetherClient {
    const { ltServerUrl, ltUsername } = store.getState().settings;
    const key = `${ltServerUrl}|${ltUsername}`;
    if (client && clientKey === key) return client;
    client?.disconnect();
    clientKey = key;
    client = new ListenTogetherClient({
      serverUrl: ltServerUrl,
      username: ltUsername,
      onEvent: handleEvent,
      onState: (connection) => set({ connection }),
    });
    return client;
  }

  function startHostBroadcast(): void {
    if (unsubStore) return;
    unsubStore = store.subscribe((s, prev) => {
      if (applyingRemote) return;
      if (get().role !== 'host' || !get().roomCode || !client) return;
      const curId = s.queue[s.queueIndex];
      const prevId = prev.queue[prev.queueIndex];
      const info = toInfo(s.tracks.find((t) => t.id === curId));
      const queueInfos = s.queue.map((id) => toInfo(s.tracks.find((t) => t.id === id))).filter((x): x is LTTrackInfo => x !== null);

      if (curId && curId !== prevId && info) {
        client.sendPlaybackAction({ action: 'change_track', trackInfo: info, queue: queueInfos, position: 0 });
        return;
      }
      if (s.playing !== prev.playing) {
        client.sendPlaybackAction({
          action: s.playing ? 'play' : 'pause',
          position: Math.round(s.positionSec * 1000),
          trackInfo: info,
        });
        return;
      }
      if (s.playing && curId === prevId) {
        const dp = s.positionSec - prev.positionSec;
        if (dp < -0.4 || dp > 2.5) {
          client.sendPlaybackAction({ action: 'seek', position: Math.round(s.positionSec * 1000) });
          return;
        }
      }
      if (s.settings.volume !== prev.settings.volume) {
        client.sendPlaybackAction({ action: 'set_volume', volume: s.settings.volume });
      }
    });
  }

  function stopHostBroadcast(): void {
    if (unsubStore) {
      unsubStore();
      unsubStore = null;
    }
  }

  return {
    connection: 'disconnected',
    role: 'none',
    roomCode: null,
    userId: null,
    users: [],
    pendingJoins: [],
    roomQueue: [],
    currentTrack: null,
    isPlaying: false,
    positionMs: 0,
    volume: 1,
    allowParticipantControl: false,
    missingTrack: null,
    rtt: 0,
    notice: null,

    createRoom() {
      const c = ensureClient();
      set({ notice: null });
      c.createRoom();
    },
    joinRoom(code) {
      const c = ensureClient();
      set({ notice: null });
      c.joinRoom(code);
    },
    leave() {
      client?.leaveRoom();
      client?.disconnect();
      client = null;
      clientKey = '';
      resetRoom();
      set({ connection: 'disconnected' });
    },
    approve(userId) {
      client?.approveJoin(userId);
      set((s) => ({ pendingJoins: s.pendingJoins.filter((p) => p.userId !== userId) }));
    },
    reject(userId) {
      client?.rejectJoin(userId);
      set((s) => ({ pendingJoins: s.pendingJoins.filter((p) => p.userId !== userId) }));
    },
    setAllowParticipantControl(allow) {
      client?.updateRoomSettings(allow);
      set({ allowParticipantControl: allow });
    },
    dismissNotice() {
      set({ notice: null });
    },
  };
});
