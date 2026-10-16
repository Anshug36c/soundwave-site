/**
 * Floating mini player — mirrors the app's FloatingMiniPlayer: a rounded
 * glass pill floating above the bottom navigation with artwork, title /
 * artist, a thin progress line, and play / next. Tapping it opens the
 * full player. Controls whichever player the user last started (see
 * state/playerFacade.ts); the two players' queues stay fully separate.
 */
import { nextActive, toggleActive, usePlayerView } from '../state/playerFacade';
import { store } from '../state/store';
import { IconNext, IconPause, IconPlay } from '../ui/icons';

export function MiniPlayer() {
  const view = usePlayerView();
  const setNowPlayingOpen = store((s) => s.setNowPlayingOpen);

  if (!view) return null;
  const progress = view.durationSec > 0 ? Math.min(100, (view.positionSec / view.durationSec) * 100) : 0;

  return (
    <div className="playerbar">
      <div
        className="playerbar-inner"
        onClick={() => setNowPlayingOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setNowPlayingOpen(true);
        }}
      >
        {view.artwork ? (
          <img className="pb-art" src={view.artwork} alt="" width={44} height={44} />
        ) : (
          <div className="pb-art pb-art-fallback">{(view.title || '?').trim().charAt(0).toUpperCase()}</div>
        )}
        <div className="pb-main">
          <div className="pb-title">{view.title}</div>
          <div className="pb-sub">
            {view.resolving ? 'Asking SoundWave for the audio…' : view.artist}
          </div>
        </div>
        <div className="pb-controls" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn icon ghost"
            onClick={toggleActive}
            aria-label={view.playing ? 'Pause' : 'Play'}
            data-testid="mini-toggle"
          >
            {view.playing ? <IconPause size={24} /> : <IconPlay size={24} />}
          </button>
          <button className="btn icon ghost" onClick={nextActive} aria-label="Next">
            <IconNext size={22} />
          </button>
        </div>
        <div className="seekline">
          <div className="fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
}
