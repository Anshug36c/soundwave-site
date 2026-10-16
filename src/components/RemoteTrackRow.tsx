/** One song row for phone-provided tracks (Home recommendations, Search). */
import { formatTime } from '../ui/common';
import { IconTrash } from '../ui/icons';
import type { RemoteTrack } from '../lib/remoteClient';

export function RemoteTrackRow(props: {
  track: RemoteTrack;
  current: boolean;
  onPlay: () => void;
  onEnqueue?: () => void;
  onRemove?: () => void;
  testId?: string;
}) {
  const { track } = props;
  return (
    <div
      className={`track-row${props.current ? ' active' : ''}`}
      onClick={props.onPlay}
      data-testid={props.testId ?? 'remote-track'}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') props.onPlay();
      }}
    >
      {track.thumbnailUrl ? (
        <img className="track-art" src={track.thumbnailUrl} alt="" width={46} height={46} />
      ) : (
        <div className="art-fallback" style={{ width: 46, height: 46, fontSize: 19 }}>
          {(track.title || '?').trim().charAt(0).toUpperCase()}
        </div>
      )}
      <div className="track-main">
        <div className="t-title">{track.title}</div>
        <div className="t-sub">
          {track.artist}
          {track.album ? ` · ${track.album}` : ''}
        </div>
      </div>
      {track.durationSec ? <div className="track-dur">{formatTime(track.durationSec)}</div> : null}
      {props.onEnqueue && (
        <button
          className="btn ghost sm"
          onClick={(e) => {
            e.stopPropagation();
            props.onEnqueue?.();
          }}
        >
          + Queue
        </button>
      )}
      {props.onRemove && (
        <button
          className="btn icon ghost"
          aria-label="Remove from queue"
          onClick={(e) => {
            e.stopPropagation();
            props.onRemove?.();
          }}
        >
          <IconTrash size={16} />
        </button>
      )}
    </div>
  );
}
