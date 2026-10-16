/**
 * App shell — mirrors the SoundWave Android app: four main screens
 * (Home, Search, Library, Phone), a floating glass mini player, a
 * floating glass bottom navigation, the full-screen player sheet, and
 * pushed pages on top (album/artist/playlist details, Charts/Explore,
 * Stats, Settings) exactly like the app's back stack.
 */
import { useEffect, useMemo } from 'react';
import { store, type Tab } from './state/store';
import { playerSource } from './state/playerSource';
import { remoteStore } from './state/remote';
import { nextActive, prevActive, seekByActive, toggleActive } from './state/playerFacade';
import { HomeScreen } from './screens/HomeScreen';
import { SearchScreen } from './screens/SearchScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { PhoneScreen } from './screens/PhoneScreen';
import { DetailScreen } from './screens/DetailScreen';
import { BrowseScreen } from './screens/BrowseScreen';
import { StatsScreen } from './screens/StatsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { MiniPlayer } from './components/MiniPlayer';
import { FullPlayer } from './components/FullPlayer';
import { Toasts } from './components/Toasts';
import { ImportProgress } from './components/ImportProgress';
import { IconChart, IconHome, IconLibrary, IconPhone, IconSearch, IconSettings } from './ui/icons';

const NAV: { tab: Tab; label: string; Icon: typeof IconHome }[] = [
  { tab: 'home', label: 'Home', Icon: IconHome },
  { tab: 'search', label: 'Search', Icon: IconSearch },
  { tab: 'library', label: 'Library', Icon: IconLibrary },
  { tab: 'phone', label: 'Phone', Icon: IconPhone },
];

export function App() {
  const init = store((s) => s.init);
  const ready = store((s) => s.ready);
  const tab = store((s) => s.tab);
  const setTab = store((s) => s.setTab);
  const nowPlayingOpen = store((s) => s.nowPlayingOpen);
  const statsOpen = store((s) => s.statsOpen);
  const settingsOpen = store((s) => s.settingsOpen);
  const setStatsOpen = store((s) => s.setStatsOpen);
  const setSettingsOpen = store((s) => s.setSettingsOpen);
  const theme = store((s) => s.settings.theme);
  const importing = store((s) => s.importing);
  const source = playerSource((s) => s.source);
  const detailDepth = remoteStore((s) => s.detailStack.length);
  const browseDepth = remoteStore((s) => s.browseStack.length);

  useEffect(() => {
    void init();
  }, [init]);

  // Apply the chosen theme (mirrors the app's appearance setting).
  useEffect(() => {
    const resolved =
      theme === 'system'
        ? window.matchMedia?.('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : theme;
    document.documentElement.setAttribute('data-theme', resolved);
  }, [theme]);

  // One audible player at a time: starting one side pauses the other
  // side's audio element (their queues and state stay untouched).
  useEffect(() => {
    if (source === 'remote') void store.getState().pause();
    else remoteStore.getState().pausePlayback();
  }, [source]);

  // Global keyboard shortcuts for transport (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          toggleActive();
          break;
        case 'ArrowRight':
          if (e.shiftKey) nextActive();
          else seekByActive(5);
          break;
        case 'ArrowLeft':
          if (e.shiftKey) prevActive();
          else seekByActive(-5);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const screen = useMemo(() => {
    switch (tab) {
      case 'home':
        return <HomeScreen />;
      case 'search':
        return <SearchScreen />;
      case 'library':
        return <LibraryScreen />;
      case 'phone':
        return <PhoneScreen />;
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
        <button className="btn icon ghost" onClick={() => setStatsOpen(true)} aria-label="Listening stats">
          <IconChart size={21} />
        </button>
        <button className="btn icon ghost" onClick={() => setSettingsOpen(true)} aria-label="Settings">
          <IconSettings size={21} />
        </button>
      </header>

      <main className="content">{ready ? screen : <BootSkeleton />}</main>

      <MiniPlayer />

      <nav className="bottomnav" aria-label="Main">
        {NAV.map(({ tab: t, label, Icon }) => (
          <button key={t} className={`nav-item${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            <Icon className="nav-ic" size={24} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {browseDepth > 0 && <BrowseScreen />}
      {detailDepth > 0 && <DetailScreen />}
      {statsOpen && <StatsScreen />}
      {settingsOpen && <SettingsScreen />}
      {nowPlayingOpen && <FullPlayer />}
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
