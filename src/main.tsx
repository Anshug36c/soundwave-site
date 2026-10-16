import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getSharedEngine, store } from './state/store';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

/**
 * A small diagnostic handle, handy in the field and for the E2E smoke test. It exposes the shared
 * audio engine's observable state and a read-only snapshot of the store, without letting callers
 * mutate the queue directly (the store's own actions remain the only mutation path).
 */
Object.defineProperty(window, '__soundwave', {
  value: {
    get version() {
      return '1.0.0';
    },
    get engine() {
      return getSharedEngine();
    },
    get audioState() {
      const e = getSharedEngine();
      return {
        contextState: e.graph.context.state,
        trackId: e.currentTrackId,
        playing: e.isPlaying,
        positionSec: e.getPositionSec(),
        durationSec: e.getDurationSec(),
        deckCount: e.graph.decks.length,
      };
    },
    /** Live store reference — the smoke test reads state and drives settings through actions. */
    get store() {
      return store;
    },
    snapshot() {
      const s = store.getState();
      return {
        queueIndex: s.queueIndex,
        queueLength: s.queue.length,
        currentQueueId: s.queue[s.queueIndex] ?? null,
        playing: s.playing,
        crossfading: s.crossfading,
        trackCount: s.tracks.length,
        statsCount: Object.keys(s.stats).length,
        stats: s.stats,
        settings: { crossfadeEnabled: s.settings.crossfadeEnabled, repeat: s.settings.repeat },
      };
    },
  },
  enumerable: false,
});

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

