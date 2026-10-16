/**
 * One player UI over two independent players.
 *
 * The app-mirrored player (mini player + full player) controls whichever
 * player the user last started: the local library player (`store`) or the
 * phone-backed Remote Web Player (`remoteStore`). The two keep separate
 * queues and audio elements; this facade only normalises their state for
 * display and routes transport commands to the visible one.
 */
import { store } from './store';
import { remoteStore } from './remote';
import { playerSource, type PlayerSource } from './playerSource';

export interface QueueEntryView {
  key: string;
  title: string;
  artist: string;
  artwork: string | null;
  durationSec: number;
}

export interface PlayerView {
  source: PlayerSource;
  title: string;
  artist: string;
  album: string | null;
  artwork: string | null;
  playing: boolean;
  resolving: boolean;
  positionSec: number;
  durationSec: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  liked: boolean | null;
  formatWarning: string | null;
  queue: QueueEntryView[];
  queueIndex: number;
}

/** Normalised view of whichever player should be visible, or null when idle. */
export function usePlayerView(): PlayerView | null {
  const source = playerSource((s) => s.source);

  const localQueue = store((s) => s.queue);
  const localIndex = store((s) => s.queueIndex);
  const localTracks = store((s) => s.tracks);
  const localPlaying = store((s) => s.playing);
  const localPosition = store((s) => s.positionSec);
  const localDuration = store((s) => s.durationSec);
  const localShuffle = store((s) => s.settings.shuffle);
  const localRepeat = store((s) => s.settings.repeat);

  const remoteQueue = remoteStore((s) => s.queue);
  const remoteIndex = remoteStore((s) => s.index);
  const remotePlaying = remoteStore((s) => s.playing);
  const remotePosition = remoteStore((s) => s.positionSec);
  const remoteDuration = remoteStore((s) => s.durationSec);
  const remoteResolving = remoteStore((s) => s.resolving);
  const remoteShuffle = remoteStore((s) => s.shuffle);
  const remoteRepeat = remoteStore((s) => s.repeat);
  const remoteWarning = remoteStore((s) => s.formatWarning);

  const localTrack = localIndex >= 0 ? localTracks.find((t) => t.id === localQueue[localIndex]) : undefined;
  const remoteTrack = remoteIndex >= 0 && remoteIndex < remoteQueue.length ? remoteQueue[remoteIndex] : undefined;

  const localView: PlayerView | null = localTrack
    ? {
        source: 'local',
        title: localTrack.title,
        artist: localTrack.artist,
        album: localTrack.album || null,
        artwork: localTrack.artwork,
        playing: localPlaying,
        resolving: false,
        positionSec: localPosition,
        durationSec: localDuration || localTrack.durationSec || 0,
        shuffle: localShuffle,
        repeat: localRepeat,
        liked: localTrack.liked,
        formatWarning: null,
        queue: localQueue
          .map((id) => localTracks.find((t) => t.id === id))
          .filter((t): t is NonNullable<typeof t> => Boolean(t))
          .map((t) => ({ key: t.id, title: t.title, artist: t.artist, artwork: t.artwork, durationSec: t.durationSec })),
        queueIndex: localIndex,
      }
    : null;

  const remoteView: PlayerView | null = remoteTrack
    ? {
        source: 'remote',
        title: remoteTrack.title,
        artist: remoteTrack.artist,
        album: remoteTrack.album ?? null,
        artwork: remoteTrack.thumbnailUrl ?? null,
        playing: remotePlaying,
        resolving: remoteResolving,
        positionSec: remotePosition,
        durationSec: remoteDuration || remoteTrack.durationSec || 0,
        shuffle: remoteShuffle,
        repeat: remoteRepeat,
        liked: null,
        formatWarning: remoteWarning,
        queue: remoteQueue.map((t, i) => ({
          key: `${t.id}-${i}`,
          title: t.title,
          artist: t.artist,
          artwork: t.thumbnailUrl ?? null,
          durationSec: t.durationSec ?? 0,
        })),
        queueIndex: remoteIndex,
      }
    : null;

  if (source === 'remote') return remoteView ?? localView;
  return localView ?? remoteView;
}

/* ------------------------- transport (routes by source) ------------------------ */

export function toggleActive(): void {
  const view = currentShownSource();
  if (view === 'remote') void remoteStore.getState().toggle();
  else void store.getState().togglePlay();
}

export function nextActive(): void {
  if (currentShownSource() === 'remote') void remoteStore.getState().next();
  else void store.getState().next('manual');
}

export function prevActive(): void {
  if (currentShownSource() === 'remote') void remoteStore.getState().prev();
  else void store.getState().previous();
}

export function seekActive(sec: number): void {
  if (currentShownSource() === 'remote') remoteStore.getState().seek(sec);
  else store.getState().seek(sec);
}

export function seekByActive(delta: number): void {
  if (currentShownSource() === 'remote') {
    const r = remoteStore.getState();
    r.seek(r.positionSec + delta);
  } else {
    store.getState().seekBy(delta);
  }
}

export function toggleShuffleActive(): void {
  if (currentShownSource() === 'remote') remoteStore.getState().toggleShuffle();
  else store.getState().toggleShuffle();
}

export function cycleRepeatActive(): void {
  if (currentShownSource() === 'remote') remoteStore.getState().cycleRepeat();
  else store.getState().cycleRepeat();
}

export function playQueueAtActive(index: number): void {
  if (currentShownSource() === 'remote') {
    void remoteStore.getState().playQueueAt(index);
  } else {
    const s = store.getState();
    void s.playQueue(s.queue, index);
  }
}

export function removeQueueAtActive(index: number): void {
  // Only the remote queue supports removing entries from the player.
  if (currentShownSource() === 'remote') remoteStore.getState().removeFromQueue(index);
}

export function toggleLikeActive(): void {
  const s = store.getState();
  const id = s.queue[s.queueIndex];
  if (id) void s.toggleLike(id);
}

/** The source the player UI would currently display (active source, else the other). */
function currentShownSource(): PlayerSource {
  const source = playerSource.getState().source;
  const local = store.getState();
  const remote = remoteStore.getState();
  const localHas = local.queueIndex >= 0 && local.queue.length > 0;
  const remoteHas = remote.index >= 0 && remote.queue.length > 0;
  if (source === 'remote') return remoteHas ? 'remote' : 'local';
  return localHas ? 'local' : 'remote';
}
