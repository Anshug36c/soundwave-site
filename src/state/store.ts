/**
 * Central application store (Zustand) for the local library player.
 *
 * Owns the on-device library (files imported into the browser) and its
 * playback queue, and bridges them to the `AudioEngine` singleton and to
 * IndexedDB. Music from the connected SoundWave phone lives in
 * `state/remote.ts`; the two players never touch each other's queues, and
 * `state/playerSource.ts` records which one the visible player controls.
 *
 * Persistence model:
 *   - Track metadata, the queue layout and player preferences persist in
 *     IndexedDB across reloads.
 *   - Audio bytes do not. Where the File System Access API is available we
 *     persist `FileSystemFileHandle`s and can silently re-open the same
 *     files next visit; elsewhere the in-memory `File` refs make tracks
 *     playable for the session only. `capabilities` records which mode we
 *     are in so the UI can be honest about it.
 */

import { create } from 'zustand';
import { AudioEngine } from '../audio/engine';
import { parseAudioFile, isSupportedAudioFile } from '../lib/tagParser';
import {
  DEFAULT_SETTINGS,
  getAllTracks,
  getSettings,
  putTracks,
  putSettings,
  getQueue,
  putQueue,
  updateTrack as dbUpdateTrack,
  deleteTrack as dbDeleteTrack,
  wipeAll,
  type Settings,
  type StoredTrack,
} from '../lib/db';
import type { SortDir, SortKey, Track } from '../lib/types';
import { playerSource } from './playerSource';
import { recordPlay } from '../lib/webStats';
import type { ParametricEQBand } from '../lib/types';

export type Tab = 'home' | 'search' | 'library' | 'phone';

export interface Capabilities {
  fileSystemAccess: boolean;
  canPersistLibrary: boolean;
}

export interface ImportProgress {
  active: boolean;
  done: number;
  total: number;
  currentName: string;
}

interface StoreState {
  ready: boolean;
  capabilities: Capabilities;
  importing: ImportProgress;
  error: string | null;
  notice: string | null;

  tracks: Track[];
  trackFiles: Record<string, File>;
  trackHandles: Record<string, FileSystemFileHandle>;
  settings: Settings;

  queue: string[];
  queueIndex: number;
  playing: boolean;
  positionSec: number;
  durationSec: number;

  tab: Tab;
  statsOpen: boolean;
  settingsOpen: boolean;
  query: string;
  sortKey: SortKey;
  sortDir: SortDir;
  nowPlayingOpen: boolean;

  // lifecycle
  init: () => Promise<void>;
  // library
  importFiles: (files: File[]) => Promise<void>;
  importFromDirectory: () => Promise<void>;
  addUrl: (url: string) => Promise<void>;
  toggleLike: (id: string) => Promise<void>;
  removeTrack: (id: string) => Promise<void>;
  clearLibrary: () => Promise<void>;
  // browsing
  setTab: (tab: Tab) => void;
  setStatsOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setTheme: (theme: Settings['theme']) => void;
  setEqEnabled: (on: boolean) => void;
  setEqBandGain: (index: number, gain: number) => void;
  applyEqGains: (gains: number[]) => void;
  setQuery: (q: string) => void;
  setSort: (key: SortKey, dir?: SortDir) => void;
  setNowPlayingOpen: (open: boolean) => void;
  // playback
  playTrack: (id: string, context?: string[]) => Promise<void>;
  playQueue: (ids: string[], startIndex?: number) => Promise<void>;
  togglePlay: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  next: (reason?: 'auto' | 'manual') => Promise<void>;
  previous: () => Promise<void>;
  seek: (sec: number) => void;
  seekBy: (delta: number) => void;
  setVolume: (v: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  dismissMessages: () => void;
}

/* ------------------------------- engine singleton -------------------------- */

let engine: AudioEngine | null = null;
function getEngine(): AudioEngine {
  if (!engine) engine = new AudioEngine();
  return engine;
}

/** Exposed for the diagnostic handle in main.tsx. */
export function getSharedEngine(): AudioEngine {
  return getEngine();
}

/** Session-only object URLs, revoked when a track stops being the source. */
const objectUrls = new Map<string, string>();
function revokeObjectUrl(id: string): void {
  const url = objectUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(id);
  }
}

export function detectCapabilities(): Capabilities {
  const fileSystemAccess = typeof window !== 'undefined' && 'showOpenFilePicker' in window;
  return { fileSystemAccess, canPersistLibrary: fileSystemAccess };
}

/* --------------------------------- helpers -------------------------------- */

function shuffleArray<T>(input: readonly T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const store = create<StoreState>((set, get) => {
  /** Resolve a playable src for a track, creating an object URL if needed. */
  async function resolveSrc(track: Track): Promise<string> {
    if (track.source === 'url' && track.url) return track.url;

    let file = get().trackFiles[track.id];
    if (!file) {
      const handle = get().trackHandles[track.id];
      if (handle) {
        try {
          // May require a permission re-grant; handled by the caller on failure.
          file = await handle.getFile();
          set((s) => ({ trackFiles: { ...s.trackFiles, [track.id]: file! } }));
        } catch {
          throw new Error(`Access to "${track.fileName}" was not granted.`);
        }
      }
    }
    if (!file) throw new Error(`"${track.title}" is not available this session.`);

    const existing = objectUrls.get(track.id);
    if (existing) return existing;
    const url = URL.createObjectURL(file);
    objectUrls.set(track.id, url);
    return url;
  }

  async function persistSettings(patch: Partial<Settings>): Promise<void> {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    await putSettings(next);
  }

  async function startPlaybackAtIndex(index: number): Promise<void> {
    const state = get();
    const id = state.queue[index];
    if (!id) return;
    const track = state.tracks.find((t) => t.id === id);
    if (!track) return;

    playerSource.getState().setSource('local');
    const eng = getEngine();
    try {
      const src = await resolveSrc(track);
      set({ queueIndex: index, playing: true });
      await eng.playNow({ trackId: track.id, src, durationSec: track.durationSec }, true);
      recordPlay('local', {
        id: track.id,
        title: track.title,
        artist: track.artist,
        artwork: track.artwork,
        durationSec: track.durationSec,
      });
      await putQueue({ trackIds: state.queue, index, positionSec: 0 });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Could not play that track.', playing: false });
    }
  }

  return {
    ready: false,
    capabilities: detectCapabilities(),
    importing: { active: false, done: 0, total: 0, currentName: '' },
    error: null,
    notice: null,

    tracks: [],
    trackFiles: {},
    trackHandles: {},
    settings: DEFAULT_SETTINGS,

    queue: [],
    queueIndex: -1,
    playing: false,
    positionSec: 0,
    durationSec: 0,

    tab: 'home',
    statsOpen: false,
    settingsOpen: false,
    query: '',
    sortKey: 'added',
    sortDir: 'desc',
    nowPlayingOpen: false,

    async init() {
      const eng = getEngine();
      eng.on((e) => {
        switch (e.type) {
          case 'state':
            set({ playing: e.playing });
            break;
          case 'time':
            set({ positionSec: e.positionSec, durationSec: e.durationSec });
            break;
          case 'autoAdvance':
            // The active track reached a genuine end. Move the queue on.
            void get().next('auto');
            break;
          case 'trackChanged': {
            // The engine swapped tracks on its own. Sync the queue index.
            const s = get();
            const idx = s.queue.indexOf(e.trackId);
            if (idx >= 0 && idx !== s.queueIndex) {
              set({ queueIndex: idx });
              void putQueue({ trackIds: s.queue, index: idx, positionSec: 0 });
            }
            break;
          }
          case 'error':
            set({ error: e.message });
            break;
        }
      });

      const [tracks, settings, savedQueue] = await Promise.all([getAllTracks(), getSettings(), getQueue()]);

      const trackFiles: Record<string, File> = {};
      const trackHandles: Record<string, FileSystemFileHandle> = {};
      for (const t of tracks) {
        if (t.handle) trackHandles[t.id] = t.handle;
      }

      eng.setVolume(settings.volume);
      eng.applyEq({ preamp: 0, bands: settings.eqBands, metadata: {} }, settings.eqEnabled);

      set({
        tracks: tracks.map(stripHandle),
        trackFiles,
        trackHandles,
        settings,
        ready: true,
      });

      // Restore the queue layout (not autoplay — browsers block that without a gesture).
      if (savedQueue && savedQueue.trackIds.length > 0) {
        const stillPresent = savedQueue.trackIds.filter((id) => tracks.some((t) => t.id === id));
        if (stillPresent.length > 0) {
          set({ queue: stillPresent, queueIndex: Math.min(savedQueue.index, stillPresent.length - 1) });
        }
      }

      // Rehydrate Media Session so lock-screen/OS controls work immediately.
      updateMediaSession(get());
    },

    async importFiles(files) {
      const audioFiles = files.filter((f) => isSupportedAudioFile(f.name, f.type));
      if (audioFiles.length === 0) {
        set({ notice: 'No supported audio files in that selection.' });
        return;
      }
      set({ importing: { active: true, done: 0, total: audioFiles.length, currentName: '' }, error: null });

      const state = get();
      const newTracks: StoredTrack[] = [];
      const newFiles: Record<string, File> = { ...state.trackFiles };

      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        set({ importing: { active: true, done: i, total: audioFiles.length, currentName: file.name } });
        try {
          const track = await parseAudioFile({
            blob: file,
            fileName: file.name,
            fileSize: file.size,
            source: 'file',
          });
          // Preserve an existing like if re-importing the same song.
          const prev = state.tracks.find((t) => t.id === track.id);
          if (prev) track.liked = prev.liked;
          newFiles[track.id] = file;
          newTracks.push({ ...track });
        } catch {
          // Skip files we cannot parse; keep going through the rest.
        }
      }

      await putTracks(newTracks);
      const merged = [...state.tracks.filter((t) => !newTracks.some((n) => n.id === t.id)), ...newTracks.map(stripHandle)];
      set({
        tracks: merged,
        trackFiles: newFiles,
        importing: { active: false, done: audioFiles.length, total: audioFiles.length, currentName: '' },
        notice: `Imported ${newTracks.length} track${newTracks.length === 1 ? '' : 's'}.`,
      });
    },

    async importFromDirectory() {
      const picker = (window as unknown as {
        showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker;
      if (!picker) {
        set({ error: 'Folder picking is not supported in this browser. Use "Add files" instead.' });
        return;
      }
      try {
        const dirHandle = await picker.call(window);
        const files: File[] = [];
        const handles: { file: File; handle: FileSystemFileHandle }[] = [];
        for await (const entry of iterateDirectory(dirHandle)) {
          if (isSupportedAudioFile(entry.file.name, entry.file.type)) {
            files.push(entry.file);
            handles.push(entry);
          }
        }
        if (files.length === 0) {
          set({ notice: 'No supported audio files in that folder.' });
          return;
        }
        set({ importing: { active: true, done: 0, total: files.length, currentName: '' }, error: null });

        const state = get();
        const newTracks: StoredTrack[] = [];
        const newFiles: Record<string, File> = { ...state.trackFiles };
        const newHandles: Record<string, FileSystemFileHandle> = { ...state.trackHandles };

        for (let i = 0; i < handles.length; i++) {
          const { file, handle } = handles[i];
          set({ importing: { active: true, done: i, total: handles.length, currentName: file.name } });
          try {
            const track = await parseAudioFile({ blob: file, fileName: file.name, fileSize: file.size, source: 'file' });
            const prev = state.tracks.find((t) => t.id === track.id);
            if (prev) track.liked = prev.liked;
            newFiles[track.id] = file;
            newHandles[track.id] = handle;
            newTracks.push({ ...track, handle });
          } catch {
            /* skip */
          }
        }

        await putTracks(newTracks);
        const merged = [...state.tracks.filter((t) => !newTracks.some((n) => n.id === t.id)), ...newTracks.map(stripHandle)];
        set({
          tracks: merged,
          trackFiles: newFiles,
          trackHandles: newHandles,
          importing: { active: false, done: handles.length, total: handles.length, currentName: '' },
          notice: `Imported ${newTracks.length} track${newTracks.length === 1 ? '' : 's'} from folder.`,
        });
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          set({ error: err instanceof Error ? err.message : 'Could not open that folder.' });
        }
      }
    },

    async addUrl(url) {
      const trimmed = url.trim();
      if (!trimmed) return;
      try {
        const name = decodeURIComponent(trimmed.split('/').pop()?.split('?')[0] || 'stream');
        const full = await fetch(trimmed);
        const blob = await full.blob();
        const track = await parseAudioFile({
          blob,
          fileName: name,
          fileSize: blob.size,
          source: 'url',
          url: trimmed,
        });
        track.liked = false;
        const stored: StoredTrack = { ...track };
        await putTracks([stored]);
        set((s) => ({ tracks: [...s.tracks.filter((t) => t.id !== track.id), stripHandle(stored)], notice: 'Added remote track.' }));
      } catch (err) {
        set({ error: err instanceof Error ? `Could not load that URL: ${err.message}` : 'Could not load that URL.' });
      }
    },

    async toggleLike(id) {
      const track = get().tracks.find((t) => t.id === id);
      if (!track) return;
      const liked = !track.liked;
      await dbUpdateTrack(id, { liked });
      set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, liked } : t)) }));
    },

    async removeTrack(id) {
      await dbDeleteTrack(id);
      revokeObjectUrl(id);
      set((s) => ({
        tracks: s.tracks.filter((t) => t.id !== id),
        queue: s.queue.filter((q) => q !== id),
        trackFiles: omit(s.trackFiles, id),
        trackHandles: omit(s.trackHandles, id),
      }));
    },

    async clearLibrary() {
      const eng = getEngine();
      await eng.pause();
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.clear();
      await wipeAll();
      set({ tracks: [], trackFiles: {}, trackHandles: {}, queue: [], queueIndex: -1, playing: false });
    },

    setTab(tab) {
      set({ tab });
    },
    setStatsOpen(statsOpen) {
      set({ statsOpen });
    },
    setSettingsOpen(settingsOpen) {
      set({ settingsOpen });
    },
    setTheme(theme) {
      void persistSettings({ theme });
    },
    setEqEnabled(on) {
      void persistSettings({ eqEnabled: on });
      getEngine().applyEq({ preamp: 0, bands: get().settings.eqBands, metadata: {} }, on);
    },
    setEqBandGain(index, gain) {
      const bands = get().settings.eqBands.map((b, i) => (i === index ? { ...b, gain } : b));
      void persistSettings({ eqBands: bands });
      getEngine().applyEq({ preamp: 0, bands, metadata: {} }, get().settings.eqEnabled);
    },
    applyEqGains(gains) {
      const bands: ParametricEQBand[] = get().settings.eqBands.map((b, i) => ({ ...b, gain: gains[i] ?? 0 }));
      void persistSettings({ eqBands: bands, eqEnabled: true });
      getEngine().applyEq({ preamp: 0, bands, metadata: {} }, true);
    },
    setQuery(query) {
      set({ query });
    },
    setSort(sortKey, dir) {
      const current = get();
      const sortDir: SortDir = dir ?? (current.sortKey === sortKey ? (current.sortDir === 'asc' ? 'desc' : 'asc') : 'asc');
      set({ sortKey, sortDir });
    },
    setNowPlayingOpen(nowPlayingOpen) {
      set({ nowPlayingOpen });
    },

    async playTrack(id, context) {
      const state = get();
      let queue = context && context.length > 0 ? [...context] : [id];
      if (!context) {
        // Build a queue from the current sorted/filtered library view.
        queue = sortedTracks(state).map((t) => t.id);
        if (!queue.includes(id)) queue = [id, ...queue];
      }
      if (state.settings.shuffle) queue = shuffleWithCurrentFirst(queue, id);
      const index = Math.max(0, queue.indexOf(id));
      set({ queue });
      await startPlaybackAtIndex(index);
    },

    async playQueue(ids, startIndex = 0) {
      if (ids.length === 0) return;
      let queue = [...ids];
      if (get().settings.shuffle) queue = shuffleWithCurrentFirst(queue, queue[startIndex]);
      const index = Math.max(0, Math.min(startIndex, queue.length - 1));
      set({ queue });
      await startPlaybackAtIndex(index);
    },

    async togglePlay() {
      const state = get();
      if (state.queue.length === 0) {
        // Nothing queued: start from the first library track if we have one.
        const first = sortedTracks(state)[0];
        if (first) {
          await get().playTrack(first.id);
          return;
        }
        set({ notice: 'Add some music to get started.' });
        return;
      }
      if (state.queueIndex < 0) {
        await startPlaybackAtIndex(0);
        return;
      }
      const eng = getEngine();
      await eng.toggle();
    },

    async play() {
      playerSource.getState().setSource('local');
      await getEngine().play();
    },

    async pause() {
      await getEngine().pause();
    },

    async next(reason = 'manual') {
      const state = get();
      if (state.queue.length === 0) return;
      const eng = getEngine();
      if (state.settings.repeat === 'one' && reason === 'auto') {
        await eng.replayCurrent();
        return;
      }
      const nextId = nextQueueId(state.queue, state.queueIndex, state.settings.repeat);
      if (!nextId) {
        await eng.goToNext(null, reason);
        return;
      }
      const nextIndex = state.queue.indexOf(nextId);
      const track = state.tracks.find((t) => t.id === nextId);
      if (!track) return;
      try {
        const src = await resolveSrc(track);
        playerSource.getState().setSource('local');
        set({ queueIndex: nextIndex, playing: true });
        await eng.goToNext({ trackId: track.id, src, durationSec: track.durationSec }, reason);
        await putQueue({ trackIds: state.queue, index: nextIndex, positionSec: 0 });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : 'Could not play the next track.' });
      }
    },

    async previous() {
      const state = get();
      const eng = getEngine();
      if (state.positionSec > 3) {
        eng.seek(0);
        return;
      }
      if (state.queue.length === 0) return;
      const prevIndex = state.queueIndex > 0 ? state.queueIndex - 1 : state.queue.length - 1;
      await startPlaybackAtIndex(prevIndex);
    },

    seek(sec) {
      getEngine().seek(sec);
      set({ positionSec: sec });
    },
    seekBy(delta) {
      const eng = getEngine();
      eng.seekBy(delta);
      set({ positionSec: eng.getPositionSec() });
    },

    setVolume(v) {
      getEngine().setVolume(v);
      void persistSettings({ volume: v });
    },

    toggleShuffle() {
      const state = get();
      const shuffle = !state.settings.shuffle;
      let queue = state.queue;
      let queueIndex = state.queueIndex;
      if (shuffle && queue.length > 1) {
        const currentId = queue[queueIndex];
        queue = shuffleWithCurrentFirst(queue, currentId);
        queueIndex = 0;
      }
      set({ queue, queueIndex });
      void persistSettings({ shuffle });
    },

    cycleRepeat() {
      const order: Settings['repeat'][] = ['off', 'all', 'one'];
      const nextMode = order[(order.indexOf(get().settings.repeat) + 1) % order.length];
      void persistSettings({ repeat: nextMode });
    },

    dismissMessages() {
      set({ error: null, notice: null });
    },
  };
});

/* ------------------------------ pure functions ----------------------------- */

function stripHandle(t: StoredTrack): Track {
  const { handle: _handle, ...rest } = t;
  void _handle;
  return rest;
}

function omit<T>(map: Record<string, T>, key: string): Record<string, T> {
  const next = { ...map };
  delete next[key];
  return next;
}

export function sortedTracks(state: Pick<StoreState, 'tracks' | 'query' | 'sortKey' | 'sortDir'>): Track[] {
  const q = state.query.trim().toLowerCase();
  let list = state.tracks;
  if (q) {
    list = list.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q) ||
        t.genre.toLowerCase().includes(q),
    );
  }
  const dir = state.sortDir === 'asc' ? 1 : -1;
  const byKey: Record<SortKey, (a: Track, b: Track) => number> = {
    title: (a, b) => a.title.localeCompare(b.title) * dir,
    artist: (a, b) => (a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)) * dir,
    album: (a, b) => (a.album.localeCompare(b.album) || a.trackNo! - b.trackNo!) * dir,
    duration: (a, b) => (a.durationSec - b.durationSec) * dir,
    added: (a, b) => (a.addedAt - b.addedAt) * dir,
    recent: (a, b) => (a.addedAt - b.addedAt) * dir,
    mostPlayed: (a, b) => (a.addedAt - b.addedAt) * dir,
  };
  return [...list].sort(byKey[state.sortKey]);
}

function nextQueueId(queue: string[], index: number, repeat: Settings['repeat']): string | null {
  if (queue.length === 0) return null;
  if (index + 1 < queue.length) return queue[index + 1];
  return repeat === 'all' ? queue[0] : null;
}

function shuffleWithCurrentFirst(queue: string[], currentId: string | undefined): string[] {
  const rest = queue.filter((id) => id !== currentId);
  const shuffled = shuffleArray(rest);
  return currentId ? [currentId, ...shuffled] : shuffled;
}

/* ------------------------------ Media Session ------------------------------ */

function updateMediaSession(state: StoreState): void {
  if (!('mediaSession' in navigator)) return;
  const id = state.queue[state.queueIndex];
  const track = state.tracks.find((t) => t.id === id);
  if (!track) {
    navigator.mediaSession.metadata = null;
    return;
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album || 'Soundwave Web',
    artwork: track.artwork ? [{ src: track.artwork, sizes: '512x512', type: 'image/jpeg' }] : [],
  });
  navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused';
  navigator.mediaSession.setActionHandler('play', () => void state.togglePlay());
  navigator.mediaSession.setActionHandler('pause', () => void state.togglePlay());
  navigator.mediaSession.setActionHandler('nexttrack', () => void state.next('manual'));
  navigator.mediaSession.setActionHandler('previoustrack', () => void state.previous());
}

/** Async directory walk that yields { file, handle } pairs. */
async function* iterateDirectory(
  dirHandle: FileSystemDirectoryHandle,
): AsyncGenerator<{ file: File; handle: FileSystemFileHandle }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const entry of (dirHandle as any).values()) {
    if (entry.kind === 'file') {
      try {
        const file = await entry.getFile();
        yield { file, handle: entry as FileSystemFileHandle };
      } catch {
        /* skip unreadable */
      }
    } else if (entry.kind === 'directory') {
      yield* iterateDirectory(entry as FileSystemDirectoryHandle);
    }
  }
}
