/**
 * Persistent storage for Soundwave Web, backed by IndexedDB (via `idb`).
 *
 * The web build keeps the same local-first principle as the Android app: everything — library
 * metadata, listening history, playlists, EQ profiles and settings — lives on the device in the
 * browser's storage. Nothing is sent to a server (there is no server). This mirrors the app's
 * Room database in spirit, with stores instead of tables.
 *
 * Audio bytes are **not** stored: they are referenced through `FileSystemFileHandle`s where the
 * File System Access API is available (Chromium), so re-opening the library re-grants access to
 * the same files without re-picking them. On browsers without that API, tracks are session-only
 * and the UI says so.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ParametricEQBand, PlayStats, Playlist, SavedEQProfile, Track } from './types';

const DB_NAME = 'soundwave-web';
const DB_VERSION = 1;

/** A serialisable handle wrapper; `FileSystemFileHandle` itself is structured-cloneable. */
export interface StoredTrack extends Track {
  /** Present only where the File System Access API granted a persistable handle. */
  handle?: FileSystemFileHandle;
}

export interface Settings {
  volume: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  crossfadeEnabled: boolean;
  crossfadeSeconds: number;
  limiterEnabled: boolean;
  visualizerStyle: 'bars' | 'wave' | 'off';
  eqProfileId: string | null;
  eqEnabled: boolean;
  eqBands: ParametricEQBand[];
  eqPreamp: number;
  theme: 'dark' | 'light' | 'system';
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.9,
  shuffle: false,
  repeat: 'off',
  crossfadeEnabled: true,
  crossfadeSeconds: 6,
  limiterEnabled: true,
  visualizerStyle: 'bars',
  eqProfileId: null,
  eqEnabled: false,
  eqBands: [],
  eqPreamp: 0,
  theme: 'dark',
};

interface SoundwaveDB extends DBSchema {
  tracks: { key: string; value: StoredTrack; indexes: { 'by-added': number } };
  stats: { key: string; value: PlayStats; indexes: { 'by-last': number } };
  playlists: { key: string; value: Playlist };
  eqProfiles: { key: string; value: SavedEQProfile };
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
        if (!database.objectStoreNames.contains('stats')) {
          const store = database.createObjectStore('stats', { keyPath: 'trackKey' });
          store.createIndex('by-last', 'lastPlayedAtMillis');
        }
        if (!database.objectStoreNames.contains('playlists')) {
          database.createObjectStore('playlists', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('eqProfiles')) {
          database.createObjectStore('eqProfiles', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('settings')) {
          database.createObjectStore('settings');
        }
        if (!database.objectStoreNames.contains('queue')) {
          database.createObjectStore('queue');
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

/* ---------------------------------- stats ---------------------------------- */

export async function getAllStats(): Promise<PlayStats[]> {
  const database = await db();
  return database.getAll('stats');
}

export async function getStats(trackKey: string): Promise<PlayStats | undefined> {
  const database = await db();
  return database.get('stats', trackKey);
}

export async function putStats(stats: PlayStats): Promise<void> {
  const database = await db();
  await database.put('stats', stats);
}

export async function clearStats(): Promise<void> {
  const database = await db();
  await database.clear('stats');
}

/* -------------------------------- playlists -------------------------------- */

export async function getAllPlaylists(): Promise<Playlist[]> {
  const database = await db();
  return database.getAll('playlists');
}

export async function putPlaylist(playlist: Playlist): Promise<void> {
  const database = await db();
  await database.put('playlists', playlist);
}

export async function deletePlaylist(id: string): Promise<void> {
  const database = await db();
  await database.delete('playlists', id);
}

/* ------------------------------- EQ profiles ------------------------------- */

export async function getAllEqProfiles(): Promise<SavedEQProfile[]> {
  const database = await db();
  return database.getAll('eqProfiles');
}

export async function putEqProfile(profile: SavedEQProfile): Promise<void> {
  const database = await db();
  await database.put('eqProfiles', profile);
}

export async function deleteEqProfile(id: string): Promise<void> {
  const database = await db();
  await database.delete('eqProfiles', id);
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
  await Promise.all([
    database.clear('tracks'),
    database.clear('stats'),
    database.clear('playlists'),
    database.clear('eqProfiles'),
    database.clear('queue'),
  ]);
}
