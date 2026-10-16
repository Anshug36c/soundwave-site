/**
 * Phone — the connection screen for the Remote Web Player.
 *
 * SoundWave on Android (Settings → Remote Web Player) searches YouTube
 * Music and resolves tracks; Home / Search / Library's phone content and
 * the player all run from this connection, and playback happens here in
 * the browser. The connection is verified (health + session) before the
 * UI ever reports "connected".
 */
import { remoteStore } from '../state/remote';

export function PhoneScreen() {
  const r = remoteStore();
  const online = r.phase === 'online';

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
              <div className="hint" role="alert" style={{ marginTop: 8, color: '#ffb4d0' }}>
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
          <div className="hint" style={{ marginTop: 8 }}>
            Home shows your recommendations and Search queries the phone's catalogue. The player at
            the bottom controls playback here — nothing ever plays on the phone itself.
          </div>
          {r.error && (
            <div className="hint" role="alert" style={{ marginTop: 8, color: '#ffb4d0' }}>
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
      )}
    </div>
  );
}
