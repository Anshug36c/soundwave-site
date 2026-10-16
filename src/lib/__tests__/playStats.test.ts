/**
 * Verifies the listening-history booking rules ported from `SongPlayStatsRepository.kt` and the
 * `MusicService` call sites: the 0.85 completion threshold decides skip vs. completed, play time
 * accumulates, and play count only rises on completion.
 */
import { describe, it, expect } from 'vitest';
import { evaluateSession, recordListenedMs, recordSkip, bookSession } from '../playStats';
import { emptyPlayStats, COMPLETION_RATIO } from '../types';

const NOW = 1_700_000_000_000;

describe('evaluateSession (the 0.85 rule)', () => {
  it('marks an automatic end as completed, not a skip', () => {
    const o = evaluateSession(180_000, 180_000, 'auto');
    expect(o.completed).toBe(true);
    expect(o.wasSkip).toBe(false);
    expect(o.completionRatio).toBe(1);
  });

  it('counts 85%+ of duration as completed', () => {
    const o = evaluateSession(180_000 * COMPLETION_RATIO, 180_000, 'auto');
    expect(o.completed).toBe(true);
  });

  it('marks a manual stop below 85% as a skip', () => {
    const o = evaluateSession(30_000, 180_000, 'manual');
    expect(o.wasSkip).toBe(true);
    expect(o.completed).toBe(false);
  });

  it('does not mark a manual stop at/above 85% as a skip', () => {
    const o = evaluateSession(180_000 * 0.9, 180_000, 'manual');
    expect(o.wasSkip).toBe(false);
    expect(o.completed).toBe(true);
  });

  it('handles unknown duration by treating any play as completed', () => {
    const o = evaluateSession(5_000, 0, 'auto');
    expect(o.completionRatio).toBe(0);
    expect(o.completed).toBe(true);
    expect(o.wasSkip).toBe(false);
  });
});

describe('recordListenedMs', () => {
  it('accumulates play time and bumps play count on completion', () => {
    const existing = emptyPlayStats('k', 'T', 'A');
    const updated = recordListenedMs(existing, {
      title: 'T', artist: 'A', listenedMs: 60_000, completed: true, now: NOW,
    })!;
    expect(updated.totalPlayTimeMs).toBe(60_000);
    expect(updated.playCount).toBe(1);
    expect(updated.skipCount).toBe(0);
    expect(updated.lastPlayedAtMillis).toBe(NOW);

    const again = recordListenedMs(updated, {
      title: 'T', artist: 'A', listenedMs: 30_000, completed: false, now: NOW + 1,
    })!;
    expect(again.totalPlayTimeMs).toBe(90_000);
    expect(again.playCount).toBe(1); // not completed => no bump
  });

  it('creates a fresh record when none exists', () => {
    const created = recordListenedMs(undefined, {
      title: 'Song', artist: 'Artist', listenedMs: 10_000, completed: false, now: NOW,
    })!;
    expect(created.trackKey).toBe('song|artist');
    expect(created.totalPlayTimeMs).toBe(10_000);
    expect(created.playCount).toBe(0);
  });

  it('ignores a blank title', () => {
    expect(recordListenedMs(undefined, { title: '  ', artist: 'A', listenedMs: 10, completed: true })).toBeNull();
  });
});

describe('recordSkip', () => {
  it('bumps skip count without adding play time', () => {
    const existing = { ...emptyPlayStats('k', 'T', 'A'), totalPlayTimeMs: 50_000 };
    const updated = recordSkip(existing, { title: 'T', artist: 'A', now: NOW })!;
    expect(updated.skipCount).toBe(1);
    expect(updated.totalPlayTimeMs).toBe(50_000);
    expect(updated.lastPlayedAtMillis).toBe(NOW);
  });

  it('creates a fresh record with one skip', () => {
    const created = recordSkip(undefined, { title: 'S', artist: 'A', now: NOW })!;
    expect(created.skipCount).toBe(1);
    expect(created.totalPlayTimeMs).toBe(0);
  });
});

describe('bookSession', () => {
  it('records a skip for a manual early exit', () => {
    const result = bookSession(emptyPlayStats('k', 'T', 'A'), {
      title: 'T', artist: 'A', listenedMs: 10_000, durationMs: 180_000, reason: 'manual', now: NOW,
    })!;
    expect(result.skipCount).toBe(1);
    expect(result.playCount).toBe(0);
  });

  it('records listened time and completion for a full auto play', () => {
    const result = bookSession(emptyPlayStats('k', 'T', 'A'), {
      title: 'T', artist: 'A', listenedMs: 180_000, durationMs: 180_000, reason: 'auto', now: NOW,
    })!;
    expect(result.totalPlayTimeMs).toBe(180_000);
    expect(result.playCount).toBe(1);
    expect(result.skipCount).toBe(0);
  });

  it('preserves existing album and artwork when not supplied', () => {
    const existing = { ...emptyPlayStats('k', 'T', 'A', 'Album', 'art.jpg') };
    const result = bookSession(existing, {
      title: 'T', artist: 'A', listenedMs: 180_000, durationMs: 180_000, reason: 'auto', now: NOW,
    })!;
    expect(result.album).toBe('Album');
    expect(result.artwork).toBe('art.jpg');
  });
});
