/**
 * Album / Artist / Playlist page — mirrors the app's detail screens:
 * header (artwork, title, subtitle, description), Play all, the song
 * list, then further shelves (other versions, related, artist sections).
 * Data comes from the connected phone; songs play here.
 */
import { RemoteSectionView } from '../components/RemoteSection';
import { RemoteTrackRow } from '../components/RemoteTrackRow';
import { remoteStore } from '../state/remote';
import { IconBack, IconPlay } from '../ui/icons';
import type { RemoteItem } from '../lib/remoteClient';

export function DetailScreen() {
  const stack = remoteStore((s) => s.detailStack);
  const closeDetail = remoteStore((s) => s.closeDetail);
  const playListAt = remoteStore((s) => s.playListAt);
  const enqueue = remoteStore((s) => s.enqueue);
  const openDetail = remoteStore((s) => s.openDetail);
  const openMood = remoteStore((s) => s.openMood);
  const detailLoading = remoteStore((s) => s.detailLoading);
  const queue = remoteStore((s) => s.queue);
  const index = remoteStore((s) => s.index);

  const detail = stack[stack.length - 1];
  if (!detail) return null;
  const currentId = index >= 0 && index < queue.length ? queue[index].id : null;

  const onItem = (item: RemoteItem) => {
    if (item.type === 'mood') void openMood(item);
    else if (item.type === 'album' || item.type === 'artist' || item.type === 'playlist') {
      void openDetail(item.type, item.id);
    }
  };

  return (
    <div className="page-overlay" data-testid="detail">
      <div className="overlay-head">
        <button className="btn icon ghost" onClick={closeDetail} aria-label="Back">
          <IconBack size={22} />
        </button>
        <div className="overlay-title">{detail.title}</div>
        {detailLoading && <span className="muted" style={{ fontSize: 13 }}>Loading…</span>}
      </div>

      <div className="detail-head">
        {detail.thumbnailUrl ? (
          <img
            className={`detail-art${detail.kind === 'artist' ? ' round-art' : ''}`}
            src={detail.thumbnailUrl}
            alt=""
          />
        ) : (
          <div className="art-fallback detail-art">{(detail.title || '?').trim().charAt(0).toUpperCase()}</div>
        )}
        <h2>{detail.title}</h2>
        {detail.subtitle && <div className="detail-sub">{detail.subtitle}</div>}
        {detail.description && <p className="detail-desc">{detail.description}</p>}
        {detail.songs.length > 0 && (
          <button className="btn primary" onClick={() => void playListAt(detail.songs, 0)} data-testid="detail-play-all">
            <IconPlay size={18} /> Play all · {detail.songs.length}
          </button>
        )}
      </div>

      {detail.songs.length > 0 && detail.kind !== 'artist' && (
        <div className="track-list">
          {detail.songs.map((t, i) => (
            <RemoteTrackRow
              key={`${t.id}-${i}`}
              track={t}
              current={currentId === t.id}
              onPlay={() => void playListAt(detail.songs, i)}
              onEnqueue={() => enqueue(t)}
              testId="detail-song"
            />
          ))}
        </div>
      )}

      {detail.sections.map((section) => (
        <RemoteSectionView
          key={section.title}
          section={section}
          currentId={currentId}
          onPlayTracks={(tracks, i) => void playListAt(tracks, i)}
          onItem={onItem}
        />
      ))}
    </div>
  );
}
