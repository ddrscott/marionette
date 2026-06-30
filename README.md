# Marionette Fighter — Spike 1

Control a physics marionette with your hand via webcam. This repo is the **control/feel
prototype** described in [`PRD.md`](./PRD.md): palm → control bar → visible strings → hanging
ragdoll. It answers one question — *can a person puppeteer a hanging physics body with
intent, or is it chaos?*

> Spike-1 scope only. Combat, fingers→strings, netcode, floor, etc. are explicitly out of
> scope (PRD §7). Don't add them here.

## Run

```sh
npm install
npm run dev        # http://localhost:5173
```

- **Use Chrome.** MediaPipe's GPU delegate is Chrome-only; Safari/Firefox fall back to slower WASM.
- Webcam needs a **secure context** — `http://localhost` qualifies, `file://` does not.
- First load fetches the model + WASM from a CDN, so allow a moment (the `loading…` overlay).

```sh
npm run build      # tsc typecheck + production bundle
npm run typecheck  # types only
```

## Terminology

We use the real marionette vocabulary ([Wikipedia](https://en.wikipedia.org/wiki/Marionette)):

- **control** / **control bar** — the device the puppeteer holds (spike-1 called it a "perch").
  We use a **horizontal control**: the cross with bars at right angles, the US style for human
  figures. Rendered as a "+" in the screen plane (a 2.5D stylization).
- **strings** — the threads. The British **9-string standard** is one to each knee, hand and
  shoulder, two to the head, one to the lower back. Our four (head, two shoulders, lower back)
  are a subset; the customization feature grows toward the full nine.

## What it does

- **Hand → control:** MediaPipe Hand Landmarker (VIDEO mode, 1 hand, GPU) → palm landmark #9
  → One Euro filter (`minCutoff 1.5`, `beta 0.01`, validated — do not retune) → kinematic
  Rapier **control bar** at the top of the view.
- **Visible strings (PRD §4.1):** four strings run from the control bar to the torso —
  **head** (center), **two shoulders** (wide, angled in from the bar ends), and **lower back**.
  The head string is a chain of 5 light segment bodies (spherical joints): it sags, swings, and
  reads unambiguously as a string, at **51.7% of viewport height**, holding on resize (the
  renderer maps a *fixed world height* to the canvas, so any world-unit length is a constant
  fraction of pixels). The other three are near-taut **rope joints** (real strings under tension
  *are* straight). The four strings pose the torso — position and tilt — so you can act with
  intent; arms and legs ragdoll passively off the torso.
- **Hand overlay (PRD §4.2):** all 21 landmarks + `HAND_CONNECTIONS` drawn over the camera
  preview; control point **#9** is ringed in green with a crosshair that mirrors the control-bar
  crosshair on stage, making the hand→control mapping legible at a glance.
- **Instrumentation (PRD §4.3):** fps, hand-LOST indicator, swing-range slider, gravity slider,
  and a live string-length-% readout.

## Architecture

| File | Responsibility |
|---|---|
| `src/main.ts` | Loop: physics steps every frame; `detectForVideo` only on new camera frames (§5). Controls, control-bar mapping. |
| `src/puppet.ts` | Rapier rig: control bar, four strings (head chain + 3 ropes), torso + limbs. The `ATTACH` array and world-layout constants live here. |
| `src/hands.ts` | MediaPipe init (CDN WASM + model) and `HAND_CONNECTIONS`. |
| `src/draw.ts` | 2D-canvas renderer (adaptive scale) + hand-landmark overlay. |
| `src/oneEuro.ts` | One Euro filter, ported verbatim from the validated dot test. |
| `puppet-spike-1.html` | Original single-file spike, kept for reference. |

**2.5D plane lock:** every dynamic body uses `enabledTranslations(true,true,false)` +
`enabledRotations(false,false,true)`. Colliders share one collision group so puppet/string
parts never self-collide (avoids joint jitter). Verified headlessly: after 5 s of control-bar
sweeping, `max |z| == 0` and nothing explodes.

## Tuning knobs (in `src/puppet.ts`)

- `ATTACH` — the four strings as data rows (name, control-bar anchor, torso anchor, chain|rope).
  This is the seam for the future "customize the rig" feature: edit/add rows toward the
  British 9-string set (add hands + knees). Head is a `chain` (the sagging ≥50% hero); the
  rest are near-taut `rope`s.
- `CONTROL_HALF_W` / `CONTROL_HALF_V` — how wide the control bar spreads the shoulder strings
  and how far its cross bar reaches for head/lower-back.
- `WORLD_VIEW_HEIGHT`, `CONTROL_BASE_Y`, `HEAD_SEG_COUNT`, `SEG_HALF` — rig geometry and string length.

## Notes for the next pass

- **Render:** still 2D canvas (PRD §4.4 permits it; fastest for a feel test). Three.js
  migration is deferred to whenever spike-2 needs it — `three` is intentionally not a dep yet.
- The Rapier API was version-checked against the installed `@dimforge/rapier3d-compat@0.19.3`.
- The verdict on whether this is "legible enough to act with intent" is **Scott's hand
  judgment** (PRD §6) — it gates whether spike-2 (fingers → individual string motors) proceeds.
