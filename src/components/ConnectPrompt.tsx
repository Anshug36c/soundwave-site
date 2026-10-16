/**
 * Shown on Home/Search when no SoundWave phone is connected: those screens
 * are powered by the phone (same catalogue as the app), so the honest
 * offline state is a connect prompt, not empty fake content.
 */
import { store } from '../state/store';
import { IconPhone } from '../ui/icons';

export function ConnectPrompt({ what }: { what: string }) {
  const setTab = store((s) => s.setTab);
  return (
    <div className="card connect-prompt">
      <div className="connect-icon">
        <IconPhone size={30} />
      </div>
      <h3>Connect SoundWave</h3>
      <p className="hint">
        {what} comes from the SoundWave app on your Android phone — the same catalogue the app
        itself searches. Connect once and everything here plays in this browser; the phone's own
        player is never touched.
      </p>
      <button className="btn primary" onClick={() => setTab('phone')}>
        Connect your phone
      </button>
    </div>
  );
}
