/**
 * PlaybackCutoffGuard — a faithful port of
 * `playback/src/main/kotlin/echo/music/iad1tya/playback/PlaybackCutoffGuard.kt`.
 *
 * This is the v1.4.3 hardening that distinguishes a genuine end-of-track from a stream that died
 * early (expired URL, truncated chunk). On Android it guards Media3's `STATE_ENDED`; here it
 * guards the `ended` event of an `HTMLAudioElement`. The decision logic is unchanged.
 */

export type CutoffDecision =
  | { kind: 'AllowEnd' }
  | { kind: 'RecoverPrematureCutoff'; resumePositionMs: number; retryAttempt: number };

export const AllowEnd: CutoffDecision = { kind: 'AllowEnd' };

/**
 * Stands in for `androidx.media3.common.C.TIME_UNSET` (-9223372036854775807 on Android).
 * Callers pass this when the element has not reported a duration yet.
 */
export const TIME_UNSET = -1;

export interface PlaybackCutoffGuardOptions {
  /** `thresholdMs`, default 3000 — the same value the Android guard ships with. */
  thresholdMs?: number;
  /** `maxRetriesPerTrack`, default 2. */
  maxRetriesPerTrack?: number;
}

export class PlaybackCutoffGuard {
  private readonly thresholdMs: number;
  private readonly maxRetriesPerTrack: number;
  private retryCount = 0;
  private currentMediaId: string | null = null;

  constructor(options: PlaybackCutoffGuardOptions = {}) {
    this.thresholdMs = options.thresholdMs ?? 3000;
    this.maxRetriesPerTrack = options.maxRetriesPerTrack ?? 2;
  }

  /** Resets the retry budget when the active track changes. */
  onTrackChanged(mediaId: string | null): void {
    this.currentMediaId = mediaId;
    this.retryCount = 0;
  }

  getCurrentMediaId(): string | null {
    return this.currentMediaId;
  }

  /**
   * `verifyTrackCompletion(currentPositionMs, canonicalDurationMs, playerDurationMs)`.
   *
   * 1. If the decoder knows a positive duration and playback reached within `thresholdMs` of it,
   *    the container really did end — allow it.
   * 2. If no canonical duration is known, there is nothing to compare against — allow it.
   * 3. Otherwise, if we stopped more than `thresholdMs` short and the retry budget remains,
   *    recover by resuming at the current position.
   */
  verifyTrackCompletion(
    currentPositionMs: number,
    canonicalDurationMs: number,
    playerDurationMs: number = TIME_UNSET,
  ): CutoffDecision {
    const safePosition = Math.max(currentPositionMs, 0);

    if (playerDurationMs > 0) {
      const playerDiscrepancy = playerDurationMs - safePosition;
      if (playerDiscrepancy <= this.thresholdMs) {
        return AllowEnd;
      }
    }

    if (canonicalDurationMs <= 0) return AllowEnd;

    const discrepancy = canonicalDurationMs - safePosition;
    if (discrepancy > this.thresholdMs && this.retryCount < this.maxRetriesPerTrack) {
      this.retryCount += 1;
      return {
        kind: 'RecoverPrematureCutoff',
        resumePositionMs: safePosition,
        retryAttempt: this.retryCount,
      };
    }
    return AllowEnd;
  }

  getRetryCount(): number {
    return this.retryCount;
  }

  /**
   * `computeEffectiveDuration(canonicalDurationSeconds, playerDurationMs)`.
   *
   * Prefers the tag/container duration in seconds; falls back to what the player reports.
   * Returns milliseconds, or 0 when neither source knows.
   */
  static computeEffectiveDuration(
    canonicalDurationSeconds: number | null | undefined,
    playerDurationMs: number,
  ): number {
    const canonicalSeconds = canonicalDurationSeconds ?? 0;
    if (canonicalSeconds > 0) return canonicalSeconds * 1000;
    if (playerDurationMs !== TIME_UNSET && playerDurationMs > 0) return playerDurationMs;
    return 0;
  }
}
