/**
 * Small shared UI primitives used across screens: artwork, track rows, toggles, empty states,
 * toasts and modals. Keeping them here means the five screens stay declarative.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import type { Track } from '../lib/types';
import { IconClose, IconHeart, IconMore, IconPlay } from './icons';

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatLongTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0 min';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function Artwork({ track, size = 46, className = '' }: { track: Track | null | undefined; size?: number; className?: string }) {
  if (track?.artwork) {
    return <img className={`track-art ${className}`} src={track.artwork} width={size} height={size} alt="" style={{ width: size, height: size }} />;
  }
  const letter = (track?.title || track?.artist || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div className={`art-fallback ${className}`} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {letter}
    </div>
  );
}

export function PlayingBars() {
  return (
    <span className="playing-bars" aria-label="Now playing">
      <span /><span /><span />
    </span>
  );
}

export interface TrackRowProps {
  track: Track;
  index?: number;
  isActive?: boolean;
  isPlaying?: boolean;
  rightSlot?: ReactNode;
  onPlay?: () => void;
  onLike?: () => void;
  onMore?: () => void;
  showArt?: boolean;
}

export function TrackRow({
  track,
  index,
  isActive,
  isPlaying,
  onPlay,
  onLike,
  onMore,
  showArt = true,
}: TrackRowProps) {
  return (
    <div
      className={`track-row${isActive ? ' active' : ''}`}
      onClick={onPlay}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPlay?.();
        }
      }}
    >
      {typeof index === 'number' && (
        <div className="track-index">
          {isActive && isPlaying ? <PlayingBars /> : index + 1}
        </div>
      )}
      {showArt && <Artwork track={track} />}
      <div className="track-main">
        <div className="t-title">{track.title}</div>
        <div className="t-sub">
          {track.artist}
          {track.album ? ` · ${track.album}` : ''}
        </div>
      </div>
      <div className="track-dur">{formatTime(track.durationSec)}</div>
      <div className="track-actions">
        {onLike && (
          <button
            className="btn icon ghost"
            onClick={(e) => {
              e.stopPropagation();
              onLike();
            }}
            aria-label={track.liked ? 'Remove like' : 'Like'}
            title={track.liked ? 'Liked' : 'Like'}
            style={{ color: track.liked ? 'var(--accent-violet)' : undefined }}
          >
            <IconHeart size={19} filled={track.liked} />
          </button>
        )}
        {onMore && (
          <button
            className="btn icon ghost"
            onClick={(e) => {
              e.stopPropagation();
              onMore();
            }}
            aria-label="More actions"
          >
            <IconMore size={19} />
          </button>
        )}
        {onPlay && !onMore && (
          <button
            className="btn icon ghost"
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            aria-label="Play"
          >
            <IconPlay size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      className={`switch${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    >
      <span className="knob" />
    </button>
  );
}

export function SettingRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="grow">
        <div className="label">{label}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  actions,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  actions?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{body}</p>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  actions,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" ref={ref} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <h3>{title}</h3>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <IconClose size={20} />
          </button>
        </div>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}
