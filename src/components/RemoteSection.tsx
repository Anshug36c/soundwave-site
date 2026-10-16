/**
 * One catalogue shelf from the phone (home feed, charts, explore, artist
 * pages) — mirrors the app: shelves of songs render as quick-pick rows,
 * albums/playlists/artists as horizontal cards, moods as colour tiles.
 */
import { itemToTrack, sectionTracks, type RemoteItem, type RemoteSection, type RemoteTrack } from '../lib/remoteClient';
import { formatTime } from '../ui/common';

interface Props {
  section: RemoteSection;
  currentId: string | null;
  onPlayTracks: (tracks: RemoteTrack[], index: number) => void;
  onItem: (item: RemoteItem) => void;
  testId?: string;
}

export function RemoteSectionView({ section, currentId, onPlayTracks, onItem, testId }: Props) {
  const items = section.items;
  if (items.length === 0) return null;
  const tracks = sectionTracks(section);
  const allSongs = tracks.length === items.length;

  const playItem = (item: RemoteItem) => {
    const idx = tracks.findIndex((t) => t.id === item.id);
    if (idx >= 0) onPlayTracks(tracks, idx);
  };

  return (
    <section data-testid={testId ?? 'remote-section'}>
      <div className="section-title">{section.title}</div>
      {section.label && <div className="section-label">{section.label}</div>}
      {allSongs ? (
        <div className="quick-picks">
          {items.map((item) => (
            <div
              key={item.id}
              className={`qp-cell${currentId === item.id ? ' active' : ''}`}
              onClick={() => playItem(item)}
              data-testid="recommended-track"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') playItem(item);
              }}
            >
              {item.thumbnailUrl ? (
                <img className="track-art" src={item.thumbnailUrl} alt="" width={46} height={46} />
              ) : (
                <div className="art-fallback" style={{ width: 46, height: 46, fontSize: 19 }}>
                  {(item.title || '?').trim().charAt(0).toUpperCase()}
                </div>
              )}
              <div className="track-main">
                <div className="t-title">{item.title}</div>
                <div className="t-sub">
                  {item.subtitle}
                  {item.durationSec ? ` · ${formatTime(item.durationSec)}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="cards-row">
          {items.map((item) =>
            item.type === 'mood' ? (
              <button
                key={item.id}
                className="mood-tile"
                style={{ ['--mood' as string]: item.extra || 'var(--violet)' }}
                onClick={() => onItem(item)}
              >
                <span className="mood-dot" />
                {item.title}
              </button>
            ) : (
              <div
                key={`${item.type}-${item.id}`}
                className={`media-card${item.type === 'artist' ? ' round' : ''}${item.type === 'song' && currentId === item.id ? ' active' : ''}`}
                onClick={() => (item.type === 'song' ? playItem(item) : onItem(item))}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (item.type === 'song' ? playItem(item) : onItem(item));
                }}
              >
                {item.thumbnailUrl ? (
                  <img src={item.thumbnailUrl} alt="" />
                ) : (
                  <div className="art-fallback card-fallback">
                    {(item.title || '?').trim().charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="mc-title">{item.title}</div>
                <div className="mc-sub">
                  {item.type === 'album' && item.extra ? `${item.extra} · ` : ''}
                  {item.subtitle ?? (item.type === 'artist' ? 'Artist' : '')}
                  {item.type === 'playlist' && item.extra ? ` · ${item.extra}` : ''}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

export { itemToTrack };
