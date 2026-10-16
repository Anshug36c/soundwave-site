/**
 * Settings: playback (crossfade, limiter, visualiser), appearance (theme), library/data management,
 * and an honest "About & limitations" panel. Nothing here is a stub — every control is wired to the
 * store and persists to IndexedDB.
 */
import { useEffect, useState } from 'react';
import { store } from '../state/store';
import { Modal, SettingRow, Switch, formatBytes } from '../ui/common';
import { IconInfo, IconTrash } from '../ui/icons';

export function SettingsScreen() {
  const state = store();
  const { settings, capabilities } = state;
  const [wipeOpen, setWipeOpen] = useState(false);
  const [clearLibOpen, setClearLibOpen] = useState(false);

  const storageEstimate = useStorageEstimate();
  const totalBytes = state.tracks.reduce((a, t) => a + (t.fileSize || 0), 0);

  return (
    <>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Stored locally on this device.</p>

      <div className="section-title">Playback</div>
      <div className="card">
        <SettingRow
          label="Crossfade"
          desc={`Blend the end of one track into the start of the next. ${capabilities.fileSystemAccess ? '' : 'Works best with local files.'}`}
        >
          <Switch
            on={settings.crossfadeEnabled}
            onChange={(v) => void state.setCrossfade(v, settings.crossfadeSeconds)}
            label="Crossfade"
          />
        </SettingRow>
        {settings.crossfadeEnabled && (
          <div className="setting-row">
            <div className="grow">
              <div className="label">Crossfade length</div>
              <div className="desc">{settings.crossfadeSeconds} seconds</div>
            </div>
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={settings.crossfadeSeconds}
              style={{ width: 150 }}
              onChange={(e) => void state.setCrossfade(true, Number(e.target.value))}
              aria-label="Crossfade length"
            />
          </div>
        )}
        <SettingRow
          label="Headroom protection"
          desc="A soft limiter that prevents clipping when EQ boosts push the signal hot. Turn off for a bit-exact signal path."
        >
          <Switch on={settings.limiterEnabled} onChange={(v) => void state.setLimiter(v)} label="Headroom protection" />
        </SettingRow>
        <div className="setting-row">
          <div className="grow">
            <div className="label">Visualiser</div>
            <div className="desc">Animation drawn over the artwork while playing.</div>
          </div>
          <select
            className="sort-select"
            value={settings.visualizerStyle}
            onChange={(e) => void state.updateSettings({ visualizerStyle: e.target.value as 'bars' | 'wave' | 'off' })}
            aria-label="Visualiser style"
          >
            <option value="bars">Bars</option>
            <option value="wave">Waveform</option>
            <option value="off">Off</option>
          </select>
        </div>
      </div>

      <div className="section-title">Appearance</div>
      <div className="card">
        <div className="setting-row">
          <div className="grow">
            <div className="label">Theme</div>
            <div className="desc">Dark is the default, matching the app.</div>
          </div>
          <select
            className="sort-select"
            value={settings.theme}
            onChange={(e) => void state.updateSettings({ theme: e.target.value as 'dark' | 'light' | 'system' })}
            aria-label="Theme"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
          </select>
        </div>
      </div>

      <div className="section-title">Library & data</div>
      <div className="card">
        <SettingRow label="Tracks" desc={`${state.tracks.length} in library · ${formatBytes(totalBytes)} referenced`}>
          <span className="chip">{state.playlists.length} playlists</span>
        </SettingRow>
        <SettingRow
          label="Persistent library"
          desc={
            capabilities.fileSystemAccess
              ? 'Folder access is supported here, so your library can be re-opened across visits.'
              : 'This browser cannot keep file access between visits. Metadata is saved, but you may need to re-add files next time.'
          }
        >
          <span className="chip">{capabilities.fileSystemAccess ? 'Supported' : 'Session-only'}</span>
        </SettingRow>
        {storageEstimate && (
          <SettingRow label="Browser storage" desc={`Using ${formatBytes(storageEstimate.usage)} of ${formatBytes(storageEstimate.quota)} available`}>
            <span className="chip">{Math.round((storageEstimate.usage / Math.max(1, storageEstimate.quota)) * 100)}%</span>
          </SettingRow>
        )}
        <SettingRow label="Clear library" desc="Remove all tracks but keep listening history and settings.">
          <button className="btn sm ghost" style={{ color: 'var(--danger)' }} onClick={() => setClearLibOpen(true)}>
            <IconTrash size={16} /> Clear
          </button>
        </SettingRow>
        <SettingRow label="Erase everything" desc="Wipe tracks, history, playlists, EQ profiles and settings from this browser.">
          <button className="btn sm ghost" style={{ color: 'var(--danger)' }} onClick={() => setWipeOpen(true)}>
            <IconTrash size={16} /> Erase
          </button>
        </SettingRow>
      </div>

      <div className="section-title">About</div>
      <div className="card">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <IconInfo size={18} style={{ color: 'var(--accent-cyan)', flex: 'none', marginTop: 2 }} />
          <div>
            <h3 style={{ margin: '0 0 6px' }}>Soundwave Web</h3>
            <p className="hint" style={{ margin: '0 0 10px' }}>
              A browser build of the Soundwave music player, sharing its design language and
              porting several of its engine components — the Local Taste Engine, the playback
              cutoff guard, the adaptive crossfade pre-arm, and the parametric EQ model with its
              EqualizerAPO parser — from the Android source.
            </p>
            <p className="hint" style={{ margin: 0 }}>
              Like the app, it is local-first: no account, no cloud AI, no server. It is not the
              Android app and cannot stream from YouTube or drive USB audio — a browser page has no
              access to those. It plays the audio files you give it.
            </p>
          </div>
        </div>
      </div>

      {clearLibOpen && (
        <Modal
          title="Clear library?"
          onClose={() => setClearLibOpen(false)}
          actions={
            <>
              <button className="btn ghost" onClick={() => setClearLibOpen(false)}>Cancel</button>
              <button className="btn primary" style={{ background: 'var(--danger)', color: '#fff' }} onClick={async () => { await state.clearLibrary(); setClearLibOpen(false); }}>
                Clear library
              </button>
            </>
          }
        >
          <p className="hint" style={{ margin: 0, lineHeight: 1.6 }}>
            This removes all {state.tracks.length} tracks from this browser. Listening history,
            playlists and settings are kept. This cannot be undone.
          </p>
        </Modal>
      )}

      {wipeOpen && (
        <Modal
          title="Erase everything?"
          onClose={() => setWipeOpen(false)}
          actions={
            <>
              <button className="btn ghost" onClick={() => setWipeOpen(false)}>Cancel</button>
              <button className="btn primary" style={{ background: 'var(--danger)', color: '#fff' }} onClick={async () => { await state.wipeEverything(); setWipeOpen(false); }}>
                Erase all data
              </button>
            </>
          }
        >
          <p className="hint" style={{ margin: 0, lineHeight: 1.6 }}>
            This wipes your tracks, listening history, playlists, EQ profiles and settings from this
            browser. Your original audio files on disk are untouched. This cannot be undone.
          </p>
        </Modal>
      )}
    </>
  );
}

/** `navigator.storage.estimate()`, resolved once on mount. */
function useStorageEstimate(): { usage: number; quota: number } | null {
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    let alive = true;
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      void navigator.storage.estimate().then((e) => {
        if (alive) setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0 });
      });
    }
    return () => {
      alive = false;
    };
  }, []);
  return est;
}
