/** Ambient type for the diagnostic handle installed in main.tsx. */
export {};

declare global {
  interface Window {
    __soundwave?: {
      readonly version: string;
      readonly engine: import('./audio/engine').AudioEngine;
      readonly store: typeof import('./state/store').store;
      readonly listenTogether: typeof import('./state/listenTogether').listenTogether;
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
