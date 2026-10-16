/**
 * Audio tag parsing, using `music-metadata` (the browser core build, no Node fs).
 *
 * Extracts the same fields the Android app surfaces from a `MediaMetadata`: title, artist, album,
 * track/disc number, year, genre, duration, and the embedded cover art. Artwork is downscaled to a
 * JPEG data URL so it can be stored in IndexedDB and handed to `<img>` without holding a large
 * blob in memory.
 */

import { parseBlob } from 'music-metadata';
import { trackKeyOf } from './tasteScoring';
import type { Track } from './types';

const SUPPORTED_EXT = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|webm|mp4|aiff?|wma)$/i;

export function isSupportedAudioFile(name: string, type?: string): boolean {
  if (type && type.startsWith('audio/')) return true;
  return SUPPORTED_EXT.test(name);
}

/** Largest edge (px) for stored artwork. Keeps IndexedDB rows small. */
const ARTWORK_MAX_EDGE = 512;

function firstString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function firstNumber(value: { no: number | null } | Array<{ no: number | null }> | undefined): number | null {
  const item = Array.isArray(value) ? value[0] : value;
  return item?.no ?? null;
}

/** Downscale an embedded picture to a JPEG data URL. Returns null on any failure. */
async function artworkToDataUrl(data: Uint8Array, mime: string): Promise<string | null> {
  try {
    const arrayBuffer = data.slice().buffer;
    const blob = new Blob([arrayBuffer], { type: mime || 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);

    const scale = Math.min(1, ARTWORK_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return null;
  }
}

export interface ParseSource {
  blob: Blob;
  fileName: string;
  fileSize: number;
  source: Track['source'];
  url?: string;
  handle?: FileSystemFileHandle;
}

/**
 * Parse one audio file into a `Track`. Duration and codec come from the container; where a tag is
 * missing we fall back to the filename so the library is never blank.
 */
export async function parseAudioFile(input: ParseSource): Promise<Track> {
  const { blob, fileName, fileSize, source, url } = input;

  let title = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  let artist = 'Unknown Artist';
  let album = '';
  let trackNo: number | null = null;
  let discNo: number | null = null;
  let year: number | null = null;
  let genre = '';
  let durationSec = 0;
  let sampleRate: number | null = null;
  let bitRate: number | null = null;
  let codec = blob.type || 'audio';
  let artwork: string | null = null;

  try {
    const meta = await parseBlob(blob, { duration: true, skipCovers: false });
    const c = meta.common;
    const f = meta.format;

    if (c.title) title = c.title.trim();
    if (c.artist) artist = firstString(c.artist).trim() || artist;
    if (c.album) album = firstString(c.album).trim();
    trackNo = firstNumber(c.track);
    discNo = firstNumber(c.disk);
    if (c.year) year = c.year;
    genre = firstString(c.genre);
    if (f.duration && Number.isFinite(f.duration)) durationSec = f.duration;
    if (f.sampleRate) sampleRate = f.sampleRate;
    if (f.bitrate) bitRate = f.bitrate;
    if (f.codec) codec = f.codec;
    else if (f.container) codec = f.container;

    const picture = c.picture && c.picture.length > 0 ? c.picture[0] : undefined;
    if (picture && picture.data) {
      artwork = await artworkToDataUrl(picture.data, picture.format);
    }
  } catch {
    // Unparseable tags are not fatal — keep the filename-derived metadata and continue.
  }

  // If the container did not report a duration, ask the browser via a throwaway audio element.
  if (!durationSec || !Number.isFinite(durationSec)) {
    durationSec = await probeDuration(blob).catch(() => 0);
  }

  const id = trackKeyOf(title, artist);

  return {
    id,
    title,
    artist,
    album,
    trackNo,
    discNo,
    year,
    genre,
    durationSec,
    sampleRate,
    bitRate,
    codec,
    fileName,
    fileSize,
    artwork,
    source,
    url,
    addedAt: Date.now(),
    liked: false,
  };
}

/** Fallback duration probe using a detached <audio> element. */
function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const objectUrl = URL.createObjectURL(blob);
    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      audio.removeAttribute('src');
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const d = audio.duration;
      cleanup();
      resolve(Number.isFinite(d) ? d : 0);
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error('probe failed'));
    };
    audio.src = objectUrl;
  });
}
