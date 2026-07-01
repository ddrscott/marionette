# Play a click sound on keyboard input (kb-click.wav)

## Problem
The hand keyboard gives no audible feedback when a key registers. Play a short click
(`kb-click.wav`) on **every accepted key press**, from **both** the on-screen hand keyboard
(pinch/fist over a key) and physical-keyboard typing.

## Asset (already in the repo)
The sound is committed at **`public/assets/kb-click.wav`** (copied from the user's
`~/Downloads/kb-click.wav`, 29994 bytes). Vite serves `public/` at the site root, so at runtime the
URL is **`/assets/kb-click.wav`** (use the absolute path — scenes live under `/game`, `/characters`,
`/keyboard` subpaths, so a relative URL would resolve wrong). The worker does NOT need the Downloads
file.

## Decisions (from the user — do NOT relitigate)
- **Every accepted key clicks:** letters, digits, symbols, space, DEL, OK, AND the ?123/ABC layer
  toggle — anything that registers as a press. One sound for all keys.
- **Both input sources:** on-screen hand presses (pinch/fist) AND physical-keyboard typing.

## Where to trigger — the shared chokepoint
`HandKeyboard.pushChar` (`src/handkeyboard.ts:71`) is the single path EVERY accepted key flows
through — hand presses call it (`update`, line ~99), physical typing calls it (the scene keydown
handlers in `keyboard.ts` / `game.ts`), the pinky-pinch DELETE calls it, and the layer toggle press
will call it. So play the click **inside `pushChar`** and both sources + all keys are covered in one
place. (Note: "every accepted key" per the decision — so play for ALL pushChar invocations,
including DEL/OK/toggle, not only buffer-appends.)

## Audio system — extend `src/sound.ts` (don't add a new one)
`src/sound.ts` is the shared `AudioContext` + master-gain bus (music + sfx both hang off it, one
mute kills all). It is currently **procedural only** — `blip`/`noise`, no sample decoding — so add a
**one-shot sample player**:
- Lazy-load: `fetch("/assets/kb-click.wav")` → `ctx.decodeAudioData(...)` once, cache the
  `AudioBuffer` (kick off the fetch on `unlock()` or on first use). Guard for pre-unlock/no-ctx.
- Play: new `AudioBufferSourceNode` per call → optional `GainNode` (tune level so it sits under the
  music) → `out()` (the master bus, so **mute already applies** via `getMuted`/master gain). Let
  presses overlap naturally (fresh source each time); a small min-gap throttle (~25–40ms via the
  existing `throttled` helper) is fine to avoid a double-fire but keep it snappy.
- Expose it as e.g. `sfx.key()` (or `playSample("kbClick")`) so `handkeyboard.ts` calls one clean
  function. If a caller isn't unlocked yet, it should no-op silently (same pattern as `blip`).

## Autoplay-gesture nuance (important for /keyboard)
Browser autoplay policy: audio only starts after a **real user gesture** (pointer/key/touch) — a
webcam-driven pinch is NOT a gesture. `sound.ts` says it's imported ONLY by the game layer today, so
`/keyboard` has no audio init. To make the click work there:
- Call `unlock()` on the `/keyboard` scene's first real gesture — its physical `keydown` handler
  (`keyboard.ts`) and a `pointerdown` on the page — so subsequent HAND presses can play. Physical
  typing itself is a gesture, so those clicks will sound immediately.
- `/game` already unlocks audio (it has mute + music); its initials entry uses `HandKeyboard`, so it
  gets the click via `pushChar` for free — just confirm mute is respected and it's unlocked.

## Acceptance Criteria
- [ ] Pressing any key on the hand keyboard (letters/digits/symbols/space/DEL/OK/layer-toggle) plays
      `kb-click.wav`, on `/keyboard` and in `/game` initials entry.
- [ ] Physical-keyboard typing that feeds the same buffer also plays the click.
- [ ] The click routes through the shared master bus and is silenced by the existing mute; it doesn't
      overpower the music (level tuned).
- [ ] The sample is loaded once and cached (no re-fetch per press); rapid typing doesn't glitch.
- [ ] On `/keyboard`, audio unlocks on a real user gesture so hand-press clicks work after the first
      interaction (documented behavior — no console autoplay errors).
- [ ] `npx tsc --noEmit` + `npm run build` clean; no emojis; no new deps.

## Relevant Files
- `public/assets/kb-click.wav` — the asset (already committed).
- `src/sound.ts` — add the sample loader + one-shot player (`sfx.key()` / `playSample`); reuse
  `unlock`/`out`/`getMuted`/`throttled`.
- `src/handkeyboard.ts` — call the click in `pushChar` (line 71) so all keys + both sources fire it.
- `src/keyboard.ts` — import/unlock audio on a real gesture (keydown/pointerdown) for the test bed.
- `src/game.ts` — verify initials entry clicks and respects mute (should be automatic).
- `README.md` — note the first decoded-sample SFX + the `/assets/kb-click.wav` asset.

## Constraints
- Reuse the shared `sound.ts` bus, mute, and unlock — do NOT spin up a second AudioContext or an
  `<audio>` element; play through the master gain so one mute governs everything.
- Absolute asset URL `/assets/kb-click.wav` (subpath scenes); lazy-load + cache the AudioBuffer.
- Respect the autoplay gesture requirement; no-op silently before unlock (no thrown errors).
- Vite + TS; no new deps; no emojis.
