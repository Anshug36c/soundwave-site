/**
 * Full-screen player — mirrors the SoundWave app's player: the artwork
 * itself becomes the backdrop (heavily blurred, darkened into a palette
 * gradient to black), large rounded artwork, title/artist, seek slider
 * with times, shuffle / previous / play / next / repeat transport, and
 * the up-next queue below. Controls whichever player the user last
 * started (local library or the phone-backed remote player).
 */
import { useEffect, useState } from 'react';
import { accentFor } from '../lib/accent';
import {
  cycleRepeatActive,
  nextActive,
  playQueueAtActive,
  prevActive,
  removeQueueAtActive,
  seekActive,
  toggleActive,
  toggleLikeActive,
  toggleShuffleActive,
  usePlayerView,
} from '../state/playerFacade';
import { store } from '../state/store';
import { formatTime } from '../ui/common';
import {
  IconChevronDown,
  IconHeart,
  IconNext,
  IconPause,
  IconPlay,
  IconPrev,
  IconQueue,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
  IconTrash,
} from '../ui/icons';

export function FullPlayer() {
  const view = usePlayerView();
  const setNowPlayingOpen = store((s) => s.setNowPlayingOpen);
  const [accent, setAccent] = useState('#7c5cff');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNowPlayingOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setNowPlayingOpen]);

  useEffect(() => {
    setAccent(accentFor(view?.artwork, setAccent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.artwork]);

  if (!view) return null;

  const progress = view.durationSec > 0 ? Math.min(100, (view.positionSec / view.durationSec) * 100) : 0;
  const RepeatIcon = view.repeat === 'one' ? IconRepeatOne : IconRepeat;
  const close = () => setNowPlayingOpen(false);

  return (
    <div className="sheet-backdrop" onClick={close}>
      <div
        className="sheet np-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Now playing"
        style={{ ['--np-accent' as string]: accent }}
      >
        {/* Mirror backdrop: the cover, blurred and darkened like the app. */}
        {view.artwork && (
          <img className="np-mirror" src={view.artwork} alt="" aria-hidden="true" />
        )}
        <div className="np-shade" aria-hidden="true" />

        <div className="np-content">
          <div className="sheet-grabber" />
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <button className="btn icon ghost" onClick={close} aria-label="Close player">
              <IconChevronDown size={22} />
            </button>
            <div className="np-source">
              {view.source === 'remote' ? 'Playing from SoundWave' : 'Playing from your library'}
            </div>
            {view.liked !== null ? (
              <button
                className="btn icon ghost"
                onClick={toggleLikeActive}
                aria-label={view.liked ? 'Remove like' : 'Like'}
                style={{ color: view.liked ? 'var(--np-accent)' : undefined }}
              >
                <IconHeart size={21} filled={view.liked} />
              </button>
            ) : (
              <span style={{ width: 40 }} />
            )}
          </div>

          {view.artwork ? (
            <img className="np-art" src={view.artwork} alt="" />
          ) : (
            <div className="np-art np-art-fallback">{(view.title || '?').trim().charAt(0).toUpperCase()}</div>
          )}

          <h2 className="np-title">{view.title}</h2>
          <div className="np-artist">{view.artist}</div>
          {view.album && <div className="np-album">{view.album}</div>}
          {view.resolving && <div className="np-status">Asking SoundWave for the audio…</div>}

          <div className="seek">
            <input
              className="np-range"
              type="range"
              min={0}
              max={Math.max(1, Math.floor(view.durationSec))}
              value={Math.floor(view.positionSec)}
              onChange={(e) => seekActive(Number(e.target.value))}
              aria-label="Seek"
              style={{ ['--fill' as string]: `${progress}%` }}
            />
            <div className="seek-times">
              <span>{formatTime(view.positionSec)}</span>
              <span>{formatTime(view.durationSec)}</span>
            </div>
          </div>

          <div className="transport">
            <button
              className={`tbtn${view.shuffle ? ' on' : ''}`}
              onClick={toggleShuffleActive}
              aria-label="Shuffle"
              aria-pressed={view.shuffle}
            >
              <IconShuffle size={22} />
            </button>
            <button className="tbtn" onClick={prevActive} aria-label="Previous">
              <IconPrev size={30} />
            </button>
            <button
              className="tbtn play"
              onClick={toggleActive}
              aria-label={view.playing ? 'Pause' : 'Play'}
              data-testid="player-toggle"
            >
              {view.playing ? <IconPause size={32} /> : <IconPlay size={32} />}
            </button>
            <button className="tbtn" onClick={nextActive} aria-label="Next">
              <IconNext size={30} />
            </button>
            <button
              className={`tbtn${view.repeat !== 'off' ? ' on' : ''}`}
              onClick={cycleRepeatActive}
              aria-label={`Repeat: ${view.repeat}`}
            >
              <RepeatIcon size={22} />
            </button>
          </div>

          {view.formatWarning && (
            <div className="hint" role="alert" style={{ marginTop: 4, color: '#ffb4d0' }}>
              {view.formatWarning}
            </div>
          )}

          {view.queue.length > 1 && (
            <div className="queue-section">
              <div className="queue-head">
                <h4>
                  <IconQueue size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
                  Queue · {view.queue.length}
                </h4>
              </div>
              <div className="track-list">
                {view.queue.map((t, i) => (
                  <div
                    key={t.key}
                    className={`track-row${i === view.queueIndex ? ' active' : ''}`}
                    onClick={() => playQueueAtActive(i)}
                  >
                    {t.artwork ? (
                      <img className="track-art" src={t.artwork} alt="" width={38} height={38} />
                    ) : (
                      <div className="art-fallback" style={{ width: 38, height: 38, fontSize: 16 }}>
                        {(t.title || '?').trim().charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="track-main">
                      <div className="t-title">{t.title}</div>
                      <div className="t-sub">{t.artist}</div>
                    </div>
                    <div className="track-dur">{formatTime(t.durationSec)}</div>
                    {view.source === 'remote' && (
                      <button
                        className="btn icon ghost"
                        aria-label="Remove from queue"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeQueueAtActive(i);
                        }}
                      >
                        <IconTrash size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
