/**
 * Plays audio received over the Listen Together audio bridge.
 *
 * When the host (the Soundwave app) publishes the current track's bytes, a guest that doesn't own
 * the file reassembles them and decodes them here, then plays them in lockstep with the host's
 * transport. It uses its own AudioContext so it never disturbs the local library engine (which is
 * paused while a stream is active).
 */
export class StreamPlayer {
  private ctx: AudioContext;
  private gain: GainNode;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private playing = false;
  private offsetSec = 0;
  private startedAt = 0;

  onEnded: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
  }

  get contextState(): AudioContextState {
    return this.ctx.state;
  }
  get isPlaying(): boolean {
    return this.playing;
  }
  get durationSec(): number {
    return this.buffer ? this.buffer.duration : 0;
  }
  get hasBuffer(): boolean {
    return this.buffer !== null;
  }

  getPositionSec(): number {
    if (this.playing) return this.offsetSec + (this.ctx.currentTime - this.startedAt);
    return this.offsetSec;
  }

  /** Decode reassembled bytes. Copies first: decodeAudioData detaches the ArrayBuffer. */
  async decode(bytes: Uint8Array): Promise<void> {
    const copy = bytes.slice();
    this.buffer = await this.ctx.decodeAudioData(copy.buffer as ArrayBuffer);
  }

  async play(offsetSec?: number): Promise<void> {
    if (!this.buffer) return;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.stopSource();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    const off = Math.min(Math.max(0, offsetSec ?? this.offsetSec), this.buffer.duration);
    src.onended = () => {
      if (this.source === src && this.playing) {
        this.playing = false;
        this.offsetSec = 0;
        this.onEnded?.();
      }
    };
    src.start(0, off);
    this.source = src;
    this.playing = true;
    this.offsetSec = off;
    this.startedAt = this.ctx.currentTime;
  }

  pause(): void {
    if (!this.playing) return;
    this.offsetSec = this.getPositionSec();
    this.stopSource();
    this.playing = false;
  }

  seek(sec: number): void {
    const was = this.playing;
    this.stopSource();
    this.playing = false;
    this.offsetSec = this.buffer ? Math.min(Math.max(0, sec), this.buffer.duration) : Math.max(0, sec);
    if (was) void this.play(this.offsetSec);
  }

  stop(): void {
    this.stopSource();
    this.playing = false;
    this.offsetSec = 0;
  }

  setVolume(v: number): void {
    this.gain.gain.value = Math.min(Math.max(0, v), 1);
  }

  private stopSource(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
  }
}
