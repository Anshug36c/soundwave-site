/**
 * Local Taste Engine — a faithful port of
 * `app/src/main/kotlin/com/music/echo/generate/LocalTasteEngine.kt`.
 *
 * Every constant, threshold and formula below is copied from the Android source so the web
 * build ranks listening history identically. Where the Android engine reaches the network
 * (`YouTube.next` / `YouTube.related`) to expand seeds into new songs, the web build cannot:
 * GitHub Pages is a static host with no backend and no provider credentials. Expansion is
 * therefore limited to the visitor's own library, and that limitation is stated in the UI.
 */

import { DEFAULT_TASTE_COUNT, type PlayStats, type TasteSuggestion, type Track } from './types';

/** `MAX_SUGGESTIONS` in LocalTasteEngine.kt. */
export const MAX_SUGGESTIONS = DEFAULT_TASTE_COUNT;
/** `PLAY_WEIGHT`. */
export const PLAY_WEIGHT = 2.0;
/** `SKIP_PENALTY`. */
export const SKIP_PENALTY = 3.0;
/** `LIKED_BONUS`. */
export const LIKED_BONUS = 5.0;
/** `RECENCY_BONUS`. */
export const RECENCY_BONUS = 1.5;
/** `TIME_OF_DAY_BONUS`. */
export const TIME_OF_DAY_BONUS = 1.3;

/** `MORNING = 6..11` */
const MORNING: [number, number] = [6, 11];
/** `AFTERNOON = 12..17` */
const AFTERNOON: [number, number] = [12, 17];
/** `EVENING = 18..21` */
const EVENING: [number, number] = [18, 21];

const SEVEN_DAYS_MS = 7 * 86_400_000;
const THIRTY_DAYS_MS = 30 * 86_400_000;
const RECENT_STATS_LIMIT = 100;
const RECENTLY_PLAYED_FALLBACK_LIMIT = 20;
/** `seedVideoIds … .take(5)` — the Android engine keeps at most five seeds. */
export const MAX_SEEDS = 5;

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

/** `currentTimeOfDay(hour)` in LocalTasteEngine.kt. Hour is injectable for tests. */
export function currentTimeOfDay(hour: number = new Date().getHours()): TimeOfDay {
  const inRange = ([lo, hi]: [number, number]) => hour >= lo && hour <= hi;
  if (inRange(MORNING)) return 'morning';
  if (inRange(AFTERNOON)) return 'afternoon';
  if (inRange(EVENING)) return 'evening';
  return 'night';
}

/**
 * `trackKeyOf(title, artist)` in SongPlayStatsRepository.kt:
 * `"${title.trim()}|${artist.trim()}".lowercase()`.
 */
export function trackKeyOf(title: string, artist: string): string {
  return `${title.trim()}|${artist.trim()}`.toLowerCase();
}

/** The breakdown `scoreStats` produces, so the UI can show its working. */
export interface ScoreBreakdown {
  score: number;
  playTimeContribution: number;
  skipPenalty: number;
  likedBonus: number;
  recencyBonus: number;
  hourMultiplier: number;
  isLiked: boolean;
  isRecent: boolean;
}

/**
 * `scoreStats(stats, likedKeys, timeOfDay)` in LocalTasteEngine.kt.
 *
 * ```
 * playMinutes          = max(totalPlayTimeMs, 0) / 60_000
 * normalizedPlayTime   = ln(1 + playMinutes)
 * score                = normalizedPlayTime * PLAY_WEIGHT
 *                      - skipCount * SKIP_PENALTY
 *                      + (isLiked   ? LIKED_BONUS   : 0)
 *                      + (isRecent  ? RECENCY_BONUS : 0)
 * score               *= hourBonus
 * return max(score, 0)
 * ```
 *
 * `now` is injectable so tests do not depend on the wall clock.
 */
export function scoreStats(
  stats: PlayStats,
  likedKeys: ReadonlySet<string>,
  timeOfDay: TimeOfDay,
  now: number = Date.now(),
): ScoreBreakdown {
  const isLiked = likedKeys.has(stats.trackKey);
  const isRecent = now - stats.lastPlayedAtMillis < SEVEN_DAYS_MS;

  const playMinutes = Math.max(stats.totalPlayTimeMs, 0) / 60_000;
  const normalizedPlayTime = Math.log(1 + playMinutes);
  const playTimeContribution = normalizedPlayTime * PLAY_WEIGHT;
  const skipPenalty = stats.skipCount * SKIP_PENALTY;
  const likedBonus = isLiked ? LIKED_BONUS : 0;
  const recencyBonus = isRecent ? RECENCY_BONUS : 0;

  let score = playTimeContribution - skipPenalty + likedBonus + recencyBonus;

  const hourMultiplier =
    timeOfDay === 'morning'
      ? isRecent
        ? TIME_OF_DAY_BONUS
        : 1.0
      : timeOfDay === 'night'
        ? isLiked
          ? TIME_OF_DAY_BONUS
          : 1.0
        : 1.0;
  score *= hourMultiplier;

  return {
    score: Math.max(score, 0),
    playTimeContribution,
    skipPenalty,
    likedBonus,
    recencyBonus,
    hourMultiplier,
    isLiked,
    isRecent,
  };
}

/**
 * `applyCandidateFilter(stats)` in LocalTasteEngine.kt:
 * `stats.skipCount < 2 || stats.totalPlayTimeMs > 45_000L`.
 *
 * A track survives if it is not repeatedly skipped, or if it has earned enough play time to
 * outweigh the skips.
 */
export function applyCandidateFilter(stats: PlayStats): boolean {
  return stats.skipCount < 2 || stats.totalPlayTimeMs > 45_000;
}

/**
 * Seed selection, mirroring the Android pipeline:
 *
 * 1. `mostPlayedSince(thirtyDaysAgo, limit = 100)`, falling back to `recentlyPlayed(limit = 20)`
 *    when that window is empty.
 * 2. Drop excluded tracks and anything failing `applyCandidateFilter`.
 * 3. Sort descending by `scoreStats`.
 * 4. Keep the top `MAX_SEEDS`.
 */
export function selectSeeds(
  stats: readonly PlayStats[],
  likedKeys: ReadonlySet<string>,
  timeOfDay: TimeOfDay,
  exclusions: ReadonlySet<string> = new Set(),
  now: number = Date.now(),
): PlayStats[] {
  const thirtyDaysAgo = now - THIRTY_DAYS_MS;

  const mostPlayedSince = stats
    .filter((s) => s.lastPlayedAtMillis >= thirtyDaysAgo)
    .sort((a, b) => b.totalPlayTimeMs - a.totalPlayTimeMs)
    .slice(0, RECENT_STATS_LIMIT);

  const recentStats =
    mostPlayedSince.length > 0
      ? mostPlayedSince
      : [...stats].sort((a, b) => b.lastPlayedAtMillis - a.lastPlayedAtMillis).slice(0, RECENTLY_PLAYED_FALLBACK_LIMIT);

  return recentStats
    .filter((s) => !exclusions.has(s.trackKey) && applyCandidateFilter(s))
    .map((s) => ({ stats: s, score: scoreStats(s, likedKeys, timeOfDay, now).score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SEEDS)
    .map((entry) => entry.stats);
}

export type GenerateResult =
  | { ok: true; playlistName: string; suggestions: TasteSuggestion[]; seeds: PlayStats[] }
  | { ok: false; error: string };

/**
 * `LocalTasteEngine.generate(count)`, restricted to local candidates.
 *
 * The Android version expands seeds through `YouTube.next`/`YouTube.related`. Soundwave Web has
 * no server and ships no provider credentials (a deliberate Soundwave invariant), so candidate
 * expansion is limited to tracks already in the visitor's library that are not themselves seeds.
 * Ranking, filtering and scoring are unchanged.
 */
export function generateFromTaste(
  tracks: readonly Track[],
  statsByTrackKey: ReadonlyMap<string, PlayStats>,
  count: number = MAX_SUGGESTIONS,
  exclusions: ReadonlySet<string> = new Set(),
  now: number = Date.now(),
  hour: number = new Date().getHours(),
): GenerateResult {
  const allStats = [...statsByTrackKey.values()];
  if (allStats.length === 0) {
    return { ok: false, error: 'No listening history available yet' };
  }

  const timeOfDay = currentTimeOfDay(hour);
  const likedKeys = new Set(
    tracks.filter((t) => t.liked).map((t) => trackKeyOf(t.title, t.artist)),
  );

  const seeds = selectSeeds(allStats, likedKeys, timeOfDay, exclusions, now);
  if (seeds.length === 0) {
    return { ok: false, error: 'All candidate tracks have been excluded' };
  }

  const seedKeys = new Set(seeds.map((s) => s.trackKey));

  // Seeds first, then the highest-scoring remaining library tracks — the local equivalent of the
  // Android engine's seed expansion, bounded to what the visitor already owns.
  const scored: TasteSuggestion[] = tracks
    .filter((t) => !exclusions.has(t.id))
    .map((track) => {
      const stats = statsByTrackKey.get(track.id);
      if (!stats) return null;
      const breakdown = scoreStats(stats, likedKeys, timeOfDay, now);
      return {
        track,
        score: breakdown.score,
        stats,
        factors: {
          playTimeContribution: breakdown.playTimeContribution,
          skipPenalty: breakdown.skipPenalty,
          likedBonus: breakdown.likedBonus,
          recencyBonus: breakdown.recencyBonus,
          hourMultiplier: breakdown.hourMultiplier,
        },
      } satisfies TasteSuggestion;
    })
    .filter((s): s is TasteSuggestion => s !== null)
    .sort((a, b) => b.score - a.score);

  const seedSuggestions = scored.filter((s) => seedKeys.has(s.track.id));
  const expansion = scored.filter((s) => !seedKeys.has(s.track.id));
  const suggestions = [...seedSuggestions, ...expansion].slice(0, count);

  if (suggestions.length === 0) {
    return { ok: false, error: 'Could not generate playlist from seeds' };
  }

  return {
    ok: true,
    playlistName: 'My Taste Mix',
    suggestions,
    seeds,
  };
}

/** `playlistId = "local_taste_daily_mix"` in LocalTasteEngine.kt. */
export const TASTE_PLAYLIST_ID = 'local_taste_daily_mix';
