/**
 * Listening-history bookkeeping — a port of
 * `app/src/main/kotlin/com/music/echo/generate/SongPlayStatsRepository.kt` plus the recording
 * rules `MusicService` applies before calling it.
 *
 * Two rules come straight from the Android source:
 *
 *   - **Skip**: a transition that was *not* automatic and whose completion ratio is below
 *     `COMPLETION_RATIO` (0.85). `wasSkip = !wasAutoTransition && completionRatio < 0.85f`.
 *   - **Completed**: accumulated play time reaches 0.85 of the track duration.
 *     `completed = (totalPlayTimeMs / durationMs) >= 0.85f`.
 *
 * Keeping those identical means the Local Taste Engine scores the same listening behaviour the
 * same way in both builds.
 */

import { COMPLETION_RATIO, emptyPlayStats, type PlayStats } from './types';
import { trackKeyOf } from './tasteScoring';

/** Was this transition automatic (track ended) or user-initiated? */
export type TransitionReason = 'auto' | 'manual';

export interface StopOutcome {
  wasSkip: boolean;
  completed: boolean;
  completionRatio: number;
}

/**
 * Decides how a finished listening session should be booked.
 *
 * @param listenedMs   play time accumulated during this session
 * @param durationMs   canonical track duration in milliseconds
 * @param reason       whether the track ended on its own or the user moved on
 */
export function evaluateSession(
  listenedMs: number,
  durationMs: number,
  reason: TransitionReason,
): StopOutcome {
  const completionRatio = durationMs > 0 ? listenedMs / durationMs : 0;
  const wasAutoTransition = reason === 'auto';
  const wasSkip = !wasAutoTransition && completionRatio < COMPLETION_RATIO;
  const completed = durationMs > 0 ? completionRatio >= COMPLETION_RATIO : listenedMs > 0;

  return { wasSkip, completed, completionRatio };
}

/** `recordListenedMs(...)`: adds play time, bumps `playCount` only when the track completed. */
export function recordListenedMs(
  existing: PlayStats | undefined,
  input: {
    title: string;
    artist: string;
    album?: string;
    artwork?: string | null;
    listenedMs: number;
    completed: boolean;
    now?: number;
  },
): PlayStats | null {
  if (input.title.trim().length === 0) return null;
  const key = trackKeyOf(input.title, input.artist);
  const now = input.now ?? Date.now();

  if (existing) {
    return {
      ...existing,
      artwork: input.artwork ?? existing.artwork,
      album: input.album || existing.album,
      totalPlayTimeMs: existing.totalPlayTimeMs + input.listenedMs,
      playCount: input.completed ? existing.playCount + 1 : existing.playCount,
      lastPlayedAtMillis: now,
    };
  }

  return {
    ...emptyPlayStats(key, input.title, input.artist, input.album ?? '', input.artwork ?? null),
    totalPlayTimeMs: input.listenedMs,
    playCount: input.completed ? 1 : 0,
    lastPlayedAtMillis: now,
  };
}

/** `recordSkip(...)`: bumps `skipCount` and the last-played stamp without adding play time. */
export function recordSkip(
  existing: PlayStats | undefined,
  input: {
    title: string;
    artist: string;
    album?: string;
    artwork?: string | null;
    now?: number;
  },
): PlayStats | null {
  if (input.title.trim().length === 0) return null;
  const key = trackKeyOf(input.title, input.artist);
  const now = input.now ?? Date.now();

  if (existing) {
    return {
      ...existing,
      artwork: input.artwork ?? existing.artwork,
      album: input.album || existing.album,
      skipCount: existing.skipCount + 1,
      lastPlayedAtMillis: now,
    };
  }

  return {
    ...emptyPlayStats(key, input.title, input.artist, input.album ?? '', input.artwork ?? null),
    skipCount: 1,
    lastPlayedAtMillis: now,
  };
}

/** Convenience wrapper used by the player when a track stops. */
export function bookSession(
  existing: PlayStats | undefined,
  input: {
    title: string;
    artist: string;
    album?: string;
    artwork?: string | null;
    listenedMs: number;
    durationMs: number;
    reason: TransitionReason;
    now?: number;
  },
): PlayStats | null {
  const now = input.now ?? Date.now();
  const { wasSkip, completed } = evaluateSession(
    input.listenedMs,
    input.durationMs,
    input.reason,
  );

  // Mirrors MusicService: a manual early transition records a skip, otherwise the listened time.
  if (wasSkip) {
    return recordSkip(existing, input);
  }
  return recordListenedMs(existing, { ...input, completed, now });
}
