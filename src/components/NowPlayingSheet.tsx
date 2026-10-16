/**
 * Full-screen now-playing sheet: large artwork with the live visualiser overlaid, scrub bar,
 * transport (shuffle / prev / play / next / repeat), volume, and the up-next queue.
 */
import { useEffect, useRef } from 'react';
import { store } from '../state/store';
import { Artwork, formatTime } from '../ui/common';
import { Visualizer } from './Visualizer';
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
  IconVolume,
} from '../ui/icons';

export function NowPlayingSheet({ onClose }: { onClose: () => void }) {
  const queue = store((s) => s.queue);
  const queueIndex = store((s) => s.queueIndex);
  const tracks = store((s) => s.tracks);
  const playing = store((s) => s.playing);
  const positionSec = store((s) => s.positionSec);
  const durationSec = store((s) => s.durationSec);
  const settings = store((s) => s.settings);
  const togglePlay = store((s) => s.togglePlay);
  const next = store((s) => s.next);
  const previous = store((s) => s.previous);
  const seek = store((s) => s.seek);
  const setVolume = store((s) => s.setVolume);
  const toggleShuffle = store((s) => s.toggleShuffle);
  const cycleRepeat = store((s) => s.cycleRepeat);
  const toggleLike = store((s) => s.toggleLike);
  const playQueue = store((s) => s.playQueue);

  const currentId = queue[queueIndex];
  const track = currentId ? tracks.find((t) => t.id === currentId) : undefined;

  const seekRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const seekFromEvent = (clientX: number) => {
    const el = seekRef.current;
    if (!el || durationSec <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    seek(ratio * durationSec);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (dragging.current) seekFromEvent(e.clientX);
    };
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationSec]);

  if (!track) return null;

  const progress = durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;
  const upNext = queue
    .slice(queueIndex + 1)
    .map((id) => tracks.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t))
    .slice(0, 30);

  const RepeatIcon = settings.repeat === 'one' ? IconRepeatOne : IconRepeat;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Now playing">
        <div className="sheet-grabber" />
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close player">
            <IconChevronDown size={22} />
          </button>
          <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            Now Playing
          </div>
          <button
            className="btn icon ghost"
            onClick={() => void toggleLike(track.id)}
            aria-label={track.liked ? 'Remove like' : 'Like'}
            style={{ color: track.liked ? 'var(--accent-violet)' : undefined }}
          >
            <IconHeart size={21} filled={track.liked} />
          </button>
        </div>

        <div className="np-art-wrap">
          <Artwork track={track} size={340} className="np-art" />
          <Visualizer style={settings.visualizerStyle} playing={playing} className="np-visualizer" />
        </div>

        <h2 className="np-title">{track.title}</h2>
        <div className="np-artist">{track.artist}</div>
        {track.album && <div className="np-album">{track.album}</div>}

        <div className="seek">
          <div
            className="seek-track"
            ref={seekRef}
            onPointerDown={(e) => {
              dragging.current = true;
              seekFromEvent(e.clientX);
            }}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(durationSec)}
            aria-valuenow={Math.round(positionSec)}
            tabIndex={0}
          >
            <div className="seek-fill" style={{ width: `${progress}%` }} />
            <div className="seek-thumb" style={{ left: `${progress}%` }} />
          </div>
          <div className="seek-times">
            <span>{formatTime(positionSec)}</span>
            <span>-{formatTime(Math.max(0, durationSec - positionSec))}</span>
          </div>
        </div>

        <div className="transport">
          <button
            className={`tbtn${settings.shuffle ? ' on' : ''}`}
            onClick={() => toggleShuffle()}
            aria-label="Shuffle"
            aria-pressed={settings.shuffle}
          >
            <IconShuffle size={22} />
          </button>
          <button className="tbtn" onClick={() => void previous()} aria-label="Previous">
            <IconPrev size={30} />
          </button>
          <button className="tbtn play" onClick={() => void togglePlay()} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <IconPause size={32} /> : <IconPlay size={32} />}
          </button>
          <button className="tbtn" onClick={() => void next('manual')} aria-label="Next">
            <IconNext size={30} />
          </button>
          <button
            className={`tbtn${settings.repeat !== 'off' ? ' on' : ''}`}
            onClick={() => cycleRepeat()}
            aria-label={`Repeat: ${settings.repeat}`}
          >
            <RepeatIcon size={22} />
          </button>
        </div>

        <div className="np-secondary">
          <div className="vol">
            <IconVolume size={19} />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume"
            />
          </div>
          <div className="muted" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(settings.volume * 100)}%
          </div>
        </div>

        {upNext.length > 0 && (
          <div className="queue-section">
            <div className="queue-head">
              <h4>
                <IconQueue size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
                Up next · {upNext.length}
              </h4>
            </div>
            <div className="track-list">
              {upNext.map((t) => {
                const absoluteIndex = queue.indexOf(t.id);
                return (
                  <div key={t.id} className="track-row" onClick={() => void playQueue(queue, absoluteIndex)}>
                    <Artwork track={t} size={38} />
                    <div className="track-main">
                      <div className="t-title">{t.title}</div>
                      <div className="t-sub">{t.artist}</div>
                    </div>
                    <div className="track-dur">{formatTime(t.durationSec)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
