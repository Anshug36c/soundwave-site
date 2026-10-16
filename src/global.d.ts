/** Ambient type for the diagnostic handle installed in main.tsx. */
export {};

declare global {
  interface Window {
    __soundwave?: {
      readonly version: string;
      readonly engine: import('./audio/engine').AudioEngine;
      readonly store: typeof import('./state/store').store;
      readonly listenTogether: typeof import('./state/listenTogether').listenTogether;
      /** Phone-LAN link store (Mode A: the app serves this site + its audio). */
      readonly phoneLink: typeof import('./state/phoneLink').phoneLink;
      /** The <audio> element streaming the phone's audio in Mode A. */
      readonly phoneAudio: {
        paused: boolean;
        currentTime: number;
        duration: number;
        readyState: number;
        src: string;
      } | null;
      /** Listen Together audio-bridge (Mode B) stream diagnostics. */
      readonly streamState: {
        trackId: string | null;
        size: number;
        received: number;
        ready: boolean;
        usingStream: boolean;
        playing: boolean;
        positionSec: number;
        durationSec: number;
        contextState: AudioContextState;
      };
      readonly audioState: {
        contextState: AudioContextState;
        trackId: string | null;
        playing: boolean;
        positionSec: number;
        durationSec: number;
        deckCount: number;
      };
      snapshot(): {
        queueIndex: number;
        queueLength: number;
        currentQueueId: string | null;
        playing: boolean;
        crossfading: boolean;
        trackCount: number;
        statsCount: number;
        stats: Record<string, import('./lib/types').PlayStats>;
        settings: { crossfadeEnabled: boolean; repeat: 'off' | 'all' | 'one' };
      };
    };
  }
}
