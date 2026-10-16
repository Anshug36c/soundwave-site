
## Playing the phone's actual audio on the web

By default the website joins as a *participant*: it mirrors the phone's transport and plays its own
copy of the same track (matched from your local web library). If the web side doesn't have the song,
it says so instead of faking it. Two options make the web play the **phone's** audio:

### Mode B — Listen Together audio bridge (works anywhere)

The host app sends the current track's bytes over the room connection; the relay forwards and
buffers them so late joiners catch up; the web guest reassembles, decodes and plays them, locked to
the host's play/pause/seek.

1. Run your own relay: `cd server && npm start` (wss on :8080, `--path /ws`). A public relay will not
   forward audio frames — it only knows the original envelope types.
2. In the app: **Settings → Integrations → Listen Together → “Stream audio to web listeners”** (off by
   default; host-only).
3. Web: point **Relay server URL** at your `wss://` relay, join the room with the code.

Limits: only tracks the app can read locally (`content:`/`file:`) are streamed — YouTube/provider
tracks are not re-streamed (their terms + the web player uses MSE). Streaming stops on track change,
leave or disconnect.

### Mode A — the phone is the server (same Wi‑Fi, no relay)

The app can serve this website itself over `http://<phone-ip>:<port>` and hand you a **code**. Open
that address on your computer, enter the code in **Together → “Phone on this network”**, and the
browser plays the phone's audio stream directly (`<audio>` + HTTP Range), with play/pause/seek/next
sent back to the phone. No internet, no relay, no account — but the phone and computer must be on
the same network, and the page must be opened from the phone's address (an `https://` page is not
allowed to reach a plain-`http` device).

The phone serves: `GET /` (this site), `GET /api/state`, `POST /api/action`, `GET /api/audio`
(Range-capable). `scripts/phone-sim.mjs` is a Node reference implementation of that server used by
the automated smoke test (`npm run smoke:phonelink`).

### Verifying locally

- `npm run smoke:lt` — Listen Together interop incl. the audio bridge (host publishes bytes → guest
  decodes and plays, transport mirrored).
- `npm run smoke:phonelink` — Mode A against the reference phone server (code gating, playback,
  Range seek, track switch).
