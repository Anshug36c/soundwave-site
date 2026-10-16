/**
 * Generic shelf page — Charts, Explore, and mood/genre results from the
 * phone, rendered with the same section renderer as Home.
 */
import { RemoteSectionView } from '../components/RemoteSection';
import { remoteStore } from '../state/remote';
import { IconBack } from '../ui/icons';
import type { RemoteItem } from '../lib/remoteClient';

export function BrowseScreen() {
  const stack = remoteStore((s) => s.browseStack);
  const closeBrowse = remoteStore((s) => s.closeBrowse);
  const playListAt = remoteStore((s) => s.playListAt);
  const openDetail = remoteStore((s) => s.openDetail);
  const openMood = remoteStore((s) => s.openMood);
  const detailLoading = remoteStore((s) => s.detailLoading);
  const queue = remoteStore((s) => s.queue);
  const index = remoteStore((s) => s.index);

  const view = stack[stack.length - 1];
  if (!view) return null;
  const currentId = index >= 0 && index < queue.length ? queue[index].id : null;

  const onItem = (item: RemoteItem) => {
    if (item.type === 'mood') void openMood(item);
    else if (item.type === 'album' || item.type === 'artist' || item.type === 'playlist') {
      void openDetail(item.type, item.id);
    }
  };

  return (
    <div className="page-overlay" data-testid="browse">
      <div className="overlay-head">
        <button className="btn icon ghost" onClick={closeBrowse} aria-label="Back">
          <IconBack size={22} />
        </button>
        <div className="overlay-title">{view.title}</div>
        {detailLoading && <span className="muted" style={{ fontSize: 13 }}>Loading…</span>}
      </div>

      {view.sections.length === 0 ? (
        <div className="hint" style={{ padding: '16px 2px' }}>
          SoundWave returned nothing for this page.
        </div>
      ) : (
        view.sections.map((section) => (
          <RemoteSectionView
            key={section.title}
            section={section}
            currentId={currentId}
            onPlayTracks={(tracks, i) => void playListAt(tracks, i)}
            onItem={onItem}
          />
        ))
      )}
    </div>
  );
}
