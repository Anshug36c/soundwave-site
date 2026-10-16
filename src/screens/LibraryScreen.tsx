/**
 * Library — mirrors the app's Library screen: your songs, on this device.
 * Music files imported into the browser (they never leave the device),
 * most recently added first. Playing a row queues the visible list in the
 * local player; phone music lives under Home/Search instead.
 */
import { useMemo, useRef, useState } from 'react';
import { sortedTracks, store } from '../state/store';
import { TrackRow, EmptyState, Modal, formatLongTime, formatBytes } from '../ui/common';
import { IconFolder, IconLink, IconMusic, IconPlus, IconSearch, IconTrash, IconUpload } from '../ui/icons';

export function LibraryScreen() {
  const state = store();
  const fileInput = useRef<HTMLInputElement>(null);

  const [urlOpen, setUrlOpen] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [menuTrack, setMenuTrack] = useState<string | null>(null);

  const visible = useMemo(
    () => sortedTracks({ tracks: state.tracks, query: state.query, sortKey: state.sortKey, sortDir: state.sortDir }),
    [state.tracks, state.query, state.sortKey, state.sortDir],
  );

  const currentId = state.queue[state.queueIndex];
  const stats = useMemo(() => summarize(state.tracks), [state.tracks]);

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await state.importFiles(Array.from(files));
    if (fileInput.current) fileInput.current.value = '';
  };

  if (state.tracks.length === 0) {
    return (
      <>
        <h1 className="page-title">Library</h1>
        <p className="page-sub">
          Music saved in this browser. Nothing is uploaded anywhere — files stay on your device.
        </p>
        <EmptyState
          icon={<IconMusic size={72} />}
          title="Your library is empty"
          body="Add music to play it here. On Chrome and Edge you can pick a whole folder and keep access to it across visits; on other browsers, add files for this session. Music from your SoundWave phone lives under Home and Search instead."
          actions={
            <>
              <button className="btn primary" onClick={() => fileInput.current?.click()}>
                <IconUpload size={18} /> Add files
              </button>
              {state.capabilities.fileSystemAccess && (
                <button className="btn" onClick={() => void state.importFromDirectory()}>
                  <IconFolder size={18} /> Open folder
                </button>
              )}
              <button className="btn ghost" onClick={() => setUrlOpen(true)}>
                <IconLink size={18} /> Add URL
              </button>
            </>
          }
        />
        <FileInput inputRef={fileInput} onPick={onPickFiles} />
        <UrlModal open={urlOpen} value={urlValue} setValue={setUrlValue} onClose={() => setUrlOpen(false)} onAdd={async () => { await state.addUrl(urlValue); setUrlValue(''); setUrlOpen(false); }} />
      </>
    );
  }

  const menuTrackObj = menuTrack ? state.tracks.find((t) => t.id === menuTrack) : null;

  return (
    <>
      <h1 className="page-title">Library</h1>
      <p className="page-sub">
        {stats.count} tracks · {formatLongTime(stats.totalSec)} · {formatBytes(stats.totalBytes)}
      </p>

      <div className="lib-toolbar">
        <div className="search" style={{ flex: 1 }}>
          <IconSearch size={18} />
          <input
            type="text"
            placeholder="Search title, artist, album…"
            value={state.query}
            onChange={(e) => state.setQuery(e.target.value)}
            aria-label="Search library"
          />
        </div>
        <button className="btn icon" onClick={() => fileInput.current?.click()} aria-label="Add files" title="Add files">
          <IconPlus size={20} />
        </button>
        {state.capabilities.fileSystemAccess && (
          <button className="btn icon" onClick={() => void state.importFromDirectory()} aria-label="Open folder" title="Open folder">
            <IconFolder size={20} />
          </button>
        )}
      </div>

      <div className="track-list">
        {visible.length === 0 ? (
          <div className="center muted" style={{ padding: 40 }}>
            No tracks match "{state.query}".
          </div>
        ) : (
          visible.map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              isActive={t.id === currentId}
              isPlaying={t.id === currentId && state.playing}
              onPlay={() => void state.playTrack(t.id, visible.map((x) => x.id))}
              onLike={() => void state.toggleLike(t.id)}
              onMore={() => setMenuTrack(t.id)}
            />
          ))
        )}
      </div>

      <FileInput inputRef={fileInput} onPick={onPickFiles} />
      <UrlModal
        open={urlOpen}
        value={urlValue}
        setValue={setUrlValue}
        onClose={() => setUrlOpen(false)}
        onAdd={async () => {
          await state.addUrl(urlValue);
          setUrlValue('');
          setUrlOpen(false);
        }}
      />

      {menuTrackObj && (
        <Modal title={menuTrackObj.title} onClose={() => setMenuTrack(null)}>
          <div className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
            {menuTrackObj.artist}
            {menuTrackObj.album ? ` · ${menuTrackObj.album}` : ''} · {formatBytes(menuTrackObj.fileSize)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn" onClick={() => { void state.playTrack(menuTrackObj.id, visible.map((x) => x.id)); setMenuTrack(null); }}>
              <IconMusic size={18} /> Play
            </button>
            <button className="btn ghost" onClick={() => setUrlOpen(true)}>
              <IconLink size={18} /> Add URL
            </button>
            <button
              className="btn"
              style={{ color: 'var(--danger)' }}
              onClick={() => { void state.removeTrack(menuTrackObj.id); setMenuTrack(null); }}
            >
              <IconTrash size={18} /> Remove from library
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function FileInput({
  inputRef,
  onPick,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  onPick: (files: FileList | null) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav,.aac"
      multiple
      style={{ display: 'none' }}
      onChange={(e) => void onPick(e.target.files)}
    />
  );
}

function UrlModal({
  open,
  value,
  setValue,
  onClose,
  onAdd,
}: {
  open: boolean;
  value: string;
  setValue: (v: string) => void;
  onClose: () => void;
  onAdd: () => void;
}) {
  if (!open) return null;
  return (
    <Modal
      title="Add a remote track"
      onClose={onClose}
      actions={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={onAdd} disabled={!value.trim()}>Add</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="url">Direct audio URL (must allow cross-origin requests)</label>
        <input
          id="url"
          type="text"
          placeholder="https://example.com/track.mp3"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onAdd(); }}
        />
      </div>
      <p className="hint" style={{ color: 'var(--text-dim)', fontSize: 12.5, lineHeight: 1.5 }}>
        Browsers only let a page decode audio from a server that sends permissive CORS headers. If a
        URL fails, that is why — local files always work.
      </p>
    </Modal>
  );
}

function summarize(tracks: { durationSec: number; fileSize: number }[]) {
  let totalSec = 0;
  let totalBytes = 0;
  for (const t of tracks) {
    totalSec += t.durationSec || 0;
    totalBytes += t.fileSize || 0;
  }
  return { count: tracks.length, totalSec, totalBytes };
}
