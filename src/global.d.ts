/** Ambient type for the diagnostic handle installed in main.tsx. */
export {};

declare global {
  interface Window {
    __soundwave?: {
      readonly version: string;
      readonly engine: import('./audio/engine').AudioEngine;
      readonly store: typeof import('./state/store').store;
      /** Remote Web Player store (the app provides, the browser plays). */
      readonly remote: typeof import('./state/remote').remoteStore;
      /** The <audio> element playing bridge audio in the Remote Web Player. */
      readonly remoteAudio: {
        paused: boolean;
        currentTime: number;
        duration: number;
        readyState: number;
        src: string;
      } | null;
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
        trackCount: number;
        settings: { repeat: 'off' | 'all' | 'one'; shuffle: boolean };
      };
    };
  }
}
