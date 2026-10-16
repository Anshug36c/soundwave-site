/**
 * Listen Together: synced group listening with the Soundwave Android app (and other web
 * sessions) over the app's own relay protocol.
 *
 * The web build speaks the exact wire protocol the app uses (binary protobuf `Envelope` frames
 * over WebSocket; see `lib/ltProto.ts` / `lib/ltClient.ts`, ported from
 * `app/src/main/proto/listentogether.proto`). Point this screen and the app's
 * Settings → Integrations → Listen Together at the same server URL, then create/join a room.
 *
 * Honest limitation, stated in the UI: the protocol syncs *playback state*, not audio. Each
 * participant plays its own copy of the track, so as a guest this browser can only play songs that
 * are already in its local library (matched by title/artist). A track the library doesn't have is
 * shown as unavailable rather than silently ignored — a static page can't stream the phone's
 * files or YouTube.
 */
import { useState } from 'react';
import { store } from '../state/store';
import { listenTogether } from '../state/listenTogether';
import { Switch, formatTime } from '../ui/common';
import { IconTogether } from '../ui/icons';

export function ListenTogetherScreen() {
  const settings = store((s) => s.settings);
  const updateSettings = store((s) => s.updateSettings);
  const lt = listenTogether();
  const [joinCode, setJoinCode] = useState('');

  const inRoom = lt.roomCode !== null;

  const copyCode = (): void => {
    if (lt.roomCode) void navigator.clipboard?.writeText(lt.roomCode);
  };

  return (
    <div style={{ padding: '8px 0 24px' }}>
      <div className="page-title">Listen Together</div>
      <div className="page-sub">
        Sync playback with the Soundwave app and other listeners in a shared room.
      </div>

      {lt.notice && (
        <div className="card" style={{ borderColor: 'var(--violet)' }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <span className="muted">{lt.notice}</span>
            <button className="btn ghost sm" onClick={lt.dismissNotice}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {!inRoom ? (
        <>
          <div className="card">
            <h3>Server</h3>
            <div className="hint">
              The relay both clients connect to. Use the same URL in the app under Settings →
              Integrations → Listen Together. Needs <code>wss://</code> when this page is on https.
            </div>
            <label className="search" style={{ marginTop: 10 }}>
              <input
                value={settings.ltServerUrl}
                placeholder="wss://…/ws"
                onChange={(e) => void updateSettings({ ltServerUrl: e.target.value })}
              />
            </label>
            <label className="search" style={{ marginTop: 8 }}>
              <input
                value={settings.ltUsername}
                placeholder="Your display name"
                onChange={(e) => void updateSettings({ ltUsername: e.target.value })}
              />
            </label>
          </div>

          <div className="card">
            <h3>Start or join</h3>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <button className="btn primary" onClick={lt.createRoom}>
                Create room
              </button>
              <label className="search" style={{ flex: 1, minWidth: 140 }}>
                <input
                  value={joinCode}
                  placeholder="Room code"
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                />
              </label>
              <button className="btn" disabled={!joinCode} onClick={() => lt.joinRoom(joinCode)}>
                Join
              </button>
            </div>
            <div className="hint" style={{ marginTop: 10 }}>
              Creating a room makes this browser the host: your play/pause/seek/track changes are
              broadcast and everyone else follows. Joining makes you a guest that follows the
              host.
            </div>
          </div>

          <div className="card">
            <h3>How audio works here</h3>
            <div className="hint">
              Listen Together syncs playback, not sound. As a guest this browser plays the host's
              song only if that song is already in your library (matched by title/artist);
              anything else is flagged as unavailable. As a host, guests need the same tracks on
              their device to hear them.
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Room code
                </div>
                <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 2 }}>{lt.roomCode}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span className={`chip${lt.role === 'host' ? ' active' : ''}`}>
                  {lt.role === 'host' ? 'Host' : 'Guest'}
                </span>
                <span className="chip">{lt.connection}</span>
                {lt.rtt > 0 && <span className="chip">{lt.rtt} ms</span>}
              </div>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button className="btn sm" onClick={copyCode}>
                Copy code
              </button>
              <button className="btn ghost sm" onClick={lt.leave}>
                Leave room
              </button>
            </div>
          </div>

          {lt.missingTrack && (
            <div className="card" style={{ borderColor: 'var(--violet)' }}>
              <div className="hint">
                Not in your library: “{lt.missingTrack.title}” — {lt.missingTrack.artist}. Add the
                file to your library to follow along.
              </div>
            </div>
          )}

          <div className="card">
            <h3>Now playing in room</h3>
            {lt.currentTrack ? (
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{lt.currentTrack.title}</div>
                  <div className="muted">{lt.currentTrack.artist}</div>
                </div>
                <div className="muted">
                  {lt.isPlaying ? 'playing' : 'paused'} · {formatTime(lt.positionMs / 1000)}
                </div>
              </div>
            ) : (
              <div className="hint">Nothing playing yet.</div>
            )}
          </div>

          {lt.role === 'host' && lt.pendingJoins.length > 0 && (
            <div className="card">
              <h3>Join requests</h3>
              {lt.pendingJoins.map((p) => (
                <div className="row" key={p.userId} style={{ justifyContent: 'space-between', gap: 8, padding: '6px 0' }}>
                  <span>{p.username}</span>
                  <span className="row" style={{ gap: 6 }}>
                    <button className="btn sm primary" onClick={() => lt.approve(p.userId)}>
                      Approve
                    </button>
                    <button className="btn sm ghost" onClick={() => lt.reject(p.userId)}>
                      Reject
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <h3>In this room · {lt.users.length}</h3>
            {lt.users.map((u) => (
              <div className="row" key={u.userId} style={{ justifyContent: 'space-between', gap: 8, padding: '6px 0' }}>
                <span className="row" style={{ gap: 8 }}>
                  <IconTogether size={18} />
                  <span>{u.username}</span>
                </span>
                <span className="muted">
                  {u.isHost ? 'host' : 'guest'}
                  {u.isConnected ? '' : ' · offline'}
                </span>
              </div>
            ))}
            {lt.role === 'host' && (
              <div style={{ marginTop: 10 }}>
                <Switch
                  on={lt.allowParticipantControl}
                  onChange={lt.setAllowParticipantControl}
                  label="Let guests control playback"
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
