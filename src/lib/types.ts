/**
 * Shared domain types for Soundwave Web.
 *
 * Field names mirror the Android app's entities (`SongEntity`, `SongPlayStatsEntity`,
 * `PlaylistEntity`, `SavedEQProfile`) so the two builds stay comparable.
 */

export interface Track {
  /** Stable identity. For library files this is the track key; see `trackKeyOf`. */
  id: string;
  title: string;
  artist: string;
  album: string;
  trackNo: number | null;
  discNo: number | null;
  year: number | null;
  genre: string;
  /** Duration in **seconds**, matching `MediaMetadata.durationSeconds`. */
  durationSec: number;
  sampleRate: number | null;
  bitRate: number | null;
  codec: string;
  fileName: string;
  fileSize: number;
  /** Data URL (JPEG/PNG) of the embedded cover, or null. */
  artwork: string | null;
  /** Source flavour. `url` tracks cannot be persisted across reloads. */
  source: 'file' | 'url';
  /** Remote location for `url` tracks. */
  url?: string;
  addedAt: number;
  liked: boolean;
}

/**
 * Listening statistics for a track.
 *
 * Mirrors `SongPlayStatsEntity`: total play time, skip count and last-played timestamp
 * are the three inputs the Local Taste Engine scores on.
 */
/**
 * Mirrors `SongPlayStatsEntity` field-for-field (minus the Android-only `videoId`, which has no
 * meaning for local files).
 */
export interface PlayStats {
  /** Primary key, produced by `trackKeyOf(title, artist)`. */
  trackKey: string;
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  totalPlayTimeMs: number;
  playCount: number;
  skipCount: number;
  lastPlayedAtMillis: number;
}

export function emptyPlayStats(
  trackKey: string,
  title: string,
  artist: string,
  album = '',
  artwork: string | null = null,
): PlayStats {
  return {
    trackKey,
    title,
    artist,
    album,
    artwork,
    totalPlayTimeMs: 0,
    playCount: 0,
    skipCount: 0,
    lastPlayedAtMillis: 0,
  };
}

/**
 * The completion threshold Soundwave uses in `MusicService`: a track counts as completed once
 * accumulated play time reaches 85% of its duration, and a manual transition below that ratio is
 * a skip.
 */
export const COMPLETION_RATIO = 0.85;

export interface Playlist {
  id: string;
  name: string;
  /** Matches `PlaylistEntity.isLocal` — Soundwave Web playlists are always local. */
  isLocal: true;
  createdAt: number;
  /** Ordered track ids. */
  trackIds: string[];
}

export type RepeatMode = 'off' | 'all' | 'one';

export type SortKey = 'title' | 'artist' | 'album' | 'recent' | 'mostPlayed' | 'duration' | 'added';
export type SortDir = 'asc' | 'desc';

export interface ViewFilter {
  query: string;
  sortKey: SortKey;
  sortDir: SortDir;
}

/** EqualizerAPO / AutoEq filter types — identical to `echo.music.dsp.core.models.FilterType`. */
export type FilterType = 'PK' | 'LSC' | 'HSC' | 'LPQ' | 'HPQ';

/** Mirrors `ParametricEQBand` exactly, including its default Q of 1.41. */
export interface ParametricEQBand {
  frequency: number;
  gain: number;
  q: number;
  filterType: FilterType;
  enabled: boolean;
}

/** Mirrors `SavedEQProfile`. */
export interface SavedEQProfile {
  id: string;
  name: string;
  deviceModel: string;
  bands: ParametricEQBand[];
  preamp: number;
  isCustom: boolean;
  isActive: boolean;
  addedTimestamp: number;
}

/** Mirrors `ParametricEQ`. */
export interface ParametricEQ {
  preamp: number;
  bands: ParametricEQBand[];
  metadata: Record<string, string>;
}

/** Mirrors `ParametricEQ.MAX_BANDS`. */
export const MAX_BANDS = 20;

/**
 * A scored suggestion produced by the Local Taste Engine.
 * `score` is exposed so the Taste screen can explain *why* a track ranked where it did.
 */
export interface TasteSuggestion {
  track: Track;
  score: number;
  stats: PlayStats;
  factors: {
    playTimeContribution: number;
    skipPenalty: number;
    likedBonus: number;
    recencyBonus: number;
    hourMultiplier: number;
  };
}

export const DEFAULT_TASTE_COUNT = 25;
