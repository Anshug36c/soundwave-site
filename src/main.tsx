import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getSharedEngine, store } from './state/store';
import { remoteStore, getRemoteAudio } from './state/remote';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

/**
 * A small diagnostic handle, handy in the field and for the E2E smoke tests. It exposes the
 * shared audio engine's observable state and a read-only snapshot of the stores, without
 * letting callers mutate the queues directly (the stores' own actions remain the only
 * mutation path).
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
    /** Live local-library store reference — smoke tests read state and drive actions. */
    get store() {
      return store;
    },
    /** Remote Web Player store (the app provides, the browser plays). */
    get remote() {
      return remoteStore;
    },
    /** The <audio> element playing bridge audio in the Remote Web Player. */
    get remoteAudio() {
      const a = getRemoteAudio();
      return a
        ? { paused: a.paused, currentTime: a.currentTime, duration: a.duration, readyState: a.readyState, src: a.src }
        : null;
    },
    snapshot() {
      const s = store.getState();
      return {
        queueIndex: s.queueIndex,
        queueLength: s.queue.length,
        currentQueueId: s.queue[s.queueIndex] ?? null,
        playing: s.playing,
        trackCount: s.tracks.length,
        settings: { repeat: s.settings.repeat, shuffle: s.settings.shuffle },
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
