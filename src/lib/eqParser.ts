/**
 * EqualizerAPO / AutoEq profile parser — a faithful port of
 * `dsp-core/src/main/kotlin/echo/music/dsp/core/parser/ParametricEQParser.kt`.
 *
 * Behaviour is intentionally identical to the Kotlin original, including its quirks:
 *   - parsing is case-insensitive and line oriented,
 *   - a `Filter` line that does not contain `ON` is dropped entirely (the Android parser never
 *     materialises a disabled band from a file — `enabled = false` is a UI-only state),
 *   - the filter type is detected by substring match in the order LSC, HSC, PK, LPQ, HPQ,
 *   - `Fc` and `Gain` require their unit suffix, `Q` does not,
 *   - unrecognised `key: value` lines become metadata.
 *
 * That compatibility means the 8850 AutoEq headphone profiles Soundwave ships on Android can be
 * pasted or dropped straight into the web build.
 */

import { MAX_BANDS, type FilterType, type ParametricEQ, type ParametricEQBand } from './types';

/** Mirrors `parsePreamp`. */
function parsePreamp(line: string): number {
  const match = /Preamp:\s*([-+]?\d+\.?\d*)\s*dB/i.exec(line);
  return match ? Number(match[1]) : 0.0;
}

/** Mirrors `parseFilterType`. Order matters — same as the Kotlin `when` chain. */
function parseFilterType(line: string): FilterType | null {
  const upper = line.toUpperCase();
  if (upper.includes('LSC')) return 'LSC';
  if (upper.includes('HSC')) return 'HSC';
  if (upper.includes('PK')) return 'PK';
  if (upper.includes('LPQ')) return 'LPQ';
  if (upper.includes('HPQ')) return 'HPQ';
  return null;
}

/** Mirrors `parseValue(line, keyword, unit)`. The unit is preceded by `\s*` exactly as in Kotlin. */
function parseValue(line: string, keyword: string, unit: string | null): number | null {
  const unitPattern = unit != null ? `\\s*${unit}` : '';
  const regex = new RegExp(`${keyword}\\s+([-+]?\\d+\\.?\\d*)${unitPattern}`, 'i');
  const match = regex.exec(line);
  return match ? Number(match[1]) : null;
}

/** Mirrors `parseFilterLine`. Returns null for anything it cannot fully parse. */
function parseFilterLine(line: string): ParametricEQBand | null {
  if (!/on/i.test(line)) return null;

  const filterType = parseFilterType(line);
  if (filterType === null) return null;

  const frequency = parseValue(line, 'Fc', 'Hz');
  if (frequency === null) return null;

  const gain = parseValue(line, 'Gain', 'dB');
  if (gain === null) return null;

  const q = parseValue(line, 'Q', null);
  if (q === null) return null;

  return { filterType, frequency, gain, q, enabled: true };
}

/** Mirrors `parseText(content)`. */
export function parseText(content: string): ParametricEQ {
  const lines = content.split(/\r?\n/);
  let preamp = 0.0;
  const bands: ParametricEQBand[] = [];
  const metadata: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    if (/^Preamp:/i.test(line)) {
      preamp = parsePreamp(line);
    } else if (/^Filter/i.test(line)) {
      const band = parseFilterLine(line);
      if (band !== null) bands.push(band);
    } else {
      const idx = line.indexOf(':');
      if (idx > -1) {
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (key.length > 0) metadata[key] = value;
      }
    }
  }

  return { preamp, bands, metadata };
}

/** Mirrors `toString(eq)` — the human-readable dump. */
export function serializeReadable(eq: ParametricEQ): string {
  const out: string[] = [`Preamp: ${eq.preamp} dB`];
  eq.bands.forEach((band, index) => {
    out.push(
      `Filter ${index + 1}: ${band.filterType} Fc ${band.frequency} Hz Gain ${band.gain} dB Q ${band.q}`,
    );
  });
  return out.join('\n') + '\n';
}

/** Mirrors `toFileFormat(eq)` — EqualizerAPO-compatible output. */
export function toFileFormat(eq: ParametricEQ): string {
  const out: string[] = [`Preamp: ${eq.preamp} dB`];
  eq.bands.forEach((band, index) => {
    out.push(
      `Filter ${index + 1}: ON ${band.filterType} Fc ${Math.trunc(band.frequency)} Hz ` +
        `Gain ${band.gain} dB Q ${band.q.toFixed(2)}`,
    );
  });
  return out.join('\n') + '\n';
}

/** Mirrors `validate(eq)`; messages are kept close to the Android wording. */
export function validate(eq: ParametricEQ): string[] {
  const errors: string[] = [];

  if (eq.preamp < -50.0 || eq.preamp > 50.0) {
    errors.push(`Preamp value ${eq.preamp} dB is out of range (-50 to +50 dB)`);
  }
  if (eq.bands.length === 0) {
    errors.push('EQ profile must have at least one band');
  }
  if (eq.bands.length > MAX_BANDS) {
    errors.push(`EQ profile has ${eq.bands.length} bands, maximum is ${MAX_BANDS}`);
  }

  eq.bands.forEach((band, index) => {
    if (band.frequency <= 0.0 || band.frequency > 100000.0) {
      errors.push(
        `Band ${index + 1}: Frequency ${band.frequency} Hz is out of range (1 to 100000 Hz)`,
      );
    }
    if (band.gain < -30.0 || band.gain > 30.0) {
      errors.push(`Band ${index + 1}: Gain ${band.gain} dB is out of range (-30 to +30 dB)`);
    }
    if (band.q <= 0.0 || band.q > 20.0) {
      errors.push(`Band ${index + 1}: Q factor ${band.q} is out of range (0.01 to 20)`);
    }
  });

  return errors;
}

/**
 * Maps `FilterType` onto the Web Audio `BiquadFilterType` it corresponds to.
 * Soundwave's five APO types cover exactly these five Web Audio types.
 */
export function toBiquadType(filterType: FilterType): BiquadFilterType {
  switch (filterType) {
    case 'PK':
      return 'peaking';
    case 'LSC':
      return 'lowshelf';
    case 'HSC':
      return 'highshelf';
    case 'LPQ':
      return 'lowpass';
    case 'HPQ':
      return 'highpass';
  }
}
