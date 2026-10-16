/**
 * Central application store (Zustand).
 *
 * Owns the library, listening history, playlists, EQ profiles, settings and the playback queue,
 * and bridges them to the `AudioEngine` singleton and to IndexedDB. React components subscribe to
 * slices of this store; nothing else touches the engine directly.
 *
 * Persistence model:
 *   - Metadata, history, playlists, EQ and settings persist in IndexedDB across reloads.
 *   - Audio bytes do not. Where the File System Access API is available we persist
 *     `FileSystemFileHandle`s and can silently re-open the same files next visit; elsewhere the
 *     in-memory `File` refs make tracks playable for the session only. `capabilities` records which
 *     mode we are in so the UI can be honest about it.
 */

import { create } from 'zustand';
import { AudioEngine } from '../audio/engine';
import { setVisualizerEngine } from '../components/Visualizer';
import { trackKeyOf, generateFromTaste, TASTE_PLAYLIST_ID } from '../lib/tasteScoring';
import { bookSession, type TransitionReason } from '../lib/playStats';
import { parseAudioFile, isSupportedAudioFile } from '../lib/tagParser';
import { validate, parseText } from '../lib/eqParser';
import {
  DEFAULT_SETTINGS,
  getAllTracks,
  getAllStats,
  getAllPlaylists,
  getAllEqProfiles,
  getSettings,
  putTracks,
  putStats,
  putPlaylist,
  deletePlaylist as dbDeletePlaylist,
  putEqProfile,
  deleteEqProfile as dbDeleteEqProfile,
  putSettings,
  getQueue,
  putQueue,
  updateTrack as dbUpdateTrack,
  deleteTrack as dbDeleteTrack,
  wipeAll,
  type Settings,
  type StoredTrack,
} from '../lib/db';
import type { ParametricEQ, PlayStats, Playlist, SavedEQProfile, SortDir, SortKey, Track } from '../lib/types';

export type Tab = 'library' | 'playlists' | 'taste' | 'equalizer' | 'together' | 'settings';

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
  stats: Record<string, PlayStats>;
  playlists: Playlist[];
  eqProfiles: SavedEQProfile[];
  settings: Settings;

  queue: string[];
  queueIndex: number;
  playing: boolean;
  positionSec: number;
  durationSec: number;
  crossfading: boolean;

  tab: Tab;
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
  setQuery: (q: string) => void;
  setSort: (key: SortKey, dir?: SortDir) => void;
  setNowPlayingOpen: (open: boolean) => void;
  // playback
  playTrack: (id: string, context?: string[]) => Promise<void>;
  playQueue: (ids: string[], startIndex?: number) => Promise<void>;
  togglePlay: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  next: (reason?: TransitionReason) => Promise<void>;
  previous: () => Promise<void>;
  seek: (sec: number) => void;
  seekBy: (delta: number) => void;
  setVolume: (v: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  // playlists
  createPlaylist: (name: string, trackIds: string[]) => Promise<void>;
  addToPlaylist: (playlistId: string, trackIds: string[]) => Promise<void>;
  removeFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  // taste
  generateTasteMix: () => Promise<void>;
  // eq
  setEqEnabled: (on: boolean) => Promise<void>;
  setEqBands: (bands: ParametricEQ['bands'], preamp: number) => Promise<void>;
  applyPresetOrProfile: (bands: ParametricEQ['bands'], preamp: number, profileId: string | null) => Promise<void>;
  saveEqProfile: (name: string) => Promise<void>;
  loadEqProfile: (id: string) => Promise<void>;
  importEqText: (text: string) => Promise<void>;
  deleteEqProfile: (id: string) => Promise<void>;
  // settings
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  setCrossfade: (enabled: boolean, seconds: number) => Promise<void>;
  setLimiter: (enabled: boolean) => Promise<void>;
  wipeEverything: () => Promise<void>;
  dismissMessages: () => void;
}

/* ------------------------------- engine singleton -------------------------- */

let engine: AudioEngine | null = null;
function getEngine(): AudioEngine {
  if (!engine) engine = new AudioEngine();
  return engine;
}

/** Exposed so the visualiser can read the shared graph's analyser without owning the engine. */
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
          throw new Error(`Access to “${track.fileName}” was not granted.`);
        }
      }
    }
    if (!file) throw new Error(`“${track.title}” is not available this session.`);

    const existing = objectUrls.get(track.id);
    if (existing) return existing;
    const url = URL.createObjectURL(file);
    objectUrls.set(track.id, url);
    return url;
  }

  function activeEq(): ParametricEQ {
    const { settings } = get();
    return { preamp: settings.eqPreamp, bands: settings.eqBands, metadata: {} };
  }

  async function persistSettings(patch: Partial<Settings>): Promise<void> {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    await putSettings(next);
  }

  /**
   * Book listening history for a track that just left the deck. The playhead position and duration
   * come from the engine's `ended` event rather than a live re-read, because by the time this runs
   * the engine may already be playing the next track.
   */
  async function commitHistory(
    trackId: string,
    reason: TransitionReason,
    positionSec: number,
    durationSec: number,
  ): Promise<void> {
    const state = get();
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const listenedMs = positionSec * 1000;
    const durationMs = (durationSec || track.durationSec) * 1000;
    const key = trackKeyOf(track.title, track.artist);
    const existing = state.stats[key];
    const updated = bookSession(existing, {
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.artwork,
      listenedMs,
      durationMs,
      reason,
    });
    if (updated) {
      await putStats(updated);
      set((s) => ({ stats: { ...s.stats, [key]: updated } }));
    }
  }

  async function startPlaybackAtIndex(index: number): Promise<void> {
    const state = get();
    const id = state.queue[index];
    if (!id) return;
    const track = state.tracks.find((t) => t.id === id);
    if (!track) return;

    const eng = getEngine();
    try {
      const src = await resolveSrc(track);
      set({ queueIndex: index, playing: true });
      await eng.playNow({ trackId: track.id, src, durationSec: track.durationSec }, true);
      eng.applyEq(activeEq(), state.settings.eqEnabled);
      await prepareStandby();
      await putQueue({ trackIds: state.queue, index, positionSec: 0 });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Could not play that track.', playing: false });
    }
  }

  async function prepareStandby(): Promise<void> {
    const state = get();
    if (!state.settings.crossfadeEnabled) return;
    const eng = getEngine();
    const nextId = nextQueueId(state.queue, state.queueIndex, state.settings.repeat, state.settings.shuffle);
    if (!nextId) return;
    const next = state.tracks.find((t) => t.id === nextId);
    if (!next) return;
    try {
      const src = await resolveSrc(next);
      await eng.prepareNext({ trackId: next.id, src, durationSec: next.durationSec });
    } catch {
      // Preparing the standby is best-effort; a failure just means no crossfade for this pair.
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
    stats: {},
    playlists: [],
    eqProfiles: [],
    settings: DEFAULT_SETTINGS,

    queue: [],
    queueIndex: -1,
    playing: false,
    positionSec: 0,
    durationSec: 0,
    crossfading: false,

    tab: 'library',
    query: '',
    sortKey: 'added',
    sortDir: 'desc',
    nowPlayingOpen: false,

    async init() {
      const eng = getEngine();
      setVisualizerEngine(eng);
      eng.on((e) => {
        switch (e.type) {
          case 'state':
            set({ playing: e.playing });
            break;
          case 'time':
            set({ positionSec: e.positionSec, durationSec: e.durationSec });
            break;
          case 'crossfade':
            set({ crossfading: e.active });
            break;
          case 'ended':
            // A track left the deck (natural end, crossfade, or manual move-on). Book its history
            // from the position captured in the event; do NOT advance here — advancement is driven
            // by `autoAdvance` (natural end) or by the store action that initiated the change.
            void commitHistory(e.trackId, e.reason, e.positionSec, e.durationSec);
            break;
          case 'autoAdvance':
            // The active track reached a genuine end. Move the queue on.
            void get().next('auto');
            break;
          case 'trackChanged': {
            // The engine swapped tracks on its own (automatic crossfade). Sync the queue index to
            // the now-active track and re-arm the standby for the following one. Manual switches
            // already set the index in the calling action, so this is a confirmation no-op there.
            const s = get();
            const idx = s.queue.indexOf(e.trackId);
            if (idx >= 0 && idx !== s.queueIndex) {
              set({ queueIndex: idx });
              void putQueue({ trackIds: s.queue, index: idx, positionSec: 0 });
              void prepareStandby();
            }
            break;
          }
          case 'error':
            set({ error: e.message });
            break;
        }
      });

      const [tracks, stats, playlists, eqProfiles, settings, savedQueue] = await Promise.all([
        getAllTracks(),
        getAllStats(),
        getAllPlaylists(),
        getAllEqProfiles(),
        getSettings(),
        getQueue(),
      ]);

      const trackFiles: Record<string, File> = {};
      const trackHandles: Record<string, FileSystemFileHandle> = {};
      for (const t of tracks) {
        if (t.handle) trackHandles[t.id] = t.handle;
      }

      const statsMap: Record<string, PlayStats> = {};
      for (const s of stats) statsMap[s.trackKey] = s;

      eng.setVolume(settings.volume);
      eng.setCrossfade(settings.crossfadeEnabled, settings.crossfadeSeconds);
      eng.graph.setLimiterEnabled(settings.limiterEnabled);
      eng.applyEq(
        { preamp: settings.eqPreamp, bands: settings.eqBands, metadata: {} },
        settings.eqEnabled,
      );

      set({
        tracks: tracks.map(stripHandle),
        trackFiles,
        trackHandles,
        stats: statsMap,
        playlists,
        eqProfiles,
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
      const existingIds = new Set(state.tracks.map((t) => t.id));

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
          const stored: StoredTrack = { ...track };
          newTracks.push(stored);
          existingIds.add(track.id);
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
        set({ error: 'Folder picking is not supported in this browser. Use “Add files” instead.' });
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
        const res = await fetch(trimmed, { method: 'GET', headers: { Range: 'bytes=0-0' } });
        const type = res.headers.get('content-type') ?? 'audio/mpeg';
        const name = decodeURIComponent(trimmed.split('/').pop()?.split('?')[0] || 'stream');
        // Full parse needs the bytes; fetch them.
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
        void type;
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
      set({ tracks: [], trackFiles: {}, trackHandles: {}, queue: [], queueIndex: -1, playlists: [], playing: false });
    },

    setTab(tab) {
      set({ tab });
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
      await getEngine().play();
    },

    async pause() {
      await getEngine().pause();
    },

    async next(reason = 'manual') {
      const state = get();
      if (state.queue.length === 0) return;
      // History for the outgoing track is booked by the engine's `ended` event (which fires on
      // manual switches, crossfades and natural ends alike), so we must not commit it here too.
      const eng = getEngine();
      if (state.settings.repeat === 'one' && reason === 'auto') {
        await eng.replayCurrent();
        return;
      }
      const nextId = nextQueueId(state.queue, state.queueIndex, state.settings.repeat, state.settings.shuffle);
      if (!nextId) {
        // End of queue with repeat off. `goToNext(null)` emits `ended` (idempotently — a natural
        // end already booked it) and pauses, so history is booked exactly once either way.
        await eng.goToNext(null, reason);
        return;
      }
      const nextIndex = state.queue.indexOf(nextId);
      const track = state.tracks.find((t) => t.id === nextId);
      if (!track) return;
      try {
        const src = await resolveSrc(track);
        set({ queueIndex: nextIndex, playing: true });
        await eng.goToNext({ trackId: track.id, src, durationSec: track.durationSec }, reason);
        eng.applyEq(activeEq(), state.settings.eqEnabled);
        await prepareStandby();
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

    async createPlaylist(name, trackIds) {
      const trimmed = name.trim();
      if (!trimmed) return;
      const playlist: Playlist = {
        id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: trimmed,
        isLocal: true,
        createdAt: Date.now(),
        trackIds: [...trackIds],
      };
      await putPlaylist(playlist);
      set((s) => ({ playlists: [...s.playlists, playlist], notice: `Created “${trimmed}”.` }));
    },

    async addToPlaylist(playlistId, trackIds) {
      const playlist = get().playlists.find((p) => p.id === playlistId);
      if (!playlist) return;
      const merged = [...playlist.trackIds];
      for (const id of trackIds) if (!merged.includes(id)) merged.push(id);
      const updated = { ...playlist, trackIds: merged };
      await putPlaylist(updated);
      set((s) => ({ playlists: s.playlists.map((p) => (p.id === playlistId ? updated : p)) }));
    },

    async removeFromPlaylist(playlistId, trackId) {
      const playlist = get().playlists.find((p) => p.id === playlistId);
      if (!playlist) return;
      const updated = { ...playlist, trackIds: playlist.trackIds.filter((t) => t !== trackId) };
      await putPlaylist(updated);
      set((s) => ({ playlists: s.playlists.map((p) => (p.id === playlistId ? updated : p)) }));
    },

    async deletePlaylist(id) {
      await dbDeletePlaylist(id);
      set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) }));
    },

    async generateTasteMix() {
      const state = get();
      if (state.tracks.length === 0) {
        set({ error: 'Import some music first — the Taste Engine scores your own listening history.' });
        return;
      }
      const statsMap = new Map(Object.entries(state.stats));
      const result = generateFromTaste(state.tracks, statsMap);
      if (!result.ok) {
        set({ notice: result.error });
        return;
      }
      const trackIds = result.suggestions.map((s) => s.track.id);
      const playlist: Playlist = {
        id: TASTE_PLAYLIST_ID,
        name: result.playlistName,
        isLocal: true,
        createdAt: Date.now(),
        trackIds,
      };
      await putPlaylist(playlist);
      set((s) => ({
        playlists: [...s.playlists.filter((p) => p.id !== TASTE_PLAYLIST_ID), playlist],
        notice: `“${result.playlistName}” ready — ${trackIds.length} tracks from your history.`,
      }));
    },

    async setEqEnabled(on) {
      await persistSettings({ eqEnabled: on });
      getEngine().applyEq(activeEq(), on);
    },

    async setEqBands(bands, preamp) {
      await persistSettings({ eqBands: bands, eqPreamp: preamp });
      getEngine().applyEq({ preamp, bands, metadata: {} }, get().settings.eqEnabled);
    },

    async applyPresetOrProfile(bands, preamp, profileId) {
      await persistSettings({ eqBands: bands, eqPreamp: preamp, eqProfileId: profileId, eqEnabled: true });
      getEngine().applyEq({ preamp, bands, metadata: {} }, true);
    },

    async saveEqProfile(name) {
      const trimmed = name.trim();
      if (!trimmed) return;
      const { settings } = get();
      const errors = validate({ preamp: settings.eqPreamp, bands: settings.eqBands, metadata: {} });
      if (errors.length > 0) {
        set({ error: errors[0] });
        return;
      }
      const profile: SavedEQProfile = {
        id: `eq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: trimmed,
        deviceModel: '',
        bands: settings.eqBands,
        preamp: settings.eqPreamp,
        isCustom: true,
        isActive: true,
        addedTimestamp: Date.now(),
      };
      await putEqProfile(profile);
      await persistSettings({ eqProfileId: profile.id });
      set((s) => ({ eqProfiles: [...s.eqProfiles, profile], notice: `Saved EQ “${trimmed}”.` }));
    },

    async loadEqProfile(id) {
      const profile = get().eqProfiles.find((p) => p.id === id);
      if (!profile) return;
      await persistSettings({
        eqBands: profile.bands,
        eqPreamp: profile.preamp,
        eqProfileId: id,
        eqEnabled: true,
      });
      getEngine().applyEq({ preamp: profile.preamp, bands: profile.bands, metadata: {} }, true);
    },

    async importEqText(text) {
      const eq = parseText(text);
      const errors = validate(eq);
      if (errors.length > 0) {
        set({ error: errors[0] });
        return;
      }
      const name = eq.metadata['Title'] || eq.metadata['Device'] || 'Imported EQ';
      const profile: SavedEQProfile = {
        id: `eq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name,
        deviceModel: eq.metadata['Device'] ?? '',
        bands: eq.bands,
        preamp: eq.preamp,
        isCustom: true,
        isActive: true,
        addedTimestamp: Date.now(),
      };
      await putEqProfile(profile);
      await persistSettings({
        eqBands: eq.bands,
        eqPreamp: eq.preamp,
        eqProfileId: profile.id,
        eqEnabled: true,
      });
      getEngine().applyEq({ preamp: eq.preamp, bands: eq.bands, metadata: {} }, true);
      set((s) => ({ eqProfiles: [...s.eqProfiles, profile], notice: `Imported EQ “${name}” (${eq.bands.length} bands).` }));
    },

    async deleteEqProfile(id) {
      await dbDeleteEqProfile(id);
      set((s) => ({
        eqProfiles: s.eqProfiles.filter((p) => p.id !== id),
        settings: s.settings.eqProfileId === id ? { ...s.settings, eqProfileId: null } : s.settings,
      }));
    },

    async updateSettings(patch) {
      await persistSettings(patch);
    },

    async setCrossfade(enabled, seconds) {
      await persistSettings({ crossfadeEnabled: enabled, crossfadeSeconds: seconds });
      getEngine().setCrossfade(enabled, seconds);
    },

    async setLimiter(enabled) {
      await persistSettings({ limiterEnabled: enabled });
      getEngine().graph.setLimiterEnabled(enabled);
    },

    async wipeEverything() {
      await get().clearLibrary();
      await wipeAll();
      const settings = { ...DEFAULT_SETTINGS };
      await putSettings(settings);
      set({ stats: {}, eqProfiles: [], settings, notice: 'Cleared all local data.' });
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

function nextQueueId(
  queue: string[],
  index: number,
  repeat: Settings['repeat'],
  _shuffle: boolean,
): string | null {
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
