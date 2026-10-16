/**
 * Stats — listening statistics for *this browser* (mirrors the app's
 * Stats idea): counts only what was actually played here, from the
 * local library or via the phone bridge. It is not the phone's history.
 */
import { useState } from 'react';
import { clearWebStats, readWebStats } from '../lib/webStats';
import { store } from '../state/store';
import { formatLongTime } from '../ui/common';
import { IconBack } from '../ui/icons';

export function StatsScreen() {
  const setStatsOpen = store((s) => s.setStatsOpen);
  const [tick, setTick] = useState(0);
  void tick;
  const stats = readWebStats();
  const top = stats.entries.slice(0, 15);

  return (
    <div className="page-overlay" data-testid="stats">
      <div className="overlay-head">
        <button className="btn icon ghost" onClick={() => setStatsOpen(false)} aria-label="Back">
          <IconBack size={22} />
        </button>
        <div className="overlay-title">Your listening on this device</div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-num">{stats.totalPlays}</div>
          <div className="stat-label">Plays</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{stats.entries.length}</div>
          <div className="stat-label">Tracks played</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{formatLongTime(stats.totalSeconds)}</div>
          <div className="stat-label">Of music started</div>
        </div>
      </div>

      <div className="section-title">Most played here</div>
      {top.length === 0 ? (
        <div className="hint" style={{ padding: '10px 2px' }}>
          Nothing yet — play something from your library or via SoundWave and it will show up here.
        </div>
      ) : (
        <div className="track-list">
          {top.map((e) => (
            <div key={e.key} className="track-row" style={{ cursor: 'default' }}>
              {e.artwork ? (
                <img className="track-art" src={e.artwork} alt="" width={42} height={42} />
              ) : (
                <div className="art-fallback" style={{ width: 42, height: 42, fontSize: 17 }}>
                  {(e.title || '?').trim().charAt(0).toUpperCase()}
                </div>
              )}
              <div className="track-main">
                <div className="t-title">{e.title}</div>
                <div className="t-sub">
                  {e.artist} · {e.source === 'remote' ? 'via SoundWave' : 'local file'}
                </div>
              </div>
              <div className="track-dur">{e.plays}×</div>
            </div>
          ))}
        </div>
      )}

      {stats.totalPlays > 0 && (
        <button
          className="btn ghost sm"
          style={{ marginTop: 18, color: 'var(--danger)' }}
          onClick={() => {
            clearWebStats();
            setTick((t) => t + 1);
          }}
        >
          Clear these stats
        </button>
      )}
    </div>
  );
}
