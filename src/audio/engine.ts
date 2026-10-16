/**
 * AudioEngine — the transport for Soundwave Web.
 *
 * It owns the `DspGraph` (two decks + EQ chain), drives crossfade between them using the same
 * pre-arm idea as the Android `StandbyCrossfadeScheduler`, and guards track completion with the
 * ported `PlaybackCutoffGuard`. The public surface is deliberately small and event-driven so the
 * Zustand store can mirror it into React state.
 *
 * Two decks are needed for crossfade: the outgoing deck fades down while the incoming deck fades
 * up, then they swap roles. With crossfade off, the active deck is simply reused.
 */

import { DspGraph, type DeckHandle } from './dspGraph';
import { AdaptivePreArmManager } from './adaptivePreArm';
import { PlaybackCutoffGuard, TIME_UNSET } from './playbackCutoffGuard';
import type { ParametricEQ } from '../lib/types';

export type EngineEvent =
  | { type: 'state'; playing: boolean }
  | { type: 'time'; positionSec: number; durationSec: number }
  | {
      type: 'ended';
      trackId: string;
      reason: 'auto' | 'manual';
      /** Outgoing track's playhead at the moment it was left, so history booking is race-free. */
      positionSec: number;
      durationSec: number;
    }
  | { type: 'autoAdvance' }
  | {
      type: 'trackChanged';
      trackId: string;
      /** Emitted when the engine swaps tracks on its own (automatic crossfade), so the store can
       *  sync its queue index without triggering another transition. */
      auto: boolean;
    }
  | { type: 'error'; trackId: string; message: string }
  | { type: 'crossfade'; active: boolean }
  | { type: 'buffering'; active: boolean };

export interface LoadTarget {
  trackId: string;
  /** A ready-to-play source: an object URL, a remote URL, or a File. */
  src: string;
  /** Canonical duration in seconds from tags, used by the cutoff guard. 0 if unknown. */
  durationSec: number;
}

export interface EngineOptions {
  crossfadeEnabled?: boolean;
  crossfadeSeconds?: number;
  limiterEnabled?: boolean;
  volume?: number;
}

/** How long a deck keeps ramping; kept short so volume feels immediate. */
const RAMP_SEC = 0.02;

export class AudioEngine {
  readonly graph: DspGraph;
  readonly preArm = new AdaptivePreArmManager();
  private readonly cutoffGuard = new PlaybackCutoffGuard();

  private decks: [DeckHandle, DeckHandle];
  private activeIndex = 0;

  private current: LoadTarget | null = null;
  private standby: LoadTarget | null = null;
  private standbyReady = false;

  /**
   * Set once `ended` has been emitted for the current track, so a natural end followed by an
   * auto-advance (which routes back through `playNow`) cannot book the same track twice. Cleared
   * whenever a new track becomes current.
   */
  private endedEmittedForCurrent = false;

  private crossfadeEnabled: boolean;
  private crossfadeSeconds: number;
  private crossfading = false;

  private rafId = 0;
  private lastTickSec = 0;
  private listeners = new Set<(e: EngineEvent) => void>();

  /** Object URLs we created and must revoke when a deck is repurposed. */
  private objectUrls = new Map<DeckHandle, string>();

  constructor(options: EngineOptions = {}) {
    this.graph = new DspGraph();
    this.decks = this.graph.decks;
    this.crossfadeEnabled = options.crossfadeEnabled ?? true;
    this.crossfadeSeconds = options.crossfadeSeconds ?? 6;
    this.graph.setLimiterEnabled(options.limiterEnabled ?? true);
    this.graph.setMasterVolume(options.volume ?? 0.9);

    this.decks.forEach((deck) => {
      deck.element.addEventListener('error', () => this.onDeckError(deck));
      deck.element.addEventListener('ended', () => this.onDeckEnded(deck));
    });
  }

  /* ------------------------------ public API ------------------------------ */

  on(listener: (e: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: EngineEvent): void {
    this.listeners.forEach((l) => l(e));
  }

  get activeDeck(): DeckHandle {
    return this.decks[this.activeIndex];
  }

  get currentTrackId(): string | null {
    return this.current?.trackId ?? null;
  }

  get isPlaying(): boolean {
    return !this.activeDeck.element.paused;
  }

  getPositionSec(): number {
    return this.activeDeck.element.currentTime || 0;
  }

  getDurationSec(): number {
    const el = this.activeDeck.element;
    return Number.isFinite(el.duration) && el.duration > 0 ? el.duration : (this.current?.durationSec ?? 0);
  }

  setVolume(linear: number): void {
    this.graph.setMasterVolume(linear);
  }

  setCrossfade(enabled: boolean, seconds: number): void {
    this.crossfadeEnabled = enabled;
    this.crossfadeSeconds = Math.max(0, seconds);
  }

  applyEq(eq: ParametricEQ, enabled: boolean): void {
    if (!enabled) {
      this.graph.applyEq({ preamp: 0, bands: [], metadata: {} });
      return;
    }
    this.graph.applyEq(eq);
  }

  /**
   * Load and optionally start a track on the active deck. Returns a promise that resolves once
   * the element reports it can play (or immediately if it cannot be awaited).
   *
   * `reason` describes why the *outgoing* track stopped, so its history is booked correctly:
   * 'manual' when the user moved on, 'auto' when the engine advanced on its own.
   */
  async playNow(target: LoadTarget, autoplay = true, reason: 'auto' | 'manual' = 'manual'): Promise<void> {
    this.cancelCrossfade();
    // Book the outgoing track before it is replaced — unless a natural end already booked it
    // (the `endedEmittedForCurrent` guard), which is the case on an auto-advance.
    if (this.current) this.emitEnded(reason);

    const deck = this.activeDeck;
    await this.loadInto(deck, target);
    this.current = target;
    this.endedEmittedForCurrent = false;
    this.standby = null;
    this.standbyReady = false;
    this.cutoffGuard.onTrackChanged(target.trackId);
    this.lastTickSec = 0;

    if (autoplay) {
      await this.graph.resume();
      await this.playDeck(deck);
      deck.gain.gain.setTargetAtTime(1, this.graph.context.currentTime, RAMP_SEC);
      this.startTicking();
      this.emit({ type: 'state', playing: true });
    } else {
      this.emit({ type: 'state', playing: false });
    }
  }

  /**
   * Emits the `ended` event for the current track at most once, capturing the playhead now so the
   * store can book listening history without re-reading the engine after it has moved on.
   */
  private emitEnded(reason: 'auto' | 'manual'): void {
    if (!this.current || this.endedEmittedForCurrent) return;
    const el = this.activeDeck.element;
    this.endedEmittedForCurrent = true;
    this.emit({
      type: 'ended',
      trackId: this.current.trackId,
      reason,
      positionSec: el.currentTime || 0,
      durationSec: this.getDurationSec(),
    });
  }

  /**
   * Replay the current track from the start (repeat-one). Resets the ended guard and the cutoff
   * guard's retry budget so the next natural end books again.
   */
  async replayCurrent(): Promise<void> {
    if (!this.current) return;
    const deck = this.activeDeck;
    deck.element.currentTime = 0;
    this.lastTickSec = 0;
    this.endedEmittedForCurrent = false;
    this.cutoffGuard.onTrackChanged(this.current.trackId);
    await this.graph.resume();
    await this.playDeck(deck);
    this.startTicking();
    this.emit({ type: 'time', positionSec: 0, durationSec: this.getDurationSec() });
    this.emit({ type: 'state', playing: true });
  }

  /** Prepare the next track on the standby deck without disturbing playback. */
  async prepareNext(target: LoadTarget): Promise<void> {
    if (!this.crossfadeEnabled) {
      this.standby = target;
      this.standbyReady = false;
      return;
    }
    if (this.standby?.trackId === target.trackId && this.standbyReady) return;

    const standbyDeck = this.decks[1 - this.activeIndex];
    const started = performance.now();
    try {
      await this.loadInto(standbyDeck, target, /*silent=*/ true);
      this.preArm.recordPreparationDuration(performance.now() - started);
      this.standby = target;
      this.standbyReady = true;
    } catch {
      this.standby = target;
      this.standbyReady = false;
    }
  }

  async play(): Promise<void> {
    await this.graph.resume();
    await this.playDeck(this.activeDeck);
    this.startTicking();
    this.emit({ type: 'state', playing: true });
  }

  async pause(): Promise<void> {
    this.activeDeck.element.pause();
    this.stopTicking();
    this.emit({ type: 'state', playing: false });
  }

  async toggle(): Promise<void> {
    if (this.isPlaying) await this.pause();
    else await this.play();
  }

  seek(sec: number): void {
    const el = this.activeDeck.element;
    const clamped = Math.min(Math.max(sec, 0), this.getDurationSec() || sec);
    el.currentTime = clamped;
    this.lastTickSec = clamped;
    // A seek invalidates any prepared crossfade because the remaining time changed.
    this.cancelCrossfade();
    this.emit({ type: 'time', positionSec: clamped, durationSec: this.getDurationSec() });
  }

  seekBy(deltaSec: number): void {
    this.seek(this.getPositionSec() + deltaSec);
  }

  /**
   * Advance to a specific next track. When a standby deck is already prepared for it and
   * crossfade is on, this performs a manual crossfade; otherwise it hard-switches.
   */
  async goToNext(next: LoadTarget | null, reason: 'auto' | 'manual'): Promise<void> {
    if (!next) {
      // End of queue: book the outgoing track, then stop.
      this.emitEnded(reason);
      await this.pause();
      this.activeDeck.element.currentTime = 0;
      return;
    }
    if (this.crossfadeEnabled && this.standbyReady && this.standby?.trackId === next.trackId) {
      await this.runCrossfade(reason);
    } else {
      await this.playNow(next, true, reason);
    }
  }

  release(): void {
    this.stopTicking();
    this.cancelCrossfade();
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls.clear();
    this.graph.dispose();
    this.listeners.clear();
  }

  /* ------------------------------ internals ------------------------------- */

  private async loadInto(deck: DeckHandle, target: LoadTarget, silent = false): Promise<void> {
    const el = deck.element;
    // Revoke any object URL previously handed to this deck.
    const prev = this.objectUrls.get(deck);
    if (prev) {
      URL.revokeObjectURL(prev);
      this.objectUrls.delete(deck);
    }
    if (target.src.startsWith('objecturl:')) {
      // Sentinel: the caller manages this URL's lifetime.
      el.src = target.src.slice('objecturl:'.length);
    } else {
      el.src = target.src;
    }
    if (silent) {
      el.volume = 0;
      deck.gain.gain.value = 0;
    }
    el.load();
    await this.waitForReady(el);
  }

  private waitForReady(el: HTMLAudioElement): Promise<void> {
    return new Promise((resolve, reject) => {
      if (el.readyState >= 3) {
        resolve();
        return;
      }
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`Failed to load ${el.currentSrc || el.src}`));
      };
      const cleanup = () => {
        el.removeEventListener('canplay', onReady);
        el.removeEventListener('error', onError);
      };
      el.addEventListener('canplay', onReady, { once: true });
      el.addEventListener('error', onError, { once: true });
    });
  }

  private async playDeck(deck: DeckHandle): Promise<void> {
    deck.element.volume = 1; // real volume lives on the master gain node
    try {
      await deck.element.play();
    } catch (err) {
      this.emit({
        type: 'error',
        trackId: this.current?.trackId ?? '',
        message: err instanceof Error ? err.message : 'Playback blocked',
      });
    }
  }

  private startTicking(): void {
    if (this.rafId) return;
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      const pos = this.getPositionSec();
      const dur = this.getDurationSec();
      if (Math.abs(pos - this.lastTickSec) >= 0.2 || dur > 0) {
        this.lastTickSec = pos;
        this.emit({ type: 'time', positionSec: pos, durationSec: dur });
      }
      this.maybeTriggerCrossfade(pos, dur);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopTicking(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /**
   * When the remaining time falls inside the crossfade window and a standby deck is prepared,
   * begin the fade. This is the browser analogue of the Android scheduler's position tick.
   */
  private maybeTriggerCrossfade(pos: number, dur: number): void {
    if (!this.crossfadeEnabled || this.crossfading || !this.standbyReady || !this.standby) return;
    if (dur <= 0) return;
    const remaining = dur - pos;
    if (remaining <= this.crossfadeSeconds && remaining > 0) {
      void this.runCrossfade('auto');
    }
  }

  private async runCrossfade(reason: 'auto' | 'manual'): Promise<void> {
    if (this.crossfading || !this.standby) return;
    const standby = this.standby;
    this.crossfading = true;
    this.emit({ type: 'crossfade', active: true });

    const outgoing = this.decks[this.activeIndex];
    const incomingIndex = 1 - this.activeIndex;
    const incoming = this.decks[incomingIndex];

    // Book the outgoing track's completion before it is faded away. The cutoff guard is not
    // consulted here: a crossfade is a deliberate transition, never a premature cutoff.
    this.emitEnded(reason);

    const now = this.graph.context.currentTime;
    const fade = Math.max(0.05, this.crossfadeSeconds);
    incoming.gain.gain.cancelScheduledValues(now);
    outgoing.gain.gain.cancelScheduledValues(now);
    incoming.gain.gain.setValueAtTime(0, now);
    incoming.gain.gain.linearRampToValueAtTime(1, now + fade);
    outgoing.gain.gain.setValueAtTime(outgoing.gain.gain.value, now);
    outgoing.gain.gain.linearRampToValueAtTime(0, now + fade);

    await this.graph.resume();
    await this.playDeck(incoming);

    // Swap roles.
    this.activeIndex = incomingIndex;
    this.current = standby;
    this.endedEmittedForCurrent = false;
    this.standby = null;
    this.standbyReady = false;
    this.cutoffGuard.onTrackChanged(standby.trackId);

    // Silence + reset the old deck after the fade so it can be reused.
    window.setTimeout(() => {
      outgoing.element.pause();
      outgoing.element.currentTime = 0;
      outgoing.gain.gain.setValueAtTime(0, this.graph.context.currentTime);
      const url = this.objectUrls.get(outgoing);
      if (url) {
        URL.revokeObjectURL(url);
        this.objectUrls.delete(outgoing);
      }
    }, fade * 1000 + 60);

    this.crossfading = false;
    this.emit({ type: 'crossfade', active: false });
    this.emit({ type: 'state', playing: true });
    // Tell the store which track is now active. For an automatic crossfade the store has not
    // moved its own index yet; for a manual one this is a no-op confirmation.
    this.emit({ type: 'trackChanged', trackId: standby.trackId, auto: reason === 'auto' });
  }

  private cancelCrossfade(): void {
    if (!this.crossfading) {
      // Nothing in flight; just drop a prepared standby.
      this.standbyReady = false;
      return;
    }
    const now = this.graph.context.currentTime;
    this.activeDeck.gain.gain.cancelScheduledValues(now);
    this.activeDeck.gain.gain.setTargetAtTime(1, now, RAMP_SEC);
    this.crossfading = false;
    this.emit({ type: 'crossfade', active: false });
  }

  private onDeckError(deck: DeckHandle): void {
    if (deck !== this.activeDeck) return;
    const el = deck.element;
    this.emit({
      type: 'error',
      trackId: this.current?.trackId ?? '',
      message: el.error ? `Media error (code ${el.error.code})` : 'Playback error',
    });
  }

  /**
   * Native `ended` handler for a deck. This is the path that fires when crossfade is off, on the
   * last track, or when no standby was prepared — the cases `runCrossfade` never covers.
   *
   * It routes the ending through the ported `PlaybackCutoffGuard`: a premature end (a truncated or
   * expired stream that reports `ended` well short of its canonical duration) is recovered by
   * seeking back and resuming, up to the guard's retry budget; a genuine end emits `ended` (to book
   * history) followed by `autoAdvance` (to move the queue on).
   */
  private onDeckEnded(deck: DeckHandle): void {
    if (deck !== this.activeDeck || this.crossfading || !this.current) return;

    const { premature, resumePositionMs } = this.evaluateEnded();
    if (premature) {
      const el = deck.element;
      el.currentTime = resumePositionMs / 1000;
      void this.playDeck(deck);
      this.startTicking();
      return;
    }

    // Genuine end. Book history, then ask the store to advance.
    this.emitEnded('auto');
    this.emit({ type: 'autoAdvance' });
  }

  /** Exposed for tests and the Settings "engine" panel. */
  get cutoffGuardInstance(): PlaybackCutoffGuard {
    return this.cutoffGuard;
  }

  /**
   * Evaluate the active deck's `ended` condition through the cutoff guard. Returns the position to
   * resume from when the guard decides the ending was premature, else null.
   */
  evaluateEnded(): { premature: boolean; resumePositionMs: number } {
    if (!this.current) return { premature: false, resumePositionMs: 0 };
    const el = this.activeDeck.element;
    const positionMs = (el.currentTime || 0) * 1000;
    const canonicalMs = (this.current.durationSec || 0) * 1000;
    const playerMs = Number.isFinite(el.duration) && el.duration > 0 ? el.duration * 1000 : TIME_UNSET;
    const decision = this.cutoffGuard.verifyTrackCompletion(positionMs, canonicalMs, playerMs);
    if (decision.kind === 'RecoverPrematureCutoff') {
      return { premature: true, resumePositionMs: decision.resumePositionMs };
    }
    return { premature: false, resumePositionMs: 0 };
  }
}
