/**
 * Search — mirrors the app's Search screen: a big rounded search field and
 * song results. Queries run on the connected SoundWave phone (YouTube
 * Music, same as the app); results play here in the browser.
 */
import { ConnectPrompt } from '../components/ConnectPrompt';
import { RemoteTrackRow } from '../components/RemoteTrackRow';
import { remoteStore } from '../state/remote';
import { IconSearch } from '../ui/icons';

export function SearchScreen() {
  const phase = remoteStore((s) => s.phase);
  const query = remoteStore((s) => s.query);
  const setQuery = remoteStore((s) => s.setQuery);
  const searching = remoteStore((s) => s.searching);
  const results = remoteStore((s) => s.results);
  const search = remoteStore((s) => s.search);
  const playResultsAt = remoteStore((s) => s.playResultsAt);
  const enqueue = remoteStore((s) => s.enqueue);
  const queue = remoteStore((s) => s.queue);
  const index = remoteStore((s) => s.index);

  const online = phase === 'online';
  const currentId = index >= 0 && index < queue.length ? queue[index].id : null;

  return (
    <div style={{ padding: '8px 0 24px' }}>
      <div className="page-title">Search</div>
      <div className="page-sub">Songs from SoundWave's catalogue, played here.</div>

      {!online ? (
        <ConnectPrompt what="Search results" />
      ) : (
        <>
          <div className="row" style={{ gap: 8 }}>
            <label className="search search-big" style={{ flex: 1 }}>
              <IconSearch size={20} />
              <input
                value={query}
                placeholder="Search songs…"
                enterKeyHint="search"
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void search();
                }}
              />
            </label>
            <button className="btn primary" disabled={searching} onClick={() => void search()}>
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>

          <div style={{ marginTop: 10 }}>
            {results.map((t, i) => (
              <RemoteTrackRow
                key={t.id}
                track={t}
                current={currentId === t.id}
                onPlay={() => void playResultsAt(i)}
                onEnqueue={() => enqueue(t)}
              />
            ))}
            {results.length === 0 && !searching && (
              <div className="hint" style={{ padding: '14px 2px' }}>
                Search for a song, artist or album — SoundWave answers, this browser plays it.
              </div>
            )}
            {searching && <div className="hint" style={{ padding: '14px 2px' }}>Searching SoundWave…</div>}
          </div>
        </>
      )}
    </div>
  );
}
