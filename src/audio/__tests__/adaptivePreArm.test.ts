/**
 * Verifies the AdaptivePreArmManager port against `AdaptivePreArmManager.kt`: constructor
 * invariants, proportional expansion on slow prep, and decay back to base on fast prep.
 */
import { describe, it, expect } from 'vitest';
import {
  AdaptivePreArmManager,
  BASE_LEAD_TIME_MS,
  MAX_LEAD_TIME_MS,
  SLOW_PREP_THRESHOLD_MS,
} from '../adaptivePreArm';

describe('AdaptivePreArmManager invariants', () => {
  it('starts at the base lead time', () => {
    const m = new AdaptivePreArmManager();
    expect(m.currentLeadTimeMs).toBe(BASE_LEAD_TIME_MS);
  });
  it('rejects a non-positive base', () => {
    expect(() => new AdaptivePreArmManager(0)).toThrow(/baseLeadTimeMs must be positive/);
  });
  it('rejects a non-positive slow-prep threshold', () => {
    expect(() => new AdaptivePreArmManager(20_000, 35_000, 0)).toThrow(/slowPrepThresholdMs must be positive/);
  });
  it('rejects a max below base', () => {
    expect(() => new AdaptivePreArmManager(20_000, 10_000)).toThrow(/maxLeadTimeMs must be at least baseLeadTimeMs/);
  });
});

describe('AdaptivePreArmManager expansion', () => {
  it('expands proportionally on a slow preparation', () => {
    const m = new AdaptivePreArmManager();
    // 12s prep: (12000 - 8000) * 1.5 = 6000 expansion over base 20000 => 26000.
    m.recordPreparationDuration(12_000);
    expect(m.currentLeadTimeMs).toBe(26_000);
  });

  it('never exceeds the max lead time', () => {
    const m = new AdaptivePreArmManager();
    m.recordPreparationDuration(100_000);
    expect(m.currentLeadTimeMs).toBeLessThanOrEqual(MAX_LEAD_TIME_MS);
    expect(m.currentLeadTimeMs).toBe(MAX_LEAD_TIME_MS);
  });

  it('keeps the larger of current and computed expansion', () => {
    const m = new AdaptivePreArmManager();
    m.recordPreparationDuration(20_000); // big expansion
    const after = m.currentLeadTimeMs;
    m.recordPreparationDuration(9_000); // small expansion, but still slow
    expect(m.currentLeadTimeMs).toBeGreaterThanOrEqual(after);
  });
});

describe('AdaptivePreArmManager decay', () => {
  it('decays by 2s toward base on fast preparations', () => {
    const m = new AdaptivePreArmManager();
    m.recordPreparationDuration(20_000); // push lead time up
    const high = m.currentLeadTimeMs;
    expect(high).toBeGreaterThan(BASE_LEAD_TIME_MS);
    // Feed fast preps until the rolling average drops below the slow threshold.
    for (let i = 0; i < 6; i++) m.recordPreparationDuration(1_000);
    expect(m.currentLeadTimeMs).toBeLessThan(high);
  });

  it('never decays below the base lead time', () => {
    const m = new AdaptivePreArmManager();
    for (let i = 0; i < 20; i++) m.recordPreparationDuration(100);
    expect(m.currentLeadTimeMs).toBe(BASE_LEAD_TIME_MS);
  });
});

describe('AdaptivePreArmManager reset', () => {
  it('returns to base and clears history', () => {
    const m = new AdaptivePreArmManager();
    m.recordPreparationDuration(20_000);
    m.reset();
    expect(m.currentLeadTimeMs).toBe(BASE_LEAD_TIME_MS);
    expect(m.recentPreparations().length).toBe(0);
  });
});

describe('constants match the Kotlin source', () => {
  it('has the documented defaults', () => {
    expect(BASE_LEAD_TIME_MS).toBe(20_000);
    expect(MAX_LEAD_TIME_MS).toBe(35_000);
    expect(SLOW_PREP_THRESHOLD_MS).toBe(8_000);
  });
});
