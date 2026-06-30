# Marionette Fighter — Spike 1

Control a physics marionette with your hand via webcam. This repo is the **control/feel
prototype** described in [`PRD.md`](./PRD.md): palm → perch → visible strings → hanging
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

## What it does

- **Hand → perch:** MediaPipe Hand Landmarker (VIDEO mode, 1 hand, GPU) → palm landmark #9
  → One Euro filter (`minCutoff 1.5`, `beta 0.01`, validated — do not retune) → kinematic
  Rapier "perch" body at the top of the view.
- **Visible strings (PRD §4.1):** the puppet hangs from the perch on a **center string** built
  as a chain of 5 light segment bodies (spherical joints) — it sags, swings, and reads
  unambiguously as a string. Length is **51.7% of the viewport height** and holds on resize
  (the renderer maps a *fixed world height* to the canvas, so any world-unit length is a
  constant fraction of pixels). Two **rope-joint control lines** run perch→each arm, so
  raising the perch lifts the limbs (classic marionette life).
- **Hand overlay (PRD §4.2):** all 21 landmarks + `HAND_CONNECTIONS` drawn over the camera
  preview; control point **#9** is ringed in green with a crosshair that mirrors the perch
  crosshair on stage, making the hand→perch mapping legible at a glance.
- **Instrumentation (PRD §4.3):** fps, hand-LOST indicator, swing-range slider, gravity slider,
  and a live string-length-% readout.

## Architecture

| File | Responsibility |
|---|---|
| `src/main.ts` | Loop: physics steps every frame; `detectForVideo` only on new camera frames (§5). Controls, perch mapping. |
| `src/puppet.ts` | Rapier rig: perch, center-string chain, torso + limbs, hand-string ropes. All world-layout constants live here. |
| `src/hands.ts` | MediaPipe init (CDN WASM + model) and `HAND_CONNECTIONS`. |
| `src/draw.ts` | 2D-canvas renderer (adaptive scale) + hand-landmark overlay. |
| `src/oneEuro.ts` | One Euro filter, ported verbatim from the validated dot test. |
| `puppet-spike-1.html` | Original single-file spike, kept for reference. |

**2.5D plane lock:** every dynamic body uses `enabledTranslations(true,true,false)` +
`enabledRotations(false,false,true)`. Colliders share one collision group so puppet/string
parts never self-collide (avoids joint jitter). Verified headlessly: after 4 s of perch
sweeping, `max |z| == 0` and nothing explodes.

## Tuning knobs (in `src/puppet.ts`)

- `ENABLE_HAND_STRINGS` — the perch→arm rope "control lines". Off = center string only.
  (The closed perch→arm→torso→chain→perch loop is the first suspect if anything ever gets
  unstable; ropes are soft/one-sided with a little slack specifically to keep it calm.)
- `WORLD_VIEW_HEIGHT`, `PERCH_BASE_Y`, `SEG_COUNT`, `SEG_HALF` — rig geometry and string length.

## Notes for the next pass

- **Render:** still 2D canvas (PRD §4.4 permits it; fastest for a feel test). Three.js
  migration is deferred to whenever spike-2 needs it — `three` is intentionally not a dep yet.
- The Rapier API was version-checked against the installed `@dimforge/rapier3d-compat@0.19.3`.
- The verdict on whether this is "legible enough to act with intent" is **Scott's hand
  judgment** (PRD §6) — it gates whether spike-2 (fingers → individual string motors) proceeds.
