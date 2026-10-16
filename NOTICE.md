# Notices

**Soundwave Web** is a browser build of the [Soundwave](https://github.com/Anshug36c/sound-wave)
music player, hosted as a static site on GitHub Pages. It is licensed under the **GNU General
Public License v3.0** (see [LICENSE](LICENSE)), the same license as the Android app it derives from.

Soundwave is itself an independent source copy of
[Echo-Music](https://github.com/EchoMusicApp/Echo-Music) (GPL-3.0). This web build therefore sits
two derivations downstream of Echo-Music and inherits the GPL-3.0 obligations of both.

## What was ported from the Android source

Soundwave Web is **not** a compilation of the Android app — a browser cannot run Jetpack Compose,
Kotlin, native C++ audio, or a Room database. It is an independent TypeScript/React implementation
that shares Soundwave's design language and **faithfully ports several of its engine algorithms**
from the Kotlin source. Each ported module names its Android origin in a header comment:

| Web module | Ported from (Android, GPL-3.0) | What is preserved |
| --- | --- | --- |
| `src/lib/tasteScoring.ts` | `app/.../generate/LocalTasteEngine.kt`, `SongPlayStatsRepository.kt` | Every constant (`PLAY_WEIGHT` 2.0, `SKIP_PENALTY` 3.0, `LIKED_BONUS` 5.0, `RECENCY_BONUS` 1.5, `TIME_OF_DAY_BONUS` 1.3), the `ln(1 + playMinutes)` curve, time-of-day bands, `trackKeyOf`, the candidate filter, and seed selection. |
| `src/lib/playStats.ts` | `SongPlayStatsRepository.kt` + `MusicService.kt` recording rules | The 0.85 completion threshold that separates a *skip* from a *completed* play, and how play time / play count / skip count accumulate. |
| `src/audio/playbackCutoffGuard.ts` | `playback/.../PlaybackCutoffGuard.kt` | The v1.4.3 premature-end recovery: threshold, per-track retry budget, and `computeEffectiveDuration`. |
| `src/audio/adaptivePreArm.ts` | `playback/.../crossfade/AdaptivePreArmManager.kt` | Base/max lead times (20s / 35s), the 8s slow-prep threshold, proportional expansion, 2s decay, and the 5-sample window. |
| `src/lib/eqParser.ts` | `dsp-core/.../parser/ParametricEQParser.kt` | EqualizerAPO / AutoEq parsing, including its quirks (dropping `ON`-less filter lines, LSC/HSC/PK/LPQ/HPQ match order, validation bounds, `MAX_BANDS` 20). |
| `src/lib/types.ts` (EQ + stats shapes) | `dsp-core/.../models/*.kt`, `core/.../db/entities/SongPlayStatsEntity.kt` | `ParametricEQBand` (default Q 1.41), `FilterType`, `SavedEQProfile`, `ParametricEQ`, and the play-stats fields. |

The parametric EQ maps onto the Web Audio `BiquadFilterNode`, which is the same biquad model the
Android `dsp-core` module implements — so an EqualizerAPO profile produces the same curve in both
builds, and the AutoEq headphone profiles the app ships can be pasted straight into the web EQ.

## Branding

The launcher icon, dark palette (`#10172A` background, `#59D9FF` cyan, `#A58BFF` violet), and the
light/dark widget surfaces are taken from Soundwave's `res/values/colors.xml`,
`res/values-night/colors.xml`, and `res/drawable/ic_soundwave_launcher_foreground.xml`.

## What this web build deliberately does **not** do

These are browser-platform limits and Soundwave's own privacy invariants, stated plainly so the web
build is not mistaken for the app:

- **No streaming.** It cannot play YouTube/InnerTube, Spotify, or any provider stream. A static
  page has no backend, and Soundwave ships no provider credentials. It plays audio files *you*
  give it (local files, or a direct audio URL whose server allows cross-origin requests).
- **No cloud AI.** Like Soundwave, there is no AI playlist generation, no recommendation worker,
  and no AI lyric translation. The Local Taste Engine is offline and scores only your own history.
- **No Taste seed *expansion*.** On Android the engine expands its seeds through
  `YouTube.next`/`related`. With no backend, the web engine scores and orders the tracks already in
  your library; the *scoring* is identical, only the candidate pool is smaller.
- **No USB/DAC or native audio effects.** Those need the Android `:usbaudio` / `:audio-dsp` native
  layers, which have no browser equivalent here.

## Your data

Everything stays on your device in the browser's IndexedDB: library metadata, listening history,
playlists, EQ profiles, and settings. Audio bytes are **not** uploaded anywhere — there is no
server. Where the File System Access API is available (Chromium browsers), folder access can be
re-granted so your library survives reloads; elsewhere, tracks are session-scoped and the Settings
screen says so.

## Third-party libraries

React, Zustand, `idb`, `music-metadata`, Vite, Vitest, and Playwright are used under their own
licenses (MIT/BSD/Apache-2.0). They are dependencies, not part of the GPL-3.0 derivative source.
