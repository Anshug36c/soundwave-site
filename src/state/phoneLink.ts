/**
 * Phone-LAN link (Mode A): the Soundwave app acts as a plain HTTP server on your network and the
 * website plays the phone's audio from it.
 *
 * Why HTTP and not WebSocket: a page served *by the phone* over http:// may use same-origin http
 * and ws freely, but keeping the server side to four plain HTTP endpoints (state / action / audio /
 * static site) makes the embedded Android server small and lets the browser stream the song with a
 * normal <audio> element. The pairing code gates every /api and /audio request.
 *
 * Endpoints the phone serves:
 *   GET  /api/state?code=…   -> {playing, positionMs, durationMs, volume, track{id,title,artist}, queue[]}
 *   POST /api/action?code=…  -> {action: play|pause|seek|next|prev|playTrack, positionMs?, index?}
 *   GET  /api/audio?code=…   -> the current track's bytes (Range-capable) for <audio>
 */
import { create } from 'zustand';

export interface PhoneTrack {
  id: string;
  title: string;
  artist: string;
}
export interface PhoneState {
  playing: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  track: PhoneTrack | null;
  queue: PhoneTrack[];
}

interface PhoneLinkState {
  baseUrl: string;
  code: string;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  state: PhoneState | null;

  setBaseUrl: (url: string) => void;
  setCode: (code: string) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  action: (a: Record<string, unknown>) => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seek: (sec: number) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
}

let audio: HTMLAudioElement | null = null;
let pollTimer: number | null = null;

/** Diagnostic handle (smoke test): the underlying <audio> element streaming the phone's audio. */
export function getPhoneAudio(): HTMLAudioElement | null {
  return audio;
}

function apiUrl(base: string, path: string, code: string): string {
  const b = base.replace(/\/+$/, '');
  return `${b}${path}?code=${encodeURIComponent(code)}`;
}

export const phoneLink = create<PhoneLinkState>((set, get) => {
  function stopPoll(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function ensureAudio(): HTMLAudioElement {
    if (!audio) {
      audio = new Audio();
      audio.preload = 'auto';
    }
    return audio;
  }

  /** Track id currently loaded into the <audio> element. */
  let loadedTrackId: string | null = null;

  /** Keep the local <audio> locked to the phone's reported transport. */
  function align(s: PhoneState): void {
    const el = ensureAudio();
    const { baseUrl, code } = get();
    const id = s.track?.id ?? null;
    // Phone changed track: point <audio> at the new stream (cache-busted) and reload it.
    if (id !== loadedTrackId) {
      loadedTrackId = id;
      el.src = `${apiUrl(baseUrl, '/api/audio', code)}&t=${encodeURIComponent(id ?? '')}`;
      el.load();
    }
    const targetSec = s.positionMs / 1000;
    if (s.playing && el.paused) void el.play().catch(() => {});
    else if (!s.playing && !el.paused) el.pause();
    if (Math.abs(el.currentTime - targetSec) > 0.75) {
      try {
        el.currentTime = targetSec;
      } catch {
        /* not seekable yet */
      }
    }
  }

  async function pollOnce(): Promise<void> {
    const { baseUrl, code } = get();
    try {
      const res = await fetch(apiUrl(baseUrl, '/api/state', code));
      if (res.status === 401 || res.status === 403) {
        stopPoll();
        set({ connected: false, error: 'Wrong code.' });
        return;
      }
      if (!res.ok) return;
      const s = (await res.json()) as PhoneState;
      set({ state: s, connected: true, error: null });
      align(s);
    } catch {
      /* transient network blip; keep polling */
    }
  }

  return {
    baseUrl: '',
    code: '',
    connected: false,
    connecting: false,
    error: null,
    state: null,

    setBaseUrl(baseUrl) {
      set({ baseUrl });
    },
    setCode(code) {
      set({ code: code.toUpperCase() });
    },

    async connect() {
      const { baseUrl, code } = get();
      if (!baseUrl || !code) {
        set({ error: 'Enter the phone address and the code shown in the app.' });
        return;
      }
      set({ connecting: true, error: null });
      try {
        const res = await fetch(apiUrl(baseUrl, '/api/state', code));
        if (res.status === 401 || res.status === 403) {
          set({ connecting: false, connected: false, error: 'Wrong code.' });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const s = (await res.json()) as PhoneState;
        ensureAudio();
        set({ state: s, connected: true, connecting: false, error: null });
        stopPoll();
        pollTimer = window.setInterval(() => void pollOnce(), 600);
        align(s);
      } catch (e) {
        set({
          connecting: false,
          connected: false,
          error: `Cannot reach the phone (${e instanceof Error ? e.message : String(e)}). Same Wi‑Fi?`,
        });
      }
    },

    disconnect() {
      stopPoll();
      loadedTrackId = null;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
      }
      set({ connected: false, state: null });
    },

    async action(a) {
      const { baseUrl, code } = get();
      try {
        await fetch(apiUrl(baseUrl, '/api/action', code), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(a),
        });
      } catch {
        /* ignore; next poll will resync */
      }
    },
    async play() {
      await get().action({ action: 'play' });
    },
    async pause() {
      await get().action({ action: 'pause' });
    },
    async seek(sec) {
      await get().action({ action: 'seek', positionMs: Math.round(sec * 1000) });
    },
    async next() {
      await get().action({ action: 'next' });
    },
    async prev() {
      await get().action({ action: 'prev' });
    },
  };
});
