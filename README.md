# Soundwave Web

A browser build of the [Soundwave](https://github.com/Anshug36c/sound-wave) music player, deployed
as a static site on **GitHub Pages**. It shares Soundwave's design language and ports several of its
engine algorithms, and it is **local-first**: your music and listening history never leave your
device.

**Live site:** https://anshug36c.github.io/soundwave-site/

> [!IMPORTANT]
> This is **not** the Android app and cannot be. A browser page cannot run Jetpack Compose, Kotlin,
> native C++ audio, or a Room database, and GitHub Pages serves only static files. Soundwave Web is
> an independent TypeScript/React player that plays **audio files you give it** — local files or a
> direct audio URL. It does **not** stream from YouTube/Spotify, has **no cloud AI**, and needs no
> account. See [NOTICE.md](NOTICE.md) for the exact scope and the code ported from the GPL-3.0 app.

## Features

- **Library** — import files or a whole folder, parse ID3/Vorbis/MP4/FLAC tags and cover art,
  search, sort, like, and remove. On Chromium browsers, folder access can be re-granted so the
  library survives reloads.
- **Playback** — play/pause, seek, next/previous, shuffle, repeat (off/all/one), volume, and OS
  lock-screen controls via the Media Session API.
- **Crossfade** — dual-deck Web Audio crossfade with the app's adaptive pre-arm behaviour.
- **Playback cutoff guard** — the v1.4.3 hardening that distinguishes a genuine end-of-track from a
  stream that died early, and recovers within a retry budget.
- **Parametric equalizer** — the same `ParametricEQ` biquad model as the app, with presets, a
  preamp, per-band gain, and **EqualizerAPO / AutoEq** profile import (paste one of the 8850 AutoEq
  headphone profiles and it applies live).
- **Local Taste Engine** — offline scoring of your own listening history (play time, skips, likes,
  recency, time of day) that builds a "My Taste Mix", with a per-track breakdown of *why* each track
  ranked where it did.
- **Playlists** — create, fill, play, and manage local playlists.
- **Visualiser** — live frequency bars or waveform over the artwork, from an `AnalyserNode`.
- **Themes** — dark (default), light, or system, using Soundwave's real palette.
- **Installable** — a web manifest and icons so it can be added to a home screen.

## Screenshots

Captured from the deployed site driving a real headless browser (`scripts/screenshot.mjs`).

| Library | Now playing | Equalizer | Local Taste Engine |
| --- | --- | --- | --- |
| ![Library](docs/screenshots/library.png) | ![Now playing](docs/screenshots/now-playing.png) | ![Equalizer](docs/screenshots/equalizer.png) | ![Taste](docs/screenshots/taste.png) |

## Tech

React 18 · TypeScript · Zustand · Vite · Web Audio API · IndexedDB (`idb`) · `music-metadata`.
Tests: Vitest (unit) + Playwright (browser smoke).

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173
```

Build and preview the production bundle:

```bash
npm run build
npm run preview      # http://localhost:4173
```

## Verification

One command runs the whole gate: typecheck → unit tests → production build → browser smoke tests.

```bash
npm run verify
```

- `npm run typecheck` — `tsc --noEmit`, strict.
- `npm test` — **71 unit tests** over the ported algorithms. The Taste Engine, EQ parser, play-stats
  rules, cutoff guard, and pre-arm manager are each checked against the exact behaviour of their
  Kotlin originals (constants, thresholds, and quirks included).
- `npm run smoke` — builds, serves `dist/`, and drives a real headless Chromium:
  - `scripts/smoke.mjs` — mount → import → parse → play (AudioContext running, playhead advancing)
    → Taste → EQ → Settings → persistence across reload, failing on any console error.
  - `scripts/smoke-engine.mjs` — the three end-of-track behaviours a "does it play" check can't see:
    natural-end **auto-advance**, **single** history booking (no double-count), and crossfade
    **queue-index sync**.

The same `verify` gate runs in CI on every push and pull request (see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

> Browser smoke tests need Playwright's Chromium. Locally: `npx playwright install --with-deps
> chromium`. CI installs it automatically.

## Deployment

Pushing to `main` builds and publishes to GitHub Pages via
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) (the official Pages deploy action).
`vite.config.ts` uses `base: './'` so all asset URLs are relative and the site works from its
`/<repo>/` project path.

**First-time setup:** in the repo, go to *Settings → Pages → Build and deployment → Source* and
select **GitHub Actions**.

## Project layout

```
src/
  audio/      Web Audio graph, engine (transport + crossfade), cutoff guard, pre-arm manager
  lib/        ported algorithms (taste, eq parser/presets, play-stats), types, IndexedDB, tags
  state/      Zustand store bridging UI ↔ engine ↔ storage
  ui/         shared primitives + inline SVG icon set
  components/ player bar, now-playing sheet, visualiser, toasts, import progress
  screens/    Library, Playlists, Taste, Equalizer, Settings
scripts/      fixture generator + Playwright smoke tests
```

## Privacy

No account, no analytics, no server, no network calls for playback. Library metadata, listening
history, playlists, EQ profiles, and settings live in your browser's IndexedDB. Audio bytes are not
uploaded — the page reads the files you select. Remote-URL tracks are fetched directly from their
own server (which must permit cross-origin requests).

## License

GPL-3.0 — see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). Derives from Soundwave (GPL-3.0),
itself a source copy of Echo-Music (GPL-3.0).
