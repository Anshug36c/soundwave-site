/**
 * Phone tab: play music from the SoundWave Android app *on this device*.
 *
 * The phone (Settings → Remote Web Player) searches YouTube Music and
 * resolves tracks; this screen plays them with its own audio element and
 * its own queue. It cannot start, stop or change playback on the phone or
 * in the site's local library player.
 */
import { remoteStore } from '../state/remote';
import { formatTime } from '../ui/common';
import { IconNext, IconPause, IconPlay, IconPrev, IconSearch, IconTrash } from '../ui/icons';
import type { RemoteTrack } from '../lib/remoteClient';

export function RemoteScreen() {
  const r = remoteStore();
  const online = r.phase === 'online';
  const current = r.index >= 0 && r.index < r.queue.length ? r.queue[r.index] : null;

  return (
    <div style={{ padding: '8px 0 24px' }}>
      <div className="page-title">Phone</div>
      <div className="page-sub">
        Music from your SoundWave phone, played here in the browser. The phone's own player is never
        touched.
      </div>

      {!online ? (
        <>
          <div className="card">
            <h3>Connect to SoundWave</h3>
            <div className="hint">
              On your Android phone: SoundWave → Settings → Remote Web Player → turn it on, and turn
              on the free tunnel for anywhere access. Then paste the address it shows and the 6-digit
              pairing code. The connection is verified before anything is marked connected.
            </div>
            <label className="search" style={{ marginTop: 10 }}>
              <input
                value={r.baseUrl}
                placeholder="https://….lhr.life (tunnel) or http://192.168.1.20:8930"
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(e) => r.setBaseUrl(e.target.value)}
              />
            </label>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <label className="search" style={{ flex: 1 }}>
                <input
                  value={r.code}
                  placeholder="6-digit pairing code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  onChange={(e) => r.setCode(e.target.value.replace(/\D/g, ''))}
                />
              </label>
              <button
                className="btn primary"
                disabled={r.phase === 'checking'}
                onClick={() => void r.connect()}
              >
                {r.phase === 'checking' ? 'Connecting…' : 'Connect'}
              </button>
            </div>
            {r.phase === 'error' && (
              <button className="btn sm" style={{ marginTop: 8 }} onClick={() => void r.reconnect()}>
                Reconnect
              </button>
            )}
            {r.error && (
              <div className="hint" role="alert" style={{ marginTop: 8, color: 'var(--violet)' }}>
                {r.error}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Same Wi-Fi? Even simpler</h3>
            <div className="hint">
              With both devices on one Wi-Fi, SoundWave shows a <strong>LAN address</strong> (and QR
              code). Open it in Safari — SoundWave serves a small player page itself, so no internet
              and no tunnel are needed. A secure page like this one cannot call the phone's LAN
              address directly (browser mixed-content rules), which is why the phone serves that
              page. If the LAN address does not load, your router may isolate Wi-Fi clients — the
              tunnel above still works.
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600 }}>Connected to SoundWave</div>
                <div className="muted" style={{ wordBreak: 'break-all' }}>
                  {r.baseUrl}
                  {r.session
                    ? ` · ${r.session.label} · until ${new Date(r.session.expiresAtMs).toLocaleTimeString()}`
                    : ''}
                </div>
              </div>
              <button className="btn ghost sm" onClick={() => void r.disconnect()}>
                Disconnect &amp; revoke
              </button>
            </div>
            {r.error && (
              <div className="hint" role="alert" style={{ marginTop: 8, color: 'var(--violet)' }}>
                {r.error}{' '}
                <button className="btn ghost sm" onClick={() => void r.reconnect()}>
                  Reconnect
                </button>
              </div>
            )}
            {r.notice && (
              <div className="hint" style={{ marginTop: 8 }}>
                {r.notice}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Search SoundWave's music</h3>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <label className="search" style={{ flex: 1 }}>
                <IconSearch size={18} />
                <input
                  value={r.query}
                  placeholder="Search songs…"
                  enterKeyHint="search"
                  onChange={(e) => r.setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void r.search();
                  }}
                />
              </label>
              <button className="btn primary" disabled={r.searching} onClick={() => void r.search()}>
                {r.searching ? 'Searching…' : 'Search'}
              </button>
            </div>
            <div style={{ marginTop: 6 }}>
              {r.results.map((track, i) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  current={current?.id === track.id}
                  onPlay={() => void r.playResultsAt(i)}
                  onEnqueue={() => r.enqueue(track)}
                />
              ))}
              {r.results.length === 0 && !r.searching && (
                <div className="hint">Results from the phone appear here. Nothing plays on the phone.</div>
              )}
            </div>
          </div>

          {current && (
            <div className="card" data-testid="remote-now-playing">
              <div className="row" style={{ gap: 12 }}>
                {current.thumbnailUrl && (
                  <img
                    src={current.thumbnailUrl}
                    alt=""
                    width={64}
                    height={64}
                    style={{ borderRadius: 10, objectFit: 'cover' }}
                  />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }} className="ellipsis">
                    {current.title}
                  </div>
                  <div className="muted ellipsis">{current.artist}</div>
                  <div className="muted">
                    {r.resolving ? 'Asking SoundWave for the audio…' : r.playing ? 'Playing here' : 'Paused'}
                  </div>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.floor(r.durationSec || current.durationSec || 0))}
                value={Math.floor(r.positionSec)}
                onChange={(e) => r.seek(Number(e.target.value))}
                style={{ width: '100%', marginTop: 12 }}
                aria-label="Seek"
              />
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted">{formatTime(r.positionSec)}</span>
                <span className="muted">{formatTime(r.durationSec || current.durationSec || 0)}</span>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 6, justifyContent: 'center' }}>
                <button className="btn sm" onClick={() => void r.prev()} aria-label="Previous">
                  <IconPrev size={18} />
                </button>
                <button
                  className="btn sm primary"
                  onClick={() => void r.toggle()}
                  aria-label={r.playing ? 'Pause' : 'Play'}
                  data-testid="remote-toggle"
                >
                  {r.playing ? <IconPause size={18} /> : <IconPlay size={18} />}
                </button>
                <button className="btn sm" onClick={() => void r.next()} aria-label="Next">
                  <IconNext size={18} />
                </button>
              </div>
              {r.formatWarning && (
                <div className="hint" role="alert" style={{ marginTop: 8, color: 'var(--violet)' }}>
                  {r.formatWarning}
                </div>
              )}
            </div>
          )}

          {r.queue.length > 0 && (
            <div className="card">
              <h3>Queue (this device only)</h3>
              <div style={{ marginTop: 6 }}>
                {r.queue.map((track, i) => (
                  <TrackRow
                    key={`${track.id}-${i}`}
                    track={track}
                    current={i === r.index}
                    onPlay={() => void r.playQueueAt(i)}
                    onRemove={() => r.removeFromQueue(i)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TrackRow(props: {
  track: RemoteTrack;
  current: boolean;
  onPlay: () => void;
  onEnqueue?: () => void;
  onRemove?: () => void;
}) {
  const { track } = props;
  return (
    <div
      className="row"
      style={{
        gap: 10,
        padding: '8px 6px',
        borderRadius: 10,
        background: props.current ? 'var(--card-2, rgba(124,92,255,.12))' : undefined,
        cursor: 'pointer',
      }}
      onClick={props.onPlay}
      data-testid="remote-track"
    >
      {track.thumbnailUrl ? (
        <img
          src={track.thumbnailUrl}
          alt=""
          width={44}
          height={44}
          style={{ borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
        />
      ) : (
        <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--card-2, #222)', flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }} className="ellipsis">
          {track.title}
        </div>
        <div className="muted ellipsis">
          {track.artist}
          {track.durationSec ? ` · ${formatTime(track.durationSec)}` : ''}
        </div>
      </div>
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
          className="btn ghost sm"
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
