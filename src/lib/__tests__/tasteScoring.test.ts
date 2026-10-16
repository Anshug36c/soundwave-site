/**
 * Verifies the Local Taste Engine port against the exact behaviour of
 * `LocalTasteEngine.kt`. The reference values are computed from the Kotlin formula by hand.
 */
import { describe, it, expect } from 'vitest';
import {
  currentTimeOfDay,
  trackKeyOf,
  scoreStats,
  applyCandidateFilter,
  selectSeeds,
  generateFromTaste,
  PLAY_WEIGHT,
  SKIP_PENALTY,
  LIKED_BONUS,
  RECENCY_BONUS,
  TIME_OF_DAY_BONUS,
  MAX_SEEDS,
} from '../tasteScoring';
import { emptyPlayStats, type PlayStats, type Track } from '../types';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function stats(patch: Partial<PlayStats> = {}): PlayStats {
  return { ...emptyPlayStats('k', 'Title', 'Artist'), ...patch };
}

function track(patch: Partial<Track> = {}): Track {
  return {
    id: 'k',
    title: 'Title',
    artist: 'Artist',
    album: '',
    trackNo: null,
    discNo: null,
    year: null,
    genre: '',
    durationSec: 200,
    sampleRate: null,
    bitRate: null,
    codec: 'audio',
    fileName: 'f.mp3',
    fileSize: 1000,
    artwork: null,
    source: 'file',
    addedAt: NOW,
    liked: false,
    ...patch,
  };
}

describe('currentTimeOfDay', () => {
  it('maps hour ranges to periods', () => {
    expect(currentTimeOfDay(6)).toBe('morning');
    expect(currentTimeOfDay(11)).toBe('morning');
    expect(currentTimeOfDay(12)).toBe('afternoon');
    expect(currentTimeOfDay(17)).toBe('afternoon');
    expect(currentTimeOfDay(18)).toBe('evening');
    expect(currentTimeOfDay(21)).toBe('evening');
    expect(currentTimeOfDay(22)).toBe('night');
    expect(currentTimeOfDay(5)).toBe('night');
    expect(currentTimeOfDay(0)).toBe('night');
  });
});

describe('trackKeyOf', () => {
  it('trims and lowercases', () => {
    expect(trackKeyOf('  Song ', '  Artist ')).toBe('song|artist');
  });
});

describe('scoreStats', () => {
  it('applies the log play-time curve and weights', () => {
    // 60 minutes of play time => ln(1+60) * PLAY_WEIGHT
    const s = stats({ totalPlayTimeMs: 60 * 60_000, lastPlayedAtMillis: NOW - 100 * DAY });
    const b = scoreStats(s, new Set(), 'afternoon', NOW);
    const expected = Math.log(1 + 60) * PLAY_WEIGHT;
    expect(b.score).toBeCloseTo(expected, 5);
    expect(b.hourMultiplier).toBe(1);
  });

  it('subtracts the skip penalty', () => {
    const s = stats({ totalPlayTimeMs: 0, skipCount: 2, lastPlayedAtMillis: NOW - 100 * DAY });
    const b = scoreStats(s, new Set(), 'afternoon', NOW);
    expect(b.score).toBeCloseTo(Math.max(0, -2 * SKIP_PENALTY), 5);
    expect(b.score).toBe(0); // coerced to >= 0
  });

  it('adds the liked bonus', () => {
    const s = stats({ totalPlayTimeMs: 0, lastPlayedAtMillis: NOW - 100 * DAY });
    const b = scoreStats(s, new Set(['k']), 'afternoon', NOW);
    expect(b.score).toBeCloseTo(LIKED_BONUS, 5);
  });

  it('adds recency within 7 days', () => {
    const recent = stats({ totalPlayTimeMs: 0, lastPlayedAtMillis: NOW - 3 * DAY });
    const old = stats({ totalPlayTimeMs: 0, lastPlayedAtMillis: NOW - 8 * DAY });
    expect(scoreStats(recent, new Set(), 'afternoon', NOW).score).toBeCloseTo(RECENCY_BONUS, 5);
    expect(scoreStats(old, new Set(), 'afternoon', NOW).score).toBeCloseTo(0, 5);
  });

  it('applies the morning multiplier to recent tracks', () => {
    const recent = stats({ totalPlayTimeMs: 60_000, lastPlayedAtMillis: NOW - DAY });
    const b = scoreStats(recent, new Set(), 'morning', NOW);
    const base = Math.log(1 + 1) * PLAY_WEIGHT + RECENCY_BONUS;
    expect(b.hourMultiplier).toBe(TIME_OF_DAY_BONUS);
    expect(b.score).toBeCloseTo(base * TIME_OF_DAY_BONUS, 5);
  });

  it('applies the night multiplier to liked tracks', () => {
    const liked = stats({ totalPlayTimeMs: 60_000, lastPlayedAtMillis: NOW - 100 * DAY });
    const b = scoreStats(liked, new Set(['k']), 'night', NOW);
    const base = Math.log(1 + 1) * PLAY_WEIGHT + LIKED_BONUS;
    expect(b.hourMultiplier).toBe(TIME_OF_DAY_BONUS);
    expect(b.score).toBeCloseTo(base * TIME_OF_DAY_BONUS, 5);
  });

  it('does not multiply afternoon/evening', () => {
    const s = stats({ totalPlayTimeMs: 60_000, lastPlayedAtMillis: NOW - DAY });
    expect(scoreStats(s, new Set(['k']), 'afternoon', NOW).hourMultiplier).toBe(1);
    expect(scoreStats(s, new Set(['k']), 'evening', NOW).hourMultiplier).toBe(1);
  });

  it('never returns a negative score', () => {
    const s = stats({ totalPlayTimeMs: 0, skipCount: 10, lastPlayedAtMillis: NOW - 100 * DAY });
    expect(scoreStats(s, new Set(), 'afternoon', NOW).score).toBe(0);
  });
});

describe('applyCandidateFilter', () => {
  it('keeps tracks skipped fewer than twice', () => {
    expect(applyCandidateFilter(stats({ skipCount: 1, totalPlayTimeMs: 0 }))).toBe(true);
  });
  it('keeps heavily-skipped tracks that earned >45s play time', () => {
    expect(applyCandidateFilter(stats({ skipCount: 5, totalPlayTimeMs: 46_000 }))).toBe(true);
  });
  it('drops heavily-skipped tracks with little play time', () => {
    expect(applyCandidateFilter(stats({ skipCount: 2, totalPlayTimeMs: 45_000 }))).toBe(false);
    expect(applyCandidateFilter(stats({ skipCount: 2, totalPlayTimeMs: 10_000 }))).toBe(false);
  });
});

describe('selectSeeds', () => {
  it('returns at most MAX_SEEDS, highest score first', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      stats({ trackKey: `k${i}`, totalPlayTimeMs: (i + 1) * 60_000, lastPlayedAtMillis: NOW - DAY }),
    );
    const seeds = selectSeeds(many, new Set(), 'afternoon', new Set(), NOW);
    expect(seeds.length).toBe(MAX_SEEDS);
    // Highest play time first.
    expect(seeds[0].trackKey).toBe('k9');
  });

  it('honours exclusions', () => {
    const list = [
      stats({ trackKey: 'a', totalPlayTimeMs: 120_000, lastPlayedAtMillis: NOW - DAY }),
      stats({ trackKey: 'b', totalPlayTimeMs: 60_000, lastPlayedAtMillis: NOW - DAY }),
    ];
    const seeds = selectSeeds(list, new Set(), 'afternoon', new Set(['a']), NOW);
    expect(seeds.map((s) => s.trackKey)).toEqual(['b']);
  });

  it('falls back to recently played when the 30-day window is empty', () => {
    const old = stats({ trackKey: 'old', totalPlayTimeMs: 600_000, lastPlayedAtMillis: NOW - 40 * DAY });
    const seeds = selectSeeds([old], new Set(), 'afternoon', new Set(), NOW);
    expect(seeds.map((s) => s.trackKey)).toEqual(['old']);
  });
});

describe('generateFromTaste', () => {
  it('fails with no history', () => {
    const result = generateFromTaste([track()], new Map(), 25, new Set(), NOW, 14);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('No listening history available yet');
  });

  it('fails when every candidate is excluded', () => {
    const t = track({ id: 'a', title: 'A', artist: 'X' });
    const map = new Map([[trackKeyOf('A', 'X'), stats({ trackKey: trackKeyOf('A', 'X'), totalPlayTimeMs: 60_000, lastPlayedAtMillis: NOW - DAY })]]);
    const result = generateFromTaste([t], map, 25, new Set(['a']), NOW, 14);
    expect(result.ok).toBe(false);
  });

  it('produces a ranked My Taste Mix, liked and recent tracks first', () => {
    const tracks = [
      track({ id: 'loved', title: 'Loved', artist: 'A', liked: true }),
      track({ id: 'plain', title: 'Plain', artist: 'B' }),
      track({ id: 'skipped', title: 'Skipped', artist: 'C' }),
    ];
    const map = new Map<string, PlayStats>([
      ['loved', stats({ trackKey: 'loved', title: 'Loved', artist: 'A', totalPlayTimeMs: 300_000, lastPlayedAtMillis: NOW - DAY })],
      ['plain', stats({ trackKey: 'plain', title: 'Plain', artist: 'B', totalPlayTimeMs: 120_000, lastPlayedAtMillis: NOW - DAY })],
      ['skipped', stats({ trackKey: 'skipped', title: 'Skipped', artist: 'C', totalPlayTimeMs: 10_000, skipCount: 5, lastPlayedAtMillis: NOW - DAY })],
    ]);
    const result = generateFromTaste(tracks, map, 25, new Set(), NOW, 14);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.playlistName).toBe('My Taste Mix');
      const order = result.suggestions.map((s) => s.track.id);
      expect(order[0]).toBe('loved');
      // The heavily-skipped, barely-played track is filtered out of seeds and ranks last or absent.
      expect(order.indexOf('loved')).toBeLessThan(order.indexOf('plain'));
    }
  });

  it('respects the count limit', () => {
    const tracks = Array.from({ length: 10 }, (_, i) => track({ id: `t${i}`, title: `T${i}`, artist: 'A' }));
    const map = new Map<string, PlayStats>(
      tracks.map((t, i) => [t.id, stats({ trackKey: t.id, title: t.title, artist: 'A', totalPlayTimeMs: (i + 1) * 60_000, lastPlayedAtMillis: NOW - DAY })]),
    );
    const result = generateFromTaste(tracks, map, 3, new Set(), NOW, 14);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.suggestions.length).toBe(3);
  });
});
