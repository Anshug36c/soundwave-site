/**
 * Remote Web Player state ("Phone" tab).
 *
 * SoundWave on Android acts as a music *provider*: it searches and resolves
 * tracks, and this page plays them with its own <audio> element. The queue,
 * position and transport here are entirely independent of both the site's
 * local library player and the phone's own player — neither can start,
 * stop or requeue the other.
 */
import { create } from 'zustand';
import {
  RemoteClient,
  RemoteError,
  type RemoteSessionInfo,
  type RemoteTrack,
} from '../lib/remoteClient';

export type RemotePhase = 'offline' | 'checking' | 'online' | 'error';

interface RemoteState {
  phase: RemotePhase;
  baseUrl: string;
  code: string;
  error: string | null;
  notice: string | null;
  session: RemoteSessionInfo | null;

  query: string;
  searching: boolean;
  results: RemoteTrack[];

  queue: RemoteTrack[];
  index: number;
  playing: boolean;
  positionSec: number;
  durationSec: number;
  resolving: boolean;
  formatWarning: string | null;

  setBaseUrl: (url: string) => void;
  setCode: (code: string) => void;
  setQuery: (q: string) => void;
  connect: () => Promise<void>;
  reconnect: () => Promise<void>;
  disconnect: () => Promise<void>;
  search: () => Promise<void>;
  playResultsAt: (index: number) => Promise<void>;
  playQueueAt: (index: number) => Promise<void>;
  enqueue: (track: RemoteTrack) => void;
  removeFromQueue: (index: number) => void;
  toggle: () => Promise<void>;
  next: (auto?: boolean) => Promise<void>;
  prev: () => Promise<void>;
  seek: (sec: number) => void;
}

const BASE_KEY = 'sw.remote.base';
const TOKEN_KEY = 'sw.remote.token';

let client: RemoteClient | null = null;
let audio: HTMLAudioElement | null = null;
let retriedTrackId: string | null = null;
let reportTimer: number | null = null;
let lastReportAt = 0;

/** Diagnostic handle (smoke tests): the <audio> element playing phone audio. */
export function getRemoteAudio(): HTMLAudioElement | null {
  return audio;
}

function storageGet(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function storageSet(key: string, value: string): void {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* private mode — session simply won't persist */
  }
}

function getClient(baseUrl: string): RemoteClient {
  if (!client) {
    client = new RemoteClient(baseUrl);
    const saved = storageGet(TOKEN_KEY);
    if (saved) client.setToken(saved);
  } else if (baseUrl) {
    client.setBaseUrl(baseUrl);
  }
  return client;
}

export const remoteStore = create<RemoteState>((set, get) => {
  function currentTrack(): RemoteTrack | null {
    const { queue, index } = get();
    return index >= 0 && index < queue.length ? queue[index] : null;
  }

  function reportState(force = false): void {
    const c = client;
    if (!c || !c.hasToken || get().phase !== 'online') return;
    const now = Date.now();
    if (!force && now - lastReportAt < 1_000) return;
    lastReportAt = now;
    const el = audio;
    void c
      .reportState({
        track: currentTrack(),
        queue: get().queue,
        queueIndex: get().index,
        playing: get().playing,
        positionMs: Math.floor((el?.currentTime ?? get().positionSec) * 1000),
      })
      .catch(() => {
        /* status reporting must never disturb playback */
      });
  }

  function startReportTimer(): void {
    stopReportTimer();
    reportTimer = window.setInterval(() => {
      if (get().playing) reportState(true);
    }, 15_000);
  }

  function stopReportTimer(): void {
    if (reportTimer !== null) {
      clearInterval(reportTimer);
      reportTimer = null;
    }
  }

  function updateMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    const track = currentTrack();
    if (!track) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album ?? '',
      artwork: track.thumbnailUrl ? [{ src: track.thumbnailUrl, sizes: '512x512' }] : [],
    });
    navigator.mediaSession.setActionHandler('play', () => void get().toggle());
    navigator.mediaSession.setActionHandler('pause', () => void get().toggle());
    navigator.mediaSession.setActionHandler('nexttrack', () => void get().next());
    navigator.mediaSession.setActionHandler('previoustrack', () => void get().prev());
  }

  function failSession(e: unknown, fallbackPhase: RemotePhase = 'error'): void {
    if (e instanceof RemoteError && e.code === 'UNAUTHORIZED') {
      storageSet(TOKEN_KEY, '');
      client?.setToken(null);
      set({
        phase: 'error',
        session: null,
        error: 'Your pairing session expired or was revoked in SoundWave. Pair again to continue.',
      });
      return;
    }
    set({
      phase: fallbackPhase,
      error: e instanceof Error ? e.message : 'Something went wrong talking to SoundWave.',
    });
  }

  function ensureAudio(): HTMLAudioElement {
    if (audio) return audio;
    const el = new Audio();
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
    el.addEventListener('play', () => {
      set({ playing: true });
      updateMediaSession();
      reportState(true);
    });
    el.addEventListener('pause', () => {
      set({ playing: false });
      reportState(true);
    });
    el.addEventListener('timeupdate', () => {
      set({ positionSec: el.currentTime || 0, durationSec: el.duration || 0 });
    });
    el.addEventListener('loadedmetadata', () => {
      set({ durationSec: el.duration || 0 });
    });
    el.addEventListener('seeked', () => reportState(true));
    el.addEventListener('ended', () => void get().next(true));
    el.addEventListener('error', () => {
      const track = currentTrack();
      if (!track || !client) return;
      // The bridge re-resolves expired sources; retry once automatically.
      if (retriedTrackId === track.id) {
        set({
          error:
            'Playback failed — the audio source may have expired. Press Play to ask SoundWave for a fresh one.',
          playing: false,
        });
        return;
      }
      retriedTrackId = track.id;
      const resumeAt = el.currentTime || 0;
      void (async () => {
        try {
          set({ notice: 'Stream interrupted — asking SoundWave for a fresh source…' });
          const resolved = await client!.resolve(track.id);
          el.src = client!.streamUrl(resolved.streamPath);
          el.currentTime = resumeAt;
          await el.play();
          set({ notice: null });
        } catch (e) {
          failSession(e);
        }
      })();
    });
    audio = el;
    return el;
  }

  async function playCurrent(): Promise<void> {
    const track = currentTrack();
    const c = client;
    if (!track || !c) return;
    const el = ensureAudio();
    set({ resolving: true, error: null, formatWarning: null });
    try {
      const resolved = await c.resolve(track.id);
      retriedTrackId = null;
      if (!resolved.safariCompatible) {
        set({
          formatWarning:
            'SoundWave could only find an Opus/WebM source for this track, which older iPhones ' +
            'cannot play. If it stays silent, choose another track.',
        });
      }
      el.src = c.streamUrl(resolved.streamPath);
      await el.play();
      updateMediaSession();
      reportState(true);
    } catch (e) {
      if (e instanceof RemoteError && e.code === 'UNAUTHORIZED') failSession(e);
      else
        set({
          error: e instanceof Error ? e.message : 'SoundWave could not start this track.',
          resolving: false,
        });
    } finally {
      if (get().resolving) set({ resolving: false });
    }
  }

  return {
    phase: storageGet(TOKEN_KEY) ? 'offline' : 'offline',
    baseUrl: storageGet(BASE_KEY),
    code: '',
    error: null,
    notice: null,
    session: null,

    query: '',
    searching: false,
    results: [],

    queue: [],
    index: -1,
    playing: false,
    positionSec: 0,
    durationSec: 0,
    resolving: false,
    formatWarning: null,

    setBaseUrl: (url) => {
      storageSet(BASE_KEY, url.trim());
      set({ baseUrl: url });
    },
    setCode: (code) => set({ code }),
    setQuery: (q) => set({ query: q }),

    connect: async () => {
      const baseUrl = get().baseUrl.trim();
      if (!baseUrl) {
        set({ error: 'Enter the bridge address SoundWave shows (tunnel https://… or LAN http://…).' });
        return;
      }
      const c = getClient(baseUrl);
      storageSet(BASE_KEY, baseUrl);
      set({ phase: 'checking', error: null, notice: null });
      try {
        await c.health();
        const code = get().code.trim();
        if (code) {
          const paired = await c.pair(code);
          storageSet(TOKEN_KEY, paired.sessionToken);
        } else if (!c.hasToken) {
          throw new RemoteError(
            'PAIRING_REQUIRED',
            'Enter the 6-digit pairing code shown in SoundWave → Settings → Remote Web Player.',
          );
        }
        const info = await c.session();
        set({ phase: 'online', session: info.session, error: null, code: '' });
        startReportTimer();
        reportState(true);
      } catch (e) {
        if (e instanceof RemoteError && e.code === 'PAIRING_REQUIRED') {
          set({ phase: 'offline', error: e.message });
        } else {
          failSession(e, 'offline');
          if (get().phase === 'error') set({ phase: 'offline' });
        }
      }
    },

    reconnect: async () => {
      const c = getClient(get().baseUrl);
      set({ phase: 'checking', error: null });
      try {
        await c.health();
        const info = await c.session();
        set({ phase: 'online', session: info.session, error: null });
        startReportTimer();
      } catch (e) {
        failSession(e);
      }
    },

    disconnect: async () => {
      stopReportTimer();
      try {
        await client?.revoke();
      } catch {
        /* revoke is best-effort; local forget always happens */
      }
      storageSet(TOKEN_KEY, '');
      client?.setToken(null);
      const el = audio;
      if (el) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
      set({
        phase: 'offline',
        session: null,
        playing: false,
        queue: [],
        index: -1,
        positionSec: 0,
        durationSec: 0,
        error: null,
        notice: null,
      });
    },

    search: async () => {
      const q = get().query.trim();
      const c = client;
      if (!q || !c || get().phase !== 'online') return;
      set({ searching: true, error: null });
      try {
        const results = await c.search(q);
        set({ results, searching: false });
      } catch (e) {
        set({ searching: false });
        failSession(e, 'online');
      }
    },

    playResultsAt: async (index) => {
      set({ queue: get().results.slice(), index });
      await playCurrent();
    },

    playQueueAt: async (index) => {
      set({ index });
      await playCurrent();
    },

    enqueue: (track) => {
      set({ queue: [...get().queue, track] });
      reportState();
    },

    removeFromQueue: (index) => {
      const { queue, index: current } = get();
      const nextQueue = queue.filter((_, i) => i !== index);
      let nextIndex = current;
      if (index < current) nextIndex = current - 1;
      if (index === current) {
        const el = audio;
        el?.pause();
        nextIndex = -1;
        set({ playing: false, positionSec: 0, durationSec: 0 });
      }
      set({ queue: nextQueue, index: nextIndex });
      reportState();
    },

    toggle: async () => {
      const el = ensureAudio();
      if (get().index < 0) {
        if (get().queue.length) {
          set({ index: 0 });
          await playCurrent();
        }
        return;
      }
      if (el.paused) {
        try {
          await el.play();
        } catch {
          // Source may have expired while paused: re-resolve this track.
          await playCurrent();
        }
      } else {
        el.pause();
      }
    },

    next: async (auto = false) => {
      const { queue, index } = get();
      if (index < queue.length - 1) {
        set({ index: index + 1 });
        await playCurrent();
      } else if (!auto) {
        set({ notice: 'End of the queue.' });
      } else {
        set({ playing: false });
        reportState(true);
      }
    },

    prev: async () => {
      const el = audio;
      if (el && el.currentTime > 3) {
        el.currentTime = 0;
        return;
      }
      const { index } = get();
      if (index > 0) {
        set({ index: index - 1 });
        await playCurrent();
      } else if (el) {
        el.currentTime = 0;
      }
    },

    seek: (sec) => {
      const el = audio;
      if (el && isFinite(el.duration) && el.duration > 0) {
        el.currentTime = Math.min(Math.max(0, sec), el.duration);
        set({ positionSec: el.currentTime });
      }
    },
  };
});
