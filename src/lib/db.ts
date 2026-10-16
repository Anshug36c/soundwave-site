/**
 * Persistent storage for Soundwave Web, backed by IndexedDB (via `idb`).
 *
 * Local-first, like the Android app: the library, the playback queue and the
 * few player preferences live on this device, in the browser's storage.
 * Nothing is sent to a server (there is no server).
 *
 * Audio bytes are **not** stored: they are referenced through
 * `FileSystemFileHandle`s where the File System Access API is available
 * (Chromium), so re-opening the library re-grants access to the same files
 * without re-picking them. On browsers without that API, tracks are
 * session-only and the UI says so.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ParametricEQBand, Track } from './types';

const DB_NAME = 'soundwave-web';
const DB_VERSION = 2;

/** A serialisable handle wrapper; `FileSystemFileHandle` itself is structured-cloneable. */
export interface StoredTrack extends Track {
  /** Present only where the File System Access API granted a persistable handle. */
  handle?: FileSystemFileHandle;
}

/** Player preferences (Settings mirrors the app's playback/appearance prefs). */
export interface Settings {
  volume: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  theme: 'dark' | 'light' | 'system';
  eqEnabled: boolean;
  eqBands: ParametricEQBand[];
}

/** The five bands the web equalizer exposes (app-style parametric bands). */
export const DEFAULT_EQ_BANDS: ParametricEQBand[] = [60, 250, 1000, 4000, 12000].map((frequency) => ({
  frequency,
  gain: 0,
  q: 1.41,
  filterType: 'PK' as const,
  enabled: true,
}));

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.9,
  shuffle: false,
  repeat: 'off',
  theme: 'dark',
  eqEnabled: false,
  eqBands: DEFAULT_EQ_BANDS,
};

interface SoundwaveDB extends DBSchema {
  tracks: { key: string; value: StoredTrack; indexes: { 'by-added': number } };
  settings: { key: string; value: Settings };
  queue: { key: string; value: { trackIds: string[]; index: number; positionSec: number } };
}

let dbPromise: Promise<IDBPDatabase<SoundwaveDB>> | null = null;

export function db(): Promise<IDBPDatabase<SoundwaveDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SoundwaveDB>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('tracks')) {
          const store = database.createObjectStore('tracks', { keyPath: 'id' });
          store.createIndex('by-added', 'addedAt');
        }
        if (!database.objectStoreNames.contains('settings')) {
          database.createObjectStore('settings');
        }
        if (!database.objectStoreNames.contains('queue')) {
          database.createObjectStore('queue');
        }
        // v2 removed the Playlists / Taste / EQ features; drop their stores.
        // (Cast: those names are intentionally no longer in the typed schema.)
        const raw = database as unknown as {
          objectStoreNames: DOMStringList;
          deleteObjectStore(name: string): void;
        };
        for (const legacy of ['stats', 'playlists', 'eqProfiles']) {
          if (raw.objectStoreNames.contains(legacy)) raw.deleteObjectStore(legacy);
        }
      },
    });
  }
  return dbPromise;
}

const SETTINGS_KEY = 'current';
const QUEUE_KEY = 'current';

/* ---------------------------------- tracks --------------------------------- */

export async function getAllTracks(): Promise<StoredTrack[]> {
  const database = await db();
  return database.getAllFromIndex('tracks', 'by-added');
}

export async function putTracks(tracks: StoredTrack[]): Promise<void> {
  if (tracks.length === 0) return;
  const database = await db();
  const tx = database.transaction('tracks', 'readwrite');
  await Promise.all([...tracks.map((t) => tx.store.put(t)), tx.done]);
}

export async function updateTrack(id: string, patch: Partial<StoredTrack>): Promise<void> {
  const database = await db();
  const existing = await database.get('tracks', id);
  if (!existing) return;
  await database.put('tracks', { ...existing, ...patch });
}

export async function deleteTrack(id: string): Promise<void> {
  const database = await db();
  await database.delete('tracks', id);
}

export async function clearTracks(): Promise<void> {
  const database = await db();
  await database.clear('tracks');
}

/* -------------------------------- settings --------------------------------- */

export async function getSettings(): Promise<Settings> {
  const database = await db();
  const stored = await database.get('settings', SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function putSettings(settings: Settings): Promise<void> {
  const database = await db();
  await database.put('settings', settings, SETTINGS_KEY);
}

/* ---------------------------------- queue ---------------------------------- */

export async function getQueue(): Promise<{ trackIds: string[]; index: number; positionSec: number } | undefined> {
  const database = await db();
  return database.get('queue', QUEUE_KEY);
}

export async function putQueue(value: { trackIds: string[]; index: number; positionSec: number }): Promise<void> {
  const database = await db();
  await database.put('queue', value, QUEUE_KEY);
}

/* -------------------------------- maintenance ------------------------------ */

export async function wipeAll(): Promise<void> {
  const database = await db();
  await Promise.all([database.clear('tracks'), database.clear('queue')]);
}
