import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getSharedEngine, store } from './state/store';
import { listenTogether, getStreamPlayer } from './state/listenTogether';
import { phoneLink, getPhoneAudio } from './state/phoneLink';
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
    /** Live Listen Together session store (room/role/sync state + actions). */
    get listenTogether() {
      return listenTogether;
    },
    /** Received-audio (Listen Together audio bridge) observable state. */
    get streamState() {
      const s = listenTogether.getState();
      const p = getStreamPlayer();
      return {
        trackId: s.streamTrackId,
        size: s.streamSize,
        received: s.streamReceived,
        ready: s.streamReady,
        usingStream: s.usingStream,
        playing: p?.isPlaying ?? false,
        positionSec: p?.getPositionSec() ?? 0,
        durationSec: p?.durationSec ?? 0,
        contextState: p?.contextState ?? 'closed',
      };
    },
    /** Phone-LAN link session store (Mode A). */
    get phoneLink() {
      return phoneLink;
    },
    /** The <audio> element streaming the phone's audio (Mode A). */
    get phoneAudio() {
      const a = getPhoneAudio();
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

