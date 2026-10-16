/**
 * The persistent mini player above the bottom navigation: artwork, title/artist, a thin progress
 * line, and play/next controls. Tapping anywhere on it opens the full now-playing sheet.
 */
import { store } from '../state/store';
import { Artwork, formatTime } from '../ui/common';
import { IconNext, IconPause, IconPlay } from '../ui/icons';

export function PlayerBar({ onOpen }: { onOpen: () => void }) {
  const queue = store((s) => s.queue);
  const queueIndex = store((s) => s.queueIndex);
  const tracks = store((s) => s.tracks);
  const playing = store((s) => s.playing);
  const positionSec = store((s) => s.positionSec);
  const durationSec = store((s) => s.durationSec);
  const togglePlay = store((s) => s.togglePlay);
  const next = store((s) => s.next);

  const currentId = queue[queueIndex];
  const track = currentId ? tracks.find((t) => t.id === currentId) : undefined;

  if (!track) return null;

  const progress = durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;

  return (
    <div className="playerbar">
      <div className="playerbar-inner" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
        <div className="seekline">
          <div className="fill" style={{ width: `${progress}%` }} />
        </div>
        <Artwork track={track} size={44} />
        <div className="pb-main">
          <div className="pb-title">{track.title}</div>
          <div className="pb-sub">
            {track.artist} · {formatTime(positionSec)} / {formatTime(durationSec)}
          </div>
        </div>
        <div className="pb-controls" onClick={(e) => e.stopPropagation()}>
          <button className="btn icon ghost" onClick={() => void togglePlay()} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <IconPause size={22} /> : <IconPlay size={22} />}
          </button>
          <button className="btn icon ghost" onClick={() => void next('manual')} aria-label="Next">
            <IconNext size={22} />
          </button>
        </div>
      </div>
    </div>
  );
}
