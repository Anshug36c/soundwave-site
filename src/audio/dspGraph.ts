/**
 * The Web Audio graph behind Soundwave Web.
 *
 * Layout (two decks so crossfade is possible):
 *
 *   deckA ─┬─ deckGainA ─┐
 *   deckB ─┴─ deckGainB ─┴─► preamp ─► band0 ─► … ─► bandN ─► [limiter] ─► master ─► analyser ─► out
 *
 * `preamp` and the per-band nodes come straight from Soundwave's `ParametricEQ` model, and each
 * `FilterType` maps onto the equivalent `BiquadFilterType` (see `toBiquadType`). That is a genuine
 * port rather than a resemblance: the Android `dsp-core` module is itself a biquad EQ, so the same
 * EqualizerAPO profile produces the same curve in both builds.
 */

import { MAX_BANDS, type FilterType, type ParametricEQ, type ParametricEQBand } from '../lib/types';

/** EqualizerAPO/AutoEq filter type -> Web Audio BiquadFilterType. */
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

/** dB → linear amplitude. */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export interface DeckHandle {
  element: HTMLAudioElement;
  gain: GainNode;
  source: MediaElementAudioSourceNode;
}

export interface DspGraphOptions {
  /** Number of biquad nodes to allocate up front; capped at `MAX_BANDS`. */
  maxBands?: number;
}

/**
 * Owns one AudioContext plus the whole processing chain.
 *
 * Nodes are allocated once and reused: rebuilding the chain on every EQ edit would drop audio,
 * so bands beyond the profile's length are bypassed (`enabled = false` semantics) by setting
 * their gain to 0 dB and type to `allpass`.
 */
export class DspGraph {
  readonly context: AudioContext;
  readonly decks: [DeckHandle, DeckHandle];
  readonly analyser: AnalyserNode;

  private readonly preamp: GainNode;
  private readonly master: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly bypass: GainNode;
  private readonly bandNodes: BiquadFilterNode[];
  private limiterEnabled = true;

  constructor(options: DspGraphOptions = {}) {
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context = new Ctor({ latencyHint: 'interactive' });

    const bandCount = Math.min(Math.max(options.maxBands ?? MAX_BANDS, 1), MAX_BANDS);

    this.preamp = this.context.createGain();
    this.master = this.context.createGain();
    this.bypass = this.context.createGain();

    // Acts purely as a clip guard: unity until the signal approaches 0 dBFS.
    this.limiter = this.context.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;

    this.bandNodes = Array.from({ length: bandCount }, () => {
      const node = this.context.createBiquadFilter();
      node.type = 'allpass';
      node.gain.value = 0;
      node.Q.value = 1.41;
      return node;
    });

    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    // deck → preamp
    this.decks = [0, 1].map((i) => {
      const element = new Audio();
      element.crossOrigin = 'anonymous';
      element.preload = 'auto';
      const gain = this.context.createGain();
      gain.gain.value = i === 0 ? 1 : 0;
      const source = this.context.createMediaElementSource(element);
      source.connect(gain);
      gain.connect(this.preamp);
      return { element, gain, source };
    }) as [DeckHandle, DeckHandle];

    // preamp → bands → (limiter | bypass) → master → analyser → destination
    let head: AudioNode = this.preamp;
    for (const node of this.bandNodes) {
      head.connect(node);
      head = node;
    }
    head.connect(this.limiter);
    head.connect(this.bypass);
    this.limiter.connect(this.master);
    this.bypass.disconnect();
    this.master.connect(this.analyser);
    this.analyser.connect(this.context.destination);

    this.rewireLimiter();
  }

  private rewireLimiter(): void {
    // Both paths stay connected; the unused one is set to silence. Swapping connections live can
    // produce a click, so gains do the switching.
    if (this.limiterEnabled) {
      this.limiter.threshold.value = -6;
      this.bypass.gain.value = 0;
    } else {
      // Drive the limiter out of the way by disabling its gain path.
      this.bypass.gain.value = 1;
      this.limiter.threshold.value = 0;
      this.limiter.ratio.value = 1;
    }
    if (this.limiterEnabled) {
      this.limiter.ratio.value = 12;
    }
  }

  /** Whether the clip guard is in circuit. Exposed in Settings because it alters the sound. */
  isLimiterEnabled(): boolean {
    return this.limiterEnabled;
  }

  setLimiterEnabled(enabled: boolean): void {
    this.limiterEnabled = enabled;
    this.rewireLimiter();
  }

  async resume(): Promise<void> {
    if (this.context.state !== 'running') {
      try {
        await this.context.resume();
      } catch {
        /* Autoplay policy: the next user gesture will retry. */
      }
    }
  }

  suspend(): void {
    void this.context.suspend().catch(() => undefined);
  }

  setMasterVolume(linear0to1: number): void {
    const clamped = Math.min(Math.max(linear0to1, 0), 1);
    this.master.gain.setTargetAtTime(clamped, this.context.currentTime, 0.01);
  }

  /** Applies a full `ParametricEQ`, including its preamp. */
  applyEq(eq: ParametricEQ): void {
    const now = this.context.currentTime;
    this.preamp.gain.setTargetAtTime(dbToLinear(eq.preamp), now, 0.01);

    const active = eq.bands.filter((b) => b.enabled).slice(0, this.bandNodes.length);
    this.bandNodes.forEach((node, index) => {
      const band = active[index];
      if (!band) {
        node.type = 'allpass';
        node.gain.setTargetAtTime(0, now, 0.01);
        return;
      }
      applyBand(node, band, now);
    });
  }

  /** Sets a single band live — used while dragging a slider so edits stay smooth. */
  setBand(index: number, band: ParametricEQBand): void {
    const node = this.bandNodes[index];
    if (!node) return;
    if (!band.enabled) {
      node.type = 'allpass';
      node.gain.setTargetAtTime(0, this.context.currentTime, 0.01);
      return;
    }
    applyBand(node, band, this.context.currentTime);
  }

  setPreamp(db: number): void {
    this.preamp.gain.setTargetAtTime(dbToLinear(db), this.context.currentTime, 0.01);
  }

  bandCapacity(): number {
    return this.bandNodes.length;
  }

  /** Frequency-domain snapshot for the visualiser. */
  readFrequencyData(target: Uint8Array): void {
    this.analyser.getByteFrequencyData(target as Uint8Array<ArrayBuffer>);
  }

  /** Time-domain snapshot for the waveform view. */
  readTimeDomainData(target: Uint8Array): void {
    this.analyser.getByteTimeDomainData(target as Uint8Array<ArrayBuffer>);
  }

  /** Frequency (Hz) represented by one bin of the analyser. */
  binFrequency(bin: number): number {
    return (bin * this.context.sampleRate) / this.analyser.fftSize;
  }

  dispose(): void {
    this.decks.forEach((d) => {
      d.element.pause();
      d.element.removeAttribute('src');
    });
    void this.context.close().catch(() => undefined);
  }
}

function applyBand(node: BiquadFilterNode, band: ParametricEQBand, now: number): void {
  const type = toBiquadType(band.filterType);
  if (node.type !== type) node.type = type;

  // Shelf and pass filters ignore Q in Web Audio for LSC/HSC; setting it is harmless and keeps
  // parity with the parsed profile.
  node.frequency.setTargetAtTime(clampFrequency(band.frequency, node), now, 0.01);
  node.Q.setTargetAtTime(Math.min(Math.max(band.q, 0.0001), 1000), now, 0.01);
  // Only peaking/shelf types have a gain parameter that does anything.
  node.gain.setTargetAtTime(band.gain, now, 0.01);
}

/** Web Audio throws if frequency is outside (0, sampleRate/2]. */
function clampFrequency(frequency: number, node: BiquadFilterNode): number {
  const nyquist = node.context.sampleRate / 2;
  const max = Math.max(nyquist * 0.999, 1);
  return Math.min(Math.max(frequency, 1), max);
}
