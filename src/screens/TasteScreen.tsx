/**
 * Taste: the Local Taste Engine, ported from
 * `app/src/main/kotlin/com/music/echo/generate/LocalTasteEngine.kt`.
 *
 * It scores the visitor's own listening history with the exact Android formula (play time,
 * skips, likes, recency, time of day) and builds a "My Taste Mix" playlist from the result. The
 * score factors are shown per track so the ranking is explainable rather than opaque.
 *
 * Honest limitation, stated in the UI: on Android the engine expands its seeds through
 * YouTube.next/related. A static GitHub Pages site has no backend and Soundwave ships no provider
 * credentials, so expansion here is limited to the tracks already in the local library. Scoring is
 * identical; the candidate pool is smaller.
 */
import { useMemo, useState } from 'react';
import { store } from '../state/store';
import { Artwork, EmptyState, formatTime } from '../ui/common';
import { IconInfo, IconPlay, IconTaste } from '../ui/icons';
import { currentTimeOfDay, generateFromTaste, trackKeyOf, MAX_SEEDS } from '../lib/tasteScoring';
import type { TasteSuggestion } from '../lib/types';

export function TasteScreen() {
  const state = store();
  const [lastRun, setLastRun] = useState<TasteSuggestion[] | null>(null);
  const [explainId, setExplainId] = useState<string | null>(null);

  const hasHistory = Object.keys(state.stats).length > 0;
  const timeOfDay = currentTimeOfDay();

  const ranked = useMemo(() => {
    if (!hasHistory) return [];
    const statsMap = new Map(Object.entries(state.stats));
    const result = generateFromTaste(state.tracks, statsMap);
    return result.ok ? result.suggestions : [];
  }, [state.tracks, state.stats, hasHistory]);

  const mix = lastRun ?? (ranked.length > 0 ? ranked : null);

  if (state.tracks.length === 0) {
    return (
      <>
        <h1 className="page-title">Taste</h1>
        <p className="page-sub">A local ranking of your listening history.</p>
        <EmptyState
          icon={<IconTaste size={64} />}
          title="Nothing to score yet"
          body="Import music and play a few tracks. The Taste Engine reads your local listening history — play time, skips, likes and when you listen — and never sends anything anywhere."
          actions={<button className="btn primary" onClick={() => state.setTab('library')}>Go to Library</button>}
        />
      </>
    );
  }

  return (
    <>
      <div className="taste-hero">
        <h2>Local Taste Engine</h2>
        <p>
          Ranks your own library the way the Soundwave app does — offline, on-device, no AI prompt
          and no network call. Right now it is <strong>{timeOfDay}</strong>, which nudges recent
          plays in the morning and liked tracks at night.
        </p>
        <div className="row" style={{ justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn primary"
            disabled={!hasHistory}
            onClick={async () => {
              await state.generateTasteMix();
              const statsMap = new Map(Object.entries(store.getState().stats));
              const result = generateFromTaste(store.getState().tracks, statsMap);
              if (result.ok) setLastRun(result.suggestions);
              state.setTab('playlists');
            }}
          >
            Generate My Taste Mix
          </button>
        </div>
        {!hasHistory && (
          <p className="hint" style={{ marginTop: 14, color: 'var(--text-dim)' }}>
            Play a few tracks first — the mix needs listening history to score.
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <IconInfo size={18} style={{ color: 'var(--accent-cyan)', flex: 'none', marginTop: 2 }} />
          <div>
            <h3 style={{ marginBottom: 4 }}>How this differs from the app</h3>
            <p className="hint" style={{ margin: 0 }}>
              On Android the engine seeds from your top tracks and then expands through related
              streaming results. Soundwave Web is a static site with no backend and no provider
              credentials, so it scores and orders the tracks you already have. The{' '}
              <em>scoring is identical</em> — only the candidate pool is your local library. Up to{' '}
              {MAX_SEEDS} seeds are chosen before expansion.
            </p>
          </div>
        </div>
      </div>

      {mix && mix.length > 0 ? (
        <>
          <div className="section-title">Ranked for you · {mix.length}</div>
          <div className="track-list">
            {mix.map((s, i) => {
              const active = s.track.id === state.queue[state.queueIndex];
              return (
                <div key={s.track.id + i}>
                  <div className="track-row" onClick={() => void state.playTrack(s.track.id, mix.map((m) => m.track.id))}>
                    <div className="track-index">{i + 1}</div>
                    <Artwork track={s.track} />
                    <div className="track-main">
                      <div className="t-title">{s.track.title}</div>
                      <div className="t-sub">{s.track.artist}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="score-badge">{s.score.toFixed(1)}</div>
                      <div className="track-dur">{formatTime(s.track.durationSec)}</div>
                    </div>
                    <button
                      className="btn icon ghost"
                      onClick={(e) => { e.stopPropagation(); setExplainId(explainId === s.track.id ? null : s.track.id); }}
                      aria-label="Why this rank"
                    >
                      <IconInfo size={18} />
                    </button>
                    {active && <IconPlay size={0} />}
                  </div>
                  {explainId === s.track.id && <ScoreExplain suggestion={s} />}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="card center">
          <p className="hint" style={{ margin: 0 }}>
            {hasHistory
              ? 'Your history has not produced eligible candidates yet — play a few tracks through to at least 85% and avoid skipping.'
              : 'No listening history recorded yet. Play some tracks and come back.'}
          </p>
        </div>
      )}
    </>
  );
}

function ScoreExplain({ suggestion }: { suggestion: TasteSuggestion }) {
  const f = suggestion.factors;
  const key = trackKeyOf(suggestion.track.title, suggestion.track.artist);
  void key;
  const rows: [string, number, string][] = [
    ['Play time', f.playTimeContribution, 'var(--accent-cyan)'],
    ['Liked', f.likedBonus, 'var(--accent-violet)'],
    ['Recent', f.recencyBonus, 'var(--ok)'],
    ['Skips', -f.skipPenalty, 'var(--danger)'],
  ];
  return (
    <div style={{ padding: '2px 10px 12px 52px' }}>
      <div className="why">
        {rows.map(([label, value, color]) => (
          <div className="taste-factor" key={label}>
            <span className="dot" style={{ background: color }} />
            {label} {value >= 0 ? '+' : ''}
            {value.toFixed(1)}
          </div>
        ))}
        <div className="taste-factor">
          <span className="dot" style={{ background: 'var(--text-dim)' }} />
          ×{f.hourMultiplier.toFixed(2)} time of day
        </div>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        {suggestion.stats.playCount} completed · {suggestion.stats.skipCount} skipped ·{' '}
        {Math.round(suggestion.stats.totalPlayTimeMs / 60000)} min total
      </div>
    </div>
  );
}
