/**
 * Search — mirrors the app's Search screen: a big rounded search field,
 * type tabs (Songs / Albums / Artists / Playlists) and results. Queries
 * run on the connected SoundWave phone (YouTube Music, same as the app);
 * songs play here, albums/artists/playlists open their pages.
 */
import { ConnectPrompt } from '../components/ConnectPrompt';
import { RemoteTrackRow } from '../components/RemoteTrackRow';
import { remoteStore } from '../state/remote';
import { IconSearch } from '../ui/icons';

const TYPES = [
  { key: 'song', label: 'Songs' },
  { key: 'album', label: 'Albums' },
  { key: 'artist', label: 'Artists' },
  { key: 'playlist', label: 'Playlists' },
] as const;

export function SearchScreen() {
  const phase = remoteStore((s) => s.phase);
  const query = remoteStore((s) => s.query);
  const setQuery = remoteStore((s) => s.setQuery);
  const searching = remoteStore((s) => s.searching);
  const results = remoteStore((s) => s.results);
  const searchItems = remoteStore((s) => s.searchItems);
  const searchType = remoteStore((s) => s.searchType);
  const setSearchType = remoteStore((s) => s.setSearchType);
  const search = remoteStore((s) => s.search);
  const playResultsAt = remoteStore((s) => s.playResultsAt);
  const enqueue = remoteStore((s) => s.enqueue);
  const openDetail = remoteStore((s) => s.openDetail);
  const queue = remoteStore((s) => s.queue);
  const index = remoteStore((s) => s.index);

  const online = phase === 'online';
  const currentId = index >= 0 && index < queue.length ? queue[index].id : null;

  const pickType = (t: typeof searchType) => {
    setSearchType(t);
    if (query.trim()) {
      // Re-run the current query under the new tab, like the app.
      setTimeout(() => void search(), 0);
    }
  };

  return (
    <div style={{ padding: '8px 0 24px' }}>
      <div className="page-title">Search</div>
      <div className="page-sub">SoundWave's catalogue, played here.</div>

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

          <div className="chips-row" role="tablist" aria-label="Search type">
            {TYPES.map((t) => (
              <button
                key={t.key}
                className={`chip${searchType === t.key ? ' on' : ''}`}
                onClick={() => pickType(t.key)}
                role="tab"
                aria-selected={searchType === t.key}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 6 }}>
            {searchType === 'song' ? (
              <>
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
              </>
            ) : (
              <>
                {searchItems.map((item) => (
                  <div
                    key={`${item.type}-${item.id}`}
                    className="track-row"
                    data-testid="search-item"
                    onClick={() => void openDetail(item.type as 'album' | 'artist' | 'playlist', item.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void openDetail(item.type as 'album' | 'artist' | 'playlist', item.id);
                    }}
                  >
                    {item.thumbnailUrl ? (
                      <img
                        className={`track-art${item.type === 'artist' ? ' round-art' : ''}`}
                        src={item.thumbnailUrl}
                        alt=""
                        width={52}
                        height={52}
                      />
                    ) : (
                      <div className="art-fallback" style={{ width: 52, height: 52, fontSize: 21 }}>
                        {(item.title || '?').trim().charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="track-main">
                      <div className="t-title">{item.title}</div>
                      <div className="t-sub">
                        {item.type === 'album' && item.extra ? `${item.extra} · ` : ''}
                        {item.subtitle ?? ''}
                        {item.type === 'playlist' && item.extra ? ` · ${item.extra}` : ''}
                      </div>
                    </div>
                    <div className="row-arrow">›</div>
                  </div>
                ))}
                {searchItems.length === 0 && !searching && (
                  <div className="hint" style={{ padding: '14px 2px' }}>
                    {query.trim()
                      ? `No ${searchType}s found for "${query}".`
                      : `Type a name, then search ${searchType}s on SoundWave.`}
                  </div>
                )}
              </>
            )}
            {searching && <div className="hint" style={{ padding: '14px 2px' }}>Searching SoundWave…</div>}
          </div>
        </>
      )}
    </div>
  );
}
