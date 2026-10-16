/**
 * Playlists: create, open, play, and manage local playlists. Soundwave Web playlists are always
 * local (`isLocal: true`), matching the Android app's local playlist semantics. Opening one lists
 * its tracks with reorder-free remove, play-all and shuffle.
 */
import { useMemo, useState } from 'react';
import { store } from '../state/store';
import { TrackRow, EmptyState, Modal, formatTime } from '../ui/common';
import { IconChevronUp, IconPlaylist, IconPlus, IconShuffle, IconTrash } from '../ui/icons';

export function PlaylistsScreen() {
  const state = store();
  const [openId, setOpenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');

  const open = openId ? state.playlists.find((p) => p.id === openId) : null;
  const openTracks = useMemo(
    () => (open ? open.trackIds.map((id) => state.tracks.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => Boolean(t)) : []),
    [open, state.tracks],
  );
  const currentId = state.queue[state.queueIndex];

  if (open) {
    const totalSec = openTracks.reduce((a, t) => a + (t.durationSec || 0), 0);
    return (
      <>
        <div className="row" style={{ marginBottom: 6 }}>
          <button className="btn icon ghost" onClick={() => setOpenId(null)} aria-label="Back">
            <IconChevronUp size={22} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <div className="grow">
            <h1 className="page-title" style={{ margin: 0 }}>{open.name}</h1>
            <div className="muted" style={{ fontSize: 13 }}>
              {openTracks.length} tracks · {formatTime(totalSec)}
            </div>
          </div>
        </div>

        <div className="row wrap" style={{ gap: 8, margin: '14px 0' }}>
          <button className="btn primary sm" disabled={openTracks.length === 0} onClick={() => void state.playQueue(openTracks.map((t) => t.id), 0)}>
            Play
          </button>
          <button
            className="btn sm"
            disabled={openTracks.length === 0}
            onClick={() => {
              if (!state.settings.shuffle) state.toggleShuffle();
              void state.playQueue(openTracks.map((t) => t.id), 0);
            }}
          >
            <IconShuffle size={16} /> Shuffle
          </button>
          <button
            className="btn sm ghost"
            style={{ color: 'var(--danger)' }}
            onClick={() => { void state.deletePlaylist(open.id); setOpenId(null); }}
          >
            <IconTrash size={16} /> Delete playlist
          </button>
        </div>

        {openTracks.length === 0 ? (
          <EmptyState icon={<IconPlaylist size={64} />} title="This playlist is empty" body="Add tracks from the Library menu to fill it up." />
        ) : (
          <div className="track-list">
            {openTracks.map((t, i) => (
              <TrackRow
                key={t.id + i}
                track={t}
                index={i}
                isActive={t.id === currentId}
                isPlaying={t.id === currentId && state.playing}
                onPlay={() => void state.playTrack(t.id, openTracks.map((x) => x.id))}
                onLike={() => void state.toggleLike(t.id)}
                onMore={() => void state.removeFromPlaylist(open.id, t.id)}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Playlists</h1>
          <p className="page-sub">Local playlists, stored on this device.</p>
        </div>
        <button className="btn primary sm" onClick={() => setCreateOpen(true)}>
          <IconPlus size={17} /> New
        </button>
      </div>

      {state.playlists.length === 0 ? (
        <EmptyState
          icon={<IconPlaylist size={64} />}
          title="No playlists yet"
          body="Create one by hand, add tracks from the Library, or generate a Taste Mix from your listening history."
          actions={
            <>
              <button className="btn primary" onClick={() => setCreateOpen(true)}>
                <IconPlus size={18} /> Create playlist
              </button>
              <button className="btn" onClick={() => state.setTab('taste')}>
                Go to Taste
              </button>
            </>
          }
        />
      ) : (
        <div className="track-list">
          {state.playlists.map((p) => (
            <div key={p.id} className="track-row" onClick={() => setOpenId(p.id)}>
              <div className="art-fallback" style={{ width: 46, height: 46 }}>
                <IconPlaylist size={22} />
              </div>
              <div className="track-main">
                <div className="t-title">{p.name}</div>
                <div className="t-sub">{p.trackIds.length} tracks</div>
              </div>
              <button
                className="btn icon ghost"
                onClick={(e) => { e.stopPropagation(); void state.playQueue(p.trackIds.filter((id) => state.tracks.some((t) => t.id === id)), 0); }}
                aria-label={`Play ${p.name}`}
              >
                <IconShuffle size={18} />
              </button>
            </div>
          ))}
        </div>
      )}

      {createOpen && (
        <Modal
          title="New playlist"
          onClose={() => setCreateOpen(false)}
          actions={
            <>
              <button className="btn ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button
                className="btn primary"
                disabled={!name.trim()}
                onClick={async () => { await state.createPlaylist(name, []); setName(''); setCreateOpen(false); }}
              >
                Create
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="plname">Name</label>
            <input
              id="plname"
              type="text"
              placeholder="e.g. Road trip"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { void state.createPlaylist(name, []); setName(''); setCreateOpen(false); } }}
            />
          </div>
        </Modal>
      )}
    </>
  );
}
