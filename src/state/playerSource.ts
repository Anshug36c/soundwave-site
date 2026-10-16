/**
 * Which player the visible mini/full player controls.
 *
 * The site has two independent players — the local library player
 * (`state/store.ts`) and the phone-backed Remote Web Player
 * (`state/remote.ts`). They keep separate queues and never drive each
 * other; this tiny store only records which one the user last started, so
 * the app-style player UI (mini player, full player, keyboard shortcuts,
 * lock-screen controls) always talks to the right one. Starting playback
 * on one side pauses the other side's audio (see App.tsx).
 */
import { create } from 'zustand';

export type PlayerSource = 'local' | 'remote';

interface PlayerSourceState {
  source: PlayerSource;
  setSource: (source: PlayerSource) => void;
}

export const playerSource = create<PlayerSourceState>((set) => ({
  source: 'local',
  setSource: (source) => set({ source }),
}));
