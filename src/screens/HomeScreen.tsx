/**
 * Home — mirrors the app's Home screen: shelves from the YouTube Music
 * home feed (quick picks, albums, artists, mixes) served by the connected
 * SoundWave phone, plus Charts / Explore entries like the app's chips.
 * Nothing here is placeholder data: without a phone connection the
 * screen says so and offers to connect.
 */
import { useEffect } from 'react';
import { ConnectPrompt } from '../components/ConnectPrompt';
import { RemoteSectionView } from '../components/RemoteSection';
import { remoteStore } from '../state/remote';
import type { RemoteItem } from '../lib/remoteClient';

export function HomeScreen() {
  const phase = remoteStore((s) => s.phase);
  const sections = remoteStore((s) => s.homeSections);
  const loading = remoteStore((s) => s.homeLoading);
  const loadHome = remoteStore((s) => s.loadHome);
  const playListAt = remoteStore((s) => s.playListAt);
  const openDetail = remoteStore((s) => s.openDetail);
  const openMood = remoteStore((s) => s.openMood);
  const openCharts = remoteStore((s) => s.openCharts);
  const openExplore = remoteStore((s) => s.openExplore);
  const detailLoading = remoteStore((s) => s.detailLoading);
  const queue = remoteStore((s) => s.queue);
  const index = remoteStore((s) => s.index);

  const online = phase === 'online';
  const currentId = index >= 0 && index < queue.length ? queue[index].id : null;

  useEffect(() => {
    if (online && sections.length === 0) void loadHome();
  }, [online, sections.length, loadHome]);

  const onItem = (item: RemoteItem) => {
    if (item.type === 'mood') void openMood(item);
    else if (item.type === 'album' || item.type === 'artist' || item.type === 'playlist') {
      void openDetail(item.type, item.id);
    }
  };

  return (
    <div style={{ padding: '8px 0 24px' }}>
      <div className="page-title">Home</div>
      <div className="page-sub">From SoundWave's home feed — plays here, never on the phone.</div>

      {!online ? (
        <ConnectPrompt what="Your home feed" />
      ) : (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <button className="btn sm" onClick={() => void openCharts()} disabled={detailLoading}>
              Charts
            </button>
            <button className="btn sm" onClick={() => void openExplore()} disabled={detailLoading}>
              Explore · New releases &amp; moods
            </button>
            {detailLoading && <span className="muted" style={{ fontSize: 13 }}>Loading…</span>}
          </div>

          {loading && sections.length === 0 ? (
            <div className="hint" style={{ padding: '18px 2px' }}>
              Asking SoundWave for your home feed…
            </div>
          ) : sections.length === 0 ? (
            <div className="card">
              <h3>Nothing here right now</h3>
              <div className="hint">
                SoundWave returned an empty home feed. Search still works — or open YouTube Music
                in the app once so it has something to recommend from.
              </div>
            </div>
          ) : (
            sections.map((section) => (
              <RemoteSectionView
                key={section.title}
                section={section}
                currentId={currentId}
                onPlayTracks={(tracks, i) => void playListAt(tracks, i)}
                onItem={onItem}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}
