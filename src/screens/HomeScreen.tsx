/**
 * Home — mirrors the app's Home screen: Quick picks from the YouTube Music
 * home feed, served by the connected SoundWave phone (the same source the
 * app itself shows). Nothing here is placeholder data: without a phone
 * connection the screen says so and offers to connect.
 */
import { useEffect } from 'react';
import { ConnectPrompt } from '../components/ConnectPrompt';
import { RemoteTrackRow } from '../components/RemoteTrackRow';
import { remoteStore } from '../state/remote';

export function HomeScreen() {
  const phase = remoteStore((s) => s.phase);
  const recommended = remoteStore((s) => s.recommended);
  const loading = remoteStore((s) => s.recommendedLoading);
  const loadRecommended = remoteStore((s) => s.loadRecommended);
  const playListAt = remoteStore((s) => s.playListAt);
  const enqueue = remoteStore((s) => s.enqueue);
  const queue = remoteStore((s) => s.queue);
  const index = remoteStore((s) => s.index);

  const online = phase === 'online';
  const currentId = index >= 0 && index < queue.length ? queue[index].id : null;

  useEffect(() => {
    if (online && recommended.length === 0) void loadRecommended();
  }, [online, recommended.length, loadRecommended]);

  const quickPicks = recommended.slice(0, 16);
  const more = recommended.slice(16);

  return (
    <div style={{ padding: '8px 0 24px' }}>
      <div className="page-title">Home</div>
      <div className="page-sub">Recommended from SoundWave — plays here, never on the phone.</div>

      {!online ? (
        <ConnectPrompt what="Your recommendations" />
      ) : loading && recommended.length === 0 ? (
        <div className="hint" style={{ padding: '18px 2px' }}>
          Asking SoundWave for your home feed…
        </div>
      ) : recommended.length === 0 ? (
        <div className="card">
          <h3>Nothing recommended right now</h3>
          <div className="hint">
            SoundWave returned an empty home feed. Search still works — or open YouTube Music in
            the app once so it has something to recommend from.
          </div>
        </div>
      ) : (
        <>
          <div className="section-title">Quick picks</div>
          <div className="quick-picks">
            {quickPicks.map((t, i) => (
              <div
                key={t.id}
                className={`qp-cell${currentId === t.id ? ' active' : ''}`}
                onClick={() => void playListAt(recommended, i)}
                data-testid="recommended-track"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void playListAt(recommended, i);
                }}
              >
                {t.thumbnailUrl ? (
                  <img className="track-art" src={t.thumbnailUrl} alt="" width={46} height={46} />
                ) : (
                  <div className="art-fallback" style={{ width: 46, height: 46, fontSize: 19 }}>
                    {(t.title || '?').trim().charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="track-main">
                  <div className="t-title">{t.title}</div>
                  <div className="t-sub">{t.artist}</div>
                </div>
              </div>
            ))}
          </div>

          {more.length > 0 && (
            <>
              <div className="section-title">Recommended for you</div>
              <div className="track-list">
                {more.map((t, i) => (
                  <RemoteTrackRow
                    key={t.id}
                    track={t}
                    current={currentId === t.id}
                    onPlay={() => void playListAt(recommended, quickPicks.length + i)}
                    onEnqueue={() => enqueue(t)}
                    testId="recommended-track"
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
