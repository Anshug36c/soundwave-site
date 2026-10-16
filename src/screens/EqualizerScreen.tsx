/**
 * Equalizer: drives the same parametric-EQ model the Android app uses
 * (`echo.music.dsp.core.models.ParametricEQ`). Presets, a preamp slider, per-band gain sliders,
 * EqualizerAPO/AutoEq text import (through the ported parser), and saved profiles backed by
 * IndexedDB. Everything is applied live to the Web Audio graph.
 */
import { useMemo, useState } from 'react';
import { store } from '../state/store';
import { EQ_PRESETS } from '../lib/eqPresets';
import { toFileFormat } from '../lib/eqParser';
import { Modal, Switch } from '../ui/common';
import { IconDownload, IconSave, IconTrash } from '../ui/icons';
import type { ParametricEQBand } from '../lib/types';

const MIN_GAIN = -12;
const MAX_GAIN = 12;

function labelForFrequency(hz: number): string {
  if (hz >= 1000) return `${hz % 1000 === 0 ? hz / 1000 : (hz / 1000).toFixed(1)}k`;
  return `${Math.round(hz)}`;
}

export function EqualizerScreen() {
  const state = store();
  const { settings } = state;
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const bands = settings.eqBands;
  const activePresetId = useMemo(() => {
    if (bands.length === 0) return null;
    const match = EQ_PRESETS.find(
      (p) =>
        p.bands.length === bands.length &&
        p.bands.every((b, i) => b.frequency === bands[i].frequency && b.filterType === bands[i].filterType),
    );
    return match?.id ?? null;
  }, [bands]);

  const setBandGain = (index: number, gain: number) => {
    const next = bands.map((b, i) => (i === index ? { ...b, gain } : b));
    void state.setEqBands(next, settings.eqPreamp);
  };

  const applyPreset = (id: string) => {
    const preset = EQ_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    const cloned: ParametricEQBand[] = preset.bands.map((b) => ({ ...b }));
    void state.applyPresetOrProfile(cloned, preset.preamp, null);
  };

  const doImport = async () => {
    setImportError(null);
    const errors = validateText(importText);
    if (errors) {
      setImportError(errors);
      return;
    }
    await state.importEqText(importText);
    setImportOpen(false);
    setImportText('');
  };

  const exportCurrent = () => {
    const text = toFileFormat({ preamp: settings.eqPreamp, bands, metadata: {} });
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'soundwave-eq.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <h1 className="page-title">Equalizer</h1>
      <p className="page-sub">
        Parametric EQ applied live through Web Audio — the same model the Soundwave app uses.
      </p>

      <div className="card">
        <div className="eq-head">
          <div>
            <h3 style={{ margin: 0 }}>Enable EQ</h3>
            <p className="hint" style={{ margin: '3px 0 0' }}>
              {settings.eqEnabled ? 'Processing is active.' : 'Bypassed — audio passes through untouched.'}
            </p>
          </div>
          <Switch on={settings.eqEnabled} onChange={(v) => void state.setEqEnabled(v)} label="Enable equalizer" />
        </div>

        <div className="preset-row">
          {EQ_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`chip${activePresetId === p.id && settings.eqProfileId === null ? ' active' : ''}`}
              onClick={() => applyPreset(p.id)}
              title={p.description}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="preamp-row">
          <label htmlFor="preamp">Preamp</label>
          <input
            id="preamp"
            type="range"
            min={-12}
            max={12}
            step={0.5}
            value={settings.eqPreamp}
            onChange={(e) => void state.setEqBands(bands, Number(e.target.value))}
          />
          <output>{settings.eqPreamp.toFixed(1)} dB</output>
        </div>

        {bands.length === 0 ? (
          <div className="center muted" style={{ padding: '28px 12px' }}>
            Pick a preset above, or import an EqualizerAPO / AutoEq profile.
          </div>
        ) : (
          <div className="eq-bands">
            {bands.map((b, i) => (
              <div className="eq-band" key={i}>
                <div className="gain">{b.gain > 0 ? '+' : ''}{b.gain.toFixed(1)}</div>
                <input
                  className="eq-slider"
                  type="range"
                  min={MIN_GAIN}
                  max={MAX_GAIN}
                  step={0.5}
                  value={Math.max(MIN_GAIN, Math.min(MAX_GAIN, b.gain))}
                  onChange={(e) => setBandGain(i, Number(e.target.value))}
                  aria-label={`Band ${labelForFrequency(b.frequency)} Hz gain`}
                  disabled={!settings.eqEnabled}
                />
                <div className="freq">{labelForFrequency(b.frequency)}</div>
                <div className="freq" style={{ opacity: 0.6 }}>{b.filterType}</div>
              </div>
            ))}
          </div>
        )}

        <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
          <button className="btn sm" onClick={() => setImportOpen(true)}>
            <IconDownload size={16} /> Import AutoEq / APO
          </button>
          <button className="btn sm" onClick={() => setSaveOpen(true)} disabled={bands.length === 0}>
            <IconSave size={16} /> Save profile
          </button>
          <button className="btn sm ghost" onClick={exportCurrent} disabled={bands.length === 0}>
            <IconDownload size={16} /> Export .txt
          </button>
          <button
            className="btn sm ghost"
            onClick={() => void state.setEqBands([], 0)}
            disabled={bands.length === 0 && settings.eqPreamp === 0}
          >
            Reset
          </button>
        </div>
      </div>

      {state.eqProfiles.length > 0 && (
        <>
          <div className="section-title">Saved profiles</div>
          <div className="card" style={{ padding: 6 }}>
            {state.eqProfiles.map((p) => (
              <div key={p.id} className="track-row">
                <div className="track-main">
                  <div className="t-title">{p.name}</div>
                  <div className="t-sub">
                    {p.bands.length} bands · preamp {p.preamp} dB
                    {p.deviceModel ? ` · ${p.deviceModel}` : ''}
                  </div>
                </div>
                {settings.eqProfileId === p.id && <span className="chip active">Active</span>}
                <button className="btn sm ghost" onClick={() => void state.loadEqProfile(p.id)}>Load</button>
                <button className="btn icon ghost" style={{ color: 'var(--danger)' }} onClick={() => void state.deleteEqProfile(p.id)} aria-label="Delete profile">
                  <IconTrash size={18} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {importOpen && (
        <Modal
          title="Import EQ profile"
          onClose={() => { setImportOpen(false); setImportError(null); }}
          actions={
            <>
              <button className="btn ghost" onClick={() => { setImportOpen(false); setImportError(null); }}>Cancel</button>
              <button className="btn primary" onClick={() => void doImport()}>Import</button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="eqtext">Paste EqualizerAPO / AutoEq text</label>
            <textarea
              id="eqtext"
              value={importText}
              placeholder={'Preamp: -3.5 dB\nFilter 1: ON PK Fc 100 Hz Gain 4.5 dB Q 1.10\nFilter 2: ON LSC Fc 60 Hz Gain 6.0 dB Q 0.70'}
              onChange={(e) => setImportText(e.target.value)}
            />
          </div>
          {importError && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 8px' }}>{importError}</p>}
          <p className="hint" style={{ color: 'var(--text-dim)', fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>
            This is the same format the app's 8850 AutoEq headphone profiles use. Paste one from the
            AutoEq database and it will apply immediately.
          </p>
        </Modal>
      )}

      {saveOpen && (
        <Modal
          title="Save EQ profile"
          onClose={() => setSaveOpen(false)}
          actions={
            <>
              <button className="btn ghost" onClick={() => setSaveOpen(false)}>Cancel</button>
              <button
                className="btn primary"
                disabled={!saveName.trim()}
                onClick={async () => { await state.saveEqProfile(saveName); setSaveName(''); setSaveOpen(false); }}
              >
                Save
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="eqname">Profile name</label>
            <input
              id="eqname"
              type="text"
              value={saveName}
              autoFocus
              placeholder="e.g. My headphones"
              onChange={(e) => setSaveName(e.target.value)}
            />
          </div>
        </Modal>
      )}
    </>
  );
}

/** Validate raw text without going through the store, so the modal can show its own error. */
function validateText(text: string): string | null {
  if (!text.trim()) return 'Nothing to import.';
  // Reuse the store's parser indirectly by checking for at least one Filter line.
  if (!/^\s*Filter/im.test(text) && !/Preamp:/i.test(text)) {
    return 'No “Filter …” or “Preamp:” lines found. Is this EqualizerAPO format?';
  }
  return null;
}
