/**
 * Settings — the app's playback/appearance preferences that make sense
 * for the web player: theme, local volume, and the web equalizer
 * (parametric bands on the local player's audio graph), plus data
 * controls. Nothing here configures the phone.
 */
import { store } from '../state/store';
import { clearWebStats } from '../lib/webStats';
import { IconBack } from '../ui/icons';

const PRESETS: { name: string; gains: number[] }[] = [
  { name: 'Flat', gains: [0, 0, 0, 0, 0] },
  { name: 'Bass Boost', gains: [6, 3, 0, 0, 0] },
  { name: 'Vocal', gains: [0, 1, 4, 3, 1] },
  { name: 'Treble', gains: [0, 0, 0, 3, 6] },
];

export function SettingsScreen() {
  const settings = store((s) => s.settings);
  const setSettingsOpen = store((s) => s.setSettingsOpen);
  const setTab = store((s) => s.setTab);
  const setTheme = store((s) => s.setTheme);
  const setVolume = store((s) => s.setVolume);
  const setEqEnabled = store((s) => s.setEqEnabled);
  const setEqBandGain = store((s) => s.setEqBandGain);
  const applyEqGains = store((s) => s.applyEqGains);
  const clearLibrary = store((s) => s.clearLibrary);

  const freqLabel = (f: number) => (f >= 1000 ? `${f / 1000}k` : `${f}`);

  return (
    <div className="page-overlay" data-testid="settings">
      <div className="overlay-head">
        <button className="btn icon ghost" onClick={() => setSettingsOpen(false)} aria-label="Back">
          <IconBack size={22} />
        </button>
        <div className="overlay-title">Settings</div>
      </div>

      <div className="section-title">Appearance</div>
      <div className="chips-row">
        {(['dark', 'system', 'light'] as const).map((t) => (
          <button
            key={t}
            className={`chip${settings.theme === t ? ' on' : ''}`}
            onClick={() => setTheme(t)}
            style={{ textTransform: 'capitalize' }}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="section-title">Playback (this browser)</div>
      <div className="setting-line">
        <span>Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={settings.volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="Volume"
          style={{ flex: 1 }}
        />
        <span className="muted" style={{ width: 40, textAlign: 'right' }}>
          {Math.round(settings.volume * 100)}%
        </span>
      </div>

      <div className="setting-line" style={{ marginTop: 14 }}>
        <span style={{ fontWeight: 600 }}>Equalizer</span>
        <button
          className={`switch${settings.eqEnabled ? ' on' : ''}`}
          role="switch"
          aria-checked={settings.eqEnabled}
          aria-label="Equalizer on/off"
          onClick={() => setEqEnabled(!settings.eqEnabled)}
        >
          <span className="knob" />
        </button>
      </div>
      <div className="hint" style={{ marginBottom: 10 }}>
        Applies to the local library player on this device, like the app's EQ applies on the phone.
      </div>
      <div className="chips-row">
        {PRESETS.map((p) => (
          <button key={p.name} className="chip" onClick={() => applyEqGains(p.gains)}>
            {p.name}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        {settings.eqBands.map((band, i) => (
          <div className="setting-line" key={band.frequency}>
            <span className="eq-freq">{freqLabel(band.frequency)}Hz</span>
            <input
              type="range"
              min={-12}
              max={12}
              step={0.5}
              value={band.gain}
              disabled={!settings.eqEnabled}
              onChange={(e) => setEqBandGain(i, Number(e.target.value))}
              aria-label={`${freqLabel(band.frequency)}Hz gain`}
              style={{ flex: 1 }}
            />
            <span className="muted" style={{ width: 52, textAlign: 'right' }}>
              {band.gain > 0 ? '+' : ''}
              {band.gain} dB
            </span>
          </div>
        ))}
      </div>

      <div className="section-title">Connection</div>
      <button
        className="btn sm"
        onClick={() => {
          setSettingsOpen(false);
          setTab('phone');
        }}
      >
        Manage SoundWave connection
      </button>

      <div className="section-title">Data on this device</div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn sm"
          style={{ color: 'var(--danger)' }}
          onClick={() => {
            if (window.confirm('Remove all local library tracks from this browser?')) void clearLibrary();
          }}
        >
          Clear local library
        </button>
        <button
          className="btn sm ghost"
          onClick={() => {
            clearWebStats();
          }}
        >
          Clear listening stats
        </button>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        Library files, stats and preferences live only in this browser's storage. The phone keeps
        its own library and history — nothing here changes it.
      </div>
    </div>
  );
}
