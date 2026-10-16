/**
 * Generates small WAV fixtures for the E2E smoke tests, in pure Node (no Python, no native deps),
 * so CI can reproduce the browser tests deterministically.
 *
 * Usage: node scripts/make-fixtures.mjs [outDir] [seconds]
 * Defaults: outDir=.fixtures/audio, seconds=6
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] || '.fixtures/audio';
const seconds = Number(process.argv[3] || 6);
const sr = 44100;
const freqs = [440, 523, 659]; // A4, C5, E5 — distinct so parsed titles differ

function writeWav(file, freq, secs) {
  const n = Math.floor(sr * secs);
  const dataBytes = n * 2; // 16-bit mono
  const buf = Buffer.alloc(44 + dataBytes);

  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  // fmt chunk
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  // data chunk
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 2000, (n - i) / 2000); // fade in/out to avoid clicks
    const v = Math.round(0.28 * 32767 * env * Math.sin((2 * Math.PI * freq * i) / sr));
    buf.writeInt16LE(v, 44 + i * 2);
  }
  writeFileSync(file, buf);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
freqs.forEach((f, i) => {
  const file = path.join(outDir, `track${i + 1}.wav`);
  writeWav(file, f, seconds);
  console.log(`wrote ${file} (${seconds}s @ ${f}Hz)`);
});
