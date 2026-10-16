/**
 * Built-in EQ presets, expressed in the same `ParametricEQBand` shape Soundwave uses on Android
 * (`echo.music.dsp.core.models.ParametricEQBand`).
 *
 * These are browser-authored curves — they are **not** copied from the Android app, which sources
 * its library from AutoEq device profiles. They are deliberately modest (within the ±30 dB / Q 20
 * limits `ParametricEQParser.validate` enforces) and use only the five filter types the parser
 * understands, so a preset round-trips through `toFileFormat` without loss.
 */

import type { ParametricEQBand } from './types';

const band = (
  frequency: number,
  gain: number,
  q: number,
  filterType: ParametricEQBand['filterType'] = 'PK',
): ParametricEQBand => ({ frequency, gain, q, filterType, enabled: true });

export interface EqPreset {
  id: string;
  name: string;
  description: string;
  preamp: number;
  bands: ParametricEQBand[];
}

export const EQ_PRESETS: EqPreset[] = [
  {
    id: 'flat',
    name: 'Flat',
    description: 'No correction. Reference starting point.',
    preamp: 0,
    bands: [band(1000, 0, 1.41)],
  },
  {
    id: 'bass-boost',
    name: 'Bass Boost',
    description: 'Low shelf lift with a mild cut around 300 Hz to keep mud out.',
    preamp: -3.5,
    bands: [
      band(60, 7.5, 0.7, 'LSC'),
      band(140, 3.0, 1.1),
      band(300, -2.0, 1.4),
    ],
  },
  {
    id: 'treble-lift',
    name: 'Treble Lift',
    description: 'Air and detail for dull recordings or cheap earbuds.',
    preamp: -3.0,
    bands: [
      band(4000, 3.5, 1.0),
      band(9000, 5.0, 0.8),
      band(14000, 4.0, 0.7, 'HSC'),
    ],
  },
  {
    id: 'vocal',
    name: 'Vocal Focus',
    description: 'Presence bump for speech, podcasts and acoustic vocals.',
    preamp: -3.0,
    bands: [
      band(120, -3.0, 1.0),
      band(1200, 2.0, 1.2),
      band(2800, 4.5, 1.5),
      band(6000, 2.0, 1.0),
    ],
  },
  {
    id: 'loudness',
    name: 'Loudness',
    description: 'Classic low-volume compensation: both ends lifted, mids recessed.',
    preamp: -5.0,
    bands: [
      band(50, 6.0, 0.8, 'LSC'),
      band(250, 2.0, 1.0),
      band(1000, -2.5, 1.0),
      band(8000, 4.0, 0.9),
      band(15000, 5.0, 0.7, 'HSC'),
    ],
  },
  {
    id: 'rock',
    name: 'Rock',
    description: 'Scooped mids, punchy low end and bite on the guitars.',
    preamp: -4.0,
    bands: [
      band(80, 4.5, 0.9, 'LSC'),
      band(400, -2.0, 1.2),
      band(2500, 2.5, 1.4),
      band(6000, 3.5, 1.1),
    ],
  },
  {
    id: 'electronic',
    name: 'Electronic',
    description: 'Sub-bass emphasis with a controlled top end.',
    preamp: -5.5,
    bands: [
      band(40, 7.0, 0.7, 'LSC'),
      band(120, 3.0, 1.2),
      band(900, -2.0, 1.0),
      band(10000, 3.0, 0.9, 'HSC'),
    ],
  },
  {
    id: 'acoustic',
    name: 'Acoustic',
    description: 'Gentle warmth and string clarity, no harsh peaks.',
    preamp: -2.5,
    bands: [
      band(160, 2.0, 1.1),
      band(800, -1.5, 1.0),
      band(3500, 2.5, 1.3),
      band(11000, 2.0, 0.8, 'HSC'),
    ],
  },
  {
    id: 'night',
    name: 'Night Mode',
    description: 'Compresses the extremes so quiet passages stay audible at low volume.',
    preamp: -2.0,
    bands: [
      band(80, -4.0, 0.9, 'LSC'),
      band(500, 1.5, 1.0),
      band(2000, 2.0, 1.2),
      band(12000, -4.0, 0.8, 'HSC'),
    ],
  },
];

export function getPreset(id: string): EqPreset | undefined {
  return EQ_PRESETS.find((p) => p.id === id);
}
