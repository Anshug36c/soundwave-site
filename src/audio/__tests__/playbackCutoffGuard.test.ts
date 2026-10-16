/**
 * Verifies the PlaybackCutoffGuard port against `PlaybackCutoffGuard.kt`, including the v1.4.3
 * behaviour: a genuine end is allowed, a premature end recovers up to the retry budget, and the
 * budget resets per track.
 */
import { describe, it, expect } from 'vitest';
import { PlaybackCutoffGuard, TIME_UNSET } from '../playbackCutoffGuard';

describe('PlaybackCutoffGuard.verifyTrackCompletion', () => {
  it('allows a genuine end at the canonical duration', () => {
    const g = new PlaybackCutoffGuard();
    const d = g.verifyTrackCompletion(180_000, 180_000, TIME_UNSET);
    expect(d.kind).toBe('AllowEnd');
  });

  it('allows an end within the threshold of the canonical duration', () => {
    const g = new PlaybackCutoffGuard();
    // 2s short of 180s, threshold is 3s => genuine.
    const d = g.verifyTrackCompletion(178_000, 180_000, TIME_UNSET);
    expect(d.kind).toBe('AllowEnd');
  });

  it('recovers a premature end beyond the threshold', () => {
    const g = new PlaybackCutoffGuard();
    // Stopped at 30s of a 180s track => premature.
    const d = g.verifyTrackCompletion(30_000, 180_000, TIME_UNSET);
    expect(d.kind).toBe('RecoverPrematureCutoff');
    if (d.kind === 'RecoverPrematureCutoff') {
      expect(d.resumePositionMs).toBe(30_000);
      expect(d.retryAttempt).toBe(1);
    }
  });

  it('honours the max retry budget', () => {
    const g = new PlaybackCutoffGuard({ maxRetriesPerTrack: 2 });
    expect(g.verifyTrackCompletion(10_000, 180_000).kind).toBe('RecoverPrematureCutoff');
    expect(g.verifyTrackCompletion(10_000, 180_000).kind).toBe('RecoverPrematureCutoff');
    // Third attempt is out of budget => allow the end.
    expect(g.verifyTrackCompletion(10_000, 180_000).kind).toBe('AllowEnd');
    expect(g.getRetryCount()).toBe(2);
  });

  it('resets the budget on track change', () => {
    const g = new PlaybackCutoffGuard({ maxRetriesPerTrack: 1 });
    g.verifyTrackCompletion(10_000, 180_000);
    expect(g.getRetryCount()).toBe(1);
    g.onTrackChanged('next');
    expect(g.getRetryCount()).toBe(0);
    expect(g.verifyTrackCompletion(10_000, 180_000).kind).toBe('RecoverPrematureCutoff');
  });

  it('allows an end when the player duration was reached even if canonical disagrees', () => {
    const g = new PlaybackCutoffGuard();
    // Player reports 100s, we reached 99s (within threshold) but canonical claims 180s.
    const d = g.verifyTrackCompletion(99_000, 180_000, 100_000);
    expect(d.kind).toBe('AllowEnd');
  });

  it('allows an end when canonical duration is unknown', () => {
    const g = new PlaybackCutoffGuard();
    expect(g.verifyTrackCompletion(5_000, 0, TIME_UNSET).kind).toBe('AllowEnd');
  });

  it('clamps a negative position to zero', () => {
    const g = new PlaybackCutoffGuard();
    const d = g.verifyTrackCompletion(-5_000, 180_000, TIME_UNSET);
    if (d.kind === 'RecoverPrematureCutoff') expect(d.resumePositionMs).toBe(0);
    else throw new Error('expected recovery');
  });
});

describe('PlaybackCutoffGuard.computeEffectiveDuration', () => {
  it('prefers the canonical seconds', () => {
    expect(PlaybackCutoffGuard.computeEffectiveDuration(180, 100_000)).toBe(180_000);
  });
  it('falls back to the player duration', () => {
    expect(PlaybackCutoffGuard.computeEffectiveDuration(null, 100_000)).toBe(100_000);
    expect(PlaybackCutoffGuard.computeEffectiveDuration(0, 100_000)).toBe(100_000);
  });
  it('returns zero when nothing is known', () => {
    expect(PlaybackCutoffGuard.computeEffectiveDuration(null, TIME_UNSET)).toBe(0);
    expect(PlaybackCutoffGuard.computeEffectiveDuration(0, 0)).toBe(0);
  });
});
