/**
 * App shell: top bar, routed content, mini player bar, bottom navigation, and the overlays
 * (now-playing sheet, toasts, import progress). Screen components live in ./screens.
 */
import { useEffect, useMemo } from 'react';
import { store, type Tab } from './state/store';
import { LibraryScreen } from './screens/LibraryScreen';
import { PlaylistsScreen } from './screens/PlaylistsScreen';
import { TasteScreen } from './screens/TasteScreen';
import { EqualizerScreen } from './screens/EqualizerScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { PlayerBar } from './components/PlayerBar';
import { NowPlayingSheet } from './components/NowPlayingSheet';
import { Toasts } from './components/Toasts';
import { ImportProgress } from './components/ImportProgress';
import {
  IconEqualizer,
  IconLibrary,
  IconPlaylist,
  IconSettings,
  IconTaste,
} from './ui/icons';

const NAV: { tab: Tab; label: string; Icon: typeof IconLibrary }[] = [
  { tab: 'library', label: 'Library', Icon: IconLibrary },
  { tab: 'playlists', label: 'Playlists', Icon: IconPlaylist },
  { tab: 'taste', label: 'Taste', Icon: IconTaste },
  { tab: 'equalizer', label: 'EQ', Icon: IconEqualizer },
  { tab: 'settings', label: 'Settings', Icon: IconSettings },
];

export function App() {
  const init = store((s) => s.init);
  const ready = store((s) => s.ready);
  const tab = store((s) => s.tab);
  const setTab = store((s) => s.setTab);
  const settings = store((s) => s.settings);
  const nowPlayingOpen = store((s) => s.nowPlayingOpen);
  const importing = store((s) => s.importing);

  useEffect(() => {
    void init();
  }, [init]);

  // Apply the theme to <html> so the CSS custom properties switch.
  useEffect(() => {
    const resolved =
      settings.theme === 'system'
        ? window.matchMedia?.('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : settings.theme;
    document.documentElement.setAttribute('data-theme', resolved);
  }, [settings.theme]);

  // Global keyboard shortcuts for transport (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const s = store.getState();
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          void s.togglePlay();
          break;
        case 'ArrowRight':
          if (e.shiftKey) void s.next('manual');
          else s.seekBy(5);
          break;
        case 'ArrowLeft':
          if (e.shiftKey) void s.previous();
          else s.seekBy(-5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          s.setVolume(Math.min(1, s.settings.volume + 0.05));
          break;
        case 'ArrowDown':
          e.preventDefault();
          s.setVolume(Math.max(0, s.settings.volume - 0.05));
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const screen = useMemo(() => {
    switch (tab) {
      case 'library':
        return <LibraryScreen />;
      case 'playlists':
        return <PlaylistsScreen />;
      case 'taste':
        return <TasteScreen />;
      case 'equalizer':
        return <EqualizerScreen />;
      case 'settings':
        return <SettingsScreen />;
    }
  }, [tab]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="./icon.svg" alt="Soundwave" width={30} height={30} />
          <div>
            <div>Soundwave</div>
            <div className="brand-sub">Web</div>
          </div>
        </div>
        <div className="spacer" />
      </header>

      <main className="content">{ready ? screen : <BootSkeleton />}</main>

      <PlayerBar onOpen={() => store.getState().setNowPlayingOpen(true)} />

      <nav className="bottomnav">
        {NAV.map(({ tab: t, label, Icon }) => (
          <button key={t} className={`nav-item${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            <Icon className="nav-ic" size={24} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {nowPlayingOpen && <NowPlayingSheet onClose={() => store.getState().setNowPlayingOpen(false)} />}
      {importing.active && <ImportProgress />}
      <Toasts />
    </div>
  );
}

function BootSkeleton() {
  return (
    <div style={{ padding: '40px 0' }} className="center muted">
      <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
        <img src="./icon.svg" alt="" width={26} height={26} style={{ animation: 'spin 1.2s linear infinite' }} />
        <span>Loading your library…</span>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
