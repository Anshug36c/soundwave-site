/**
 * Listening statistics for *this browser* (local files + phone-backed
 * playback started here), kept in localStorage. This mirrors the app's
 * Stats idea honestly: it counts only what this device actually played,
 * never the phone's own listening history.
 */
export interface WebStatEntry {
  key: string;
  title: string;
  artist: string;
  artwork: string | null;
  source: 'local' | 'remote';
  plays: number;
  seconds: number;
  lastPlayedAt: number;
}

interface WebStatsData {
  entries: Record<string, WebStatEntry>;
  totalPlays: number;
}

const KEY = 'sw.webstats.v1';

function load(): WebStatsData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as WebStatsData;
  } catch {
    /* private mode / corrupt — start fresh */
  }
  return { entries: {}, totalPlays: 0 };
}

export function recordPlay(
  source: 'local' | 'remote',
  track: { id: string; title: string; artist: string; artwork?: string | null; durationSec?: number | null },
): void {
  try {
    const data = load();
    const key = `${source}:${track.id}`;
    const existing = data.entries[key];
    data.entries[key] = {
      key,
      title: track.title,
      artist: track.artist,
      artwork: track.artwork ?? existing?.artwork ?? null,
      source,
      plays: (existing?.plays ?? 0) + 1,
      seconds: (existing?.seconds ?? 0) + (track.durationSec ?? 0),
      lastPlayedAt: Date.now(),
    };
    data.totalPlays += 1;
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* stats must never break playback */
  }
}

export function readWebStats(): { entries: WebStatEntry[]; totalPlays: number; totalSeconds: number } {
  const data = load();
  const entries = Object.values(data.entries).sort((a, b) => b.plays - a.plays);
  return {
    entries,
    totalPlays: data.totalPlays,
    totalSeconds: entries.reduce((sum, e) => sum + e.seconds, 0),
  };
}

export function clearWebStats(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
