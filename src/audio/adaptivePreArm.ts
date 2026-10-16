/**
 * AdaptivePreArmManager — a faithful port of
 * `playback/src/main/kotlin/echo/music/iad1tya/playback/crossfade/AdaptivePreArmManager.kt`.
 *
 * Tracks how long media preparation actually takes and widens or narrows the pre-arm window so
 * the standby deck is ready before the crossfade instant arrives. On Android it exists to absorb
 * network variance; in the browser it absorbs the same variance for remote (`url`) tracks, and
 * stays at base lead time for local files that prepare instantly.
 */

export const BASE_LEAD_TIME_MS = 20_000;
export const MAX_LEAD_TIME_MS = 35_000;
export const SLOW_PREP_THRESHOLD_MS = 8_000;
const WINDOW_SIZE = 5;
const DECAY_STEP_MS = 2_000;

export class AdaptivePreArmManager {
  private leadTimeMs: number;
  private readonly recentPrepTimes: number[] = [];

  constructor(
    readonly baseLeadTimeMs: number = BASE_LEAD_TIME_MS,
    readonly maxLeadTimeMs: number = MAX_LEAD_TIME_MS,
    private readonly slowPrepThresholdMs: number = SLOW_PREP_THRESHOLD_MS,
  ) {
    if (baseLeadTimeMs <= 0) throw new Error('baseLeadTimeMs must be positive');
    if (slowPrepThresholdMs <= 0) throw new Error('slowPrepThresholdMs must be positive');
    if (maxLeadTimeMs < baseLeadTimeMs) {
      throw new Error('maxLeadTimeMs must be at least baseLeadTimeMs');
    }
    this.leadTimeMs = baseLeadTimeMs;
  }

  get currentLeadTimeMs(): number {
    return this.leadTimeMs;
  }

  /** `recordPreparationDuration(durationMs)` */
  recordPreparationDuration(durationMs: number): void {
    this.recentPrepTimes.push(durationMs);
    if (this.recentPrepTimes.length > WINDOW_SIZE) this.recentPrepTimes.shift();

    if (durationMs > this.slowPrepThresholdMs) {
      // Expand lead time proportionally.
      const expansion = Math.trunc((durationMs - this.slowPrepThresholdMs) * 1.5);
      this.leadTimeMs = Math.min(
        this.maxLeadTimeMs,
        Math.max(this.leadTimeMs, this.baseLeadTimeMs + expansion),
      );
    } else {
      // Fast preparation: decay back towards the base lead time.
      const average =
        this.recentPrepTimes.reduce((a, b) => a + b, 0) / this.recentPrepTimes.length;
      if (average < this.slowPrepThresholdMs) {
        this.leadTimeMs = Math.max(this.baseLeadTimeMs, this.leadTimeMs - DECAY_STEP_MS);
      }
    }
  }

  /** `reset()` */
  reset(): void {
    this.leadTimeMs = this.baseLeadTimeMs;
    this.recentPrepTimes.length = 0;
  }

  /** Exposed for the Settings screen so the adaptive window is observable, not magic. */
  recentPreparations(): readonly number[] {
    return this.recentPrepTimes;
  }
}
