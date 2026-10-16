/**
 * Blocking overlay shown while files are being parsed. Displays done/total and the current
 * filename so a large import feels responsive rather than frozen.
 */
import { store } from '../state/store';

export function ImportProgress() {
  const importing = store((s) => s.importing);
  if (!importing.active) return null;
  const pct = importing.total > 0 ? Math.round((importing.done / importing.total) * 100) : 0;

  return (
    <div className="progress-overlay" role="status" aria-live="polite">
      <div className="progress-card">
        <div style={{ fontWeight: 700, fontSize: 16 }}>Reading your music</div>
        <div className="progress-bar">
          <div className="fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="muted" style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          {importing.done} / {importing.total}
        </div>
        <div className="progress-name" style={{ marginTop: 8 }}>
          {importing.currentName || '…'}
        </div>
      </div>
    </div>
  );
}
