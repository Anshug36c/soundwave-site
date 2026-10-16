/**
 * Verifies the EqualizerAPO parser port against `ParametricEQParser.kt`, including its quirks:
 * `ON`-less filter lines are dropped, filter type is matched in LSC/HSC/PK/LPQ/HPQ order, and
 * validation bounds match.
 */
import { describe, it, expect } from 'vitest';
import { parseText, toFileFormat, serializeReadable, validate, toBiquadType } from '../eqParser';
import { MAX_BANDS } from '../types';

const SAMPLE = `Preamp: -3.5 dB
Filter 1: ON PK Fc 100 Hz Gain 4.5 dB Q 1.10
Filter 2: ON LSC Fc 60 Hz Gain 6.0 dB Q 0.70
Filter 3: ON HSC Fc 9000 Hz Gain -2.5 dB Q 0.80`;

describe('parseText', () => {
  it('parses preamp and bands', () => {
    const eq = parseText(SAMPLE);
    expect(eq.preamp).toBe(-3.5);
    expect(eq.bands.length).toBe(3);
    expect(eq.bands[0]).toMatchObject({ filterType: 'PK', frequency: 100, gain: 4.5, q: 1.1, enabled: true });
    expect(eq.bands[1]).toMatchObject({ filterType: 'LSC', frequency: 60, gain: 6.0, q: 0.7 });
    expect(eq.bands[2]).toMatchObject({ filterType: 'HSC', frequency: 9000, gain: -2.5, q: 0.8 });
  });

  it('is case-insensitive', () => {
    const eq = parseText('preamp: 2 db\nfilter 1: on pk fc 1000 hz gain 3 db q 1.0');
    expect(eq.preamp).toBe(2);
    expect(eq.bands.length).toBe(1);
  });

  it('drops filter lines without ON', () => {
    const eq = parseText('Filter 1: PK Fc 100 Hz Gain 4 dB Q 1.0');
    expect(eq.bands.length).toBe(0);
  });

  it('drops filter lines it cannot fully parse', () => {
    const eq = parseText('Filter 1: ON PK Fc 100 Hz Q 1.0'); // missing Gain
    expect(eq.bands.length).toBe(0);
  });

  it('matches filter type in LSC/HSC/PK/LPQ/HPQ order', () => {
    // "LSC" contains no earlier token; a line with both LSC and PK text resolves to LSC first.
    const eq = parseText('Filter 1: ON LSC PK Fc 60 Hz Gain 3 dB Q 0.7');
    expect(eq.bands[0].filterType).toBe('LSC');
  });

  it('collects metadata from key: value lines', () => {
    const eq = parseText('Title: My Headphones\nDevice: HD600\n' + SAMPLE);
    expect(eq.metadata['Title']).toBe('My Headphones');
    expect(eq.metadata['Device']).toBe('HD600');
  });

  it('ignores blank lines', () => {
    const eq = parseText('\n\n' + SAMPLE + '\n\n');
    expect(eq.bands.length).toBe(3);
  });
});

describe('round-trip', () => {
  it('toFileFormat output re-parses to the same bands', () => {
    const eq = parseText(SAMPLE);
    const text = toFileFormat(eq);
    const again = parseText(text);
    expect(again.preamp).toBeCloseTo(eq.preamp, 5);
    expect(again.bands.length).toBe(eq.bands.length);
    again.bands.forEach((b, i) => {
      expect(b.filterType).toBe(eq.bands[i].filterType);
      expect(b.frequency).toBe(Math.trunc(eq.bands[i].frequency));
      expect(b.gain).toBeCloseTo(eq.bands[i].gain, 5);
      expect(b.q).toBeCloseTo(eq.bands[i].q, 2);
    });
  });

  it('serializeReadable includes preamp and every filter', () => {
    const text = serializeReadable(parseText(SAMPLE));
    expect(text).toContain('Preamp: -3.5 dB');
    expect(text).toContain('Filter 1:');
    expect(text).toContain('Filter 3:');
  });
});

describe('validate', () => {
  it('accepts a well-formed profile', () => {
    expect(validate(parseText(SAMPLE))).toEqual([]);
  });
  it('rejects an empty profile', () => {
    const errs = validate({ preamp: 0, bands: [], metadata: {} });
    expect(errs.some((e) => /at least one band/.test(e))).toBe(true);
  });
  it('rejects out-of-range preamp', () => {
    const errs = validate({ preamp: 60, bands: parseText(SAMPLE).bands, metadata: {} });
    expect(errs.some((e) => /Preamp/.test(e))).toBe(true);
  });
  it('rejects too many bands', () => {
    const band = { frequency: 100, gain: 0, q: 1, filterType: 'PK' as const, enabled: true };
    const errs = validate({ preamp: 0, bands: Array(MAX_BANDS + 1).fill(band), metadata: {} });
    expect(errs.some((e) => /maximum is/.test(e))).toBe(true);
  });
  it('rejects out-of-range gain', () => {
    const errs = validate({ preamp: 0, bands: [{ frequency: 100, gain: 40, q: 1, filterType: 'PK', enabled: true }], metadata: {} });
    expect(errs.some((e) => /Gain/.test(e))).toBe(true);
  });
  it('rejects out-of-range Q', () => {
    const errs = validate({ preamp: 0, bands: [{ frequency: 100, gain: 0, q: 25, filterType: 'PK', enabled: true }], metadata: {} });
    expect(errs.some((e) => /Q factor/.test(e))).toBe(true);
  });
});

describe('toBiquadType', () => {
  it('maps every APO filter type', () => {
    expect(toBiquadType('PK')).toBe('peaking');
    expect(toBiquadType('LSC')).toBe('lowshelf');
    expect(toBiquadType('HSC')).toBe('highshelf');
    expect(toBiquadType('LPQ')).toBe('lowpass');
    expect(toBiquadType('HPQ')).toBe('highpass');
  });
});
