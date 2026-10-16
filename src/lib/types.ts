/**
 * Shared domain types for Soundwave Web.
 *
 * Field names mirror the Android app's entities (`SongEntity`) so the two builds
 * stay comparable.
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

/** Mirrors `ParametricEQ`. */
export interface ParametricEQ {
  preamp: number;
  bands: ParametricEQBand[];
  metadata: Record<string, string>;
}

/** Mirrors `ParametricEQ.MAX_BANDS`. */
export const MAX_BANDS = 20;

