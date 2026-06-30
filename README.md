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
- **Hand orientation → control roll / pitch / yaw:** `handPose()` (in `hands.ts`) reads three
  decoupled proxies from the landmarks — **roll** from the in-plane wrist(0)→middle-MCP(9) vector
  (smoothed as sin/cos components to dodge angle-wrap), **pitch** from the longitudinal z-gradient
  (MCP9 vs wrist), **yaw** from the lateral z-gradient (index-MCP vs pinky-MCP). Each gets its
  **own** One Euro smoothing (roll light, pitch/yaw heavy — z is the noisiest channel); the §2
  position defaults are untouched. `poseControl()` then re-poses the bar:
  - **Roll** is a real in-plane **Z rotation** of the kinematic body — one shoulder anchor rises,
    the other drops, and the torso **leans through the strings** (genuine physics).
  - **Pitch & yaw are simulated orthographically, in-plane.** Rotating the control body *out* of
    plane would yank the z-locked lower-back rope along its one forbidden axis and blow the solver
    up (verified headlessly), so instead the control-local anchors are repositioned: `cos()`
    **foreshortens** the bar (vertical member under pitch, horizontal under yaw), and a gentle
    **nod / turn pull** (head anchor drops; shoulders swap height) moves the puppet — foreshortening
    on its own only slackens the max-length ropes, so it can't pull. Nothing ever leaves the
    plane — every body (control included) stays at `z = 0`, so the Z-lock is bulletproof.
- **Visible strings (PRD §4.1):** four strings run from the control bar to the torso —
  **head** (center), **two shoulders** (wide, angled in from the bar ends), and **lower back**.
  The string model mirrors a real marionette's load distribution:
  - **Center / head string = taut.** It bears the puppet's weight, so it hangs essentially
    straight. It's a chain of 5 light segment bodies (spherical joints): under the torso load it
    draws ~straight (rendered as the segment polyline, so it still shows its natural secondary
    pendulum swing), reads unambiguously as a string at **51.7% of viewport height**, and holds
    that fraction on resize (the renderer maps a *fixed world height* to the canvas, so any
    world-unit length is a constant fraction of pixels).
  - **Limb strings = loose.** The two shoulders and the lower back carry little load, so their
    **rope joints** are given deliberate slack (`maxLength = rest * LOOSE_ROPE_SLACK`, ~×1.22) and
    **hang loose**. The renderer draws each as a smooth **quadratic bezier** whose sag is computed
    live from the actual slack — `slack = maxLength − distance(top, end)` — with the control point
    pulled **downward under gravity** in proportion to that slack. So the curve is *dynamic*: it
    droops when relaxed and **straightens to the taut chord** as the control tilts or moves enough
    to take the slack up. The slack is tuned loose-at-rest but tight enough that deliberate
    tilt/translation still poses the limbs (the pitch/yaw feature isn't neutered).

  The four strings pose the torso — position and tilt — so you can act with intent; arms and legs
  ragdoll passively off the torso.
- **Hand overlay (PRD §4.2):** all 21 landmarks + `HAND_CONNECTIONS` drawn over the camera
  preview; control point **#9** is ringed in green with a crosshair that mirrors the control-bar
  crosshair on stage, making the hand→control mapping legible at a glance.
- **Instrumentation (PRD §4.3):** fps, hand-LOST indicator, swing-range slider, gravity slider,
  a **tilt-range slider** (master roll/pitch/yaw multiplier; `0` = flat, control only translates)
  with a live **roll/pitch/yaw degree readout**, and a string-length-% readout.

## Architecture

| File | Responsibility |
|---|---|
| `src/main.ts` | Loop: physics steps every frame; `detectForVideo` only on new camera frames (§5). Controls, control-bar position + roll/pitch/yaw mapping, the dedicated rotation One Euro filters. |
| `src/puppet.ts` | Rapier rig: control bar, four strings (head chain + 3 ropes), torso + limbs. The `ATTACH` array, world-layout constants, and `poseControl()` (roll body rotation + in-plane pitch/yaw anchor posing) live here. |
| `src/hands.ts` | MediaPipe init (CDN WASM + model), `HAND_CONNECTIONS`, and `handPose()` (roll/pitch/yaw proxies). |
| `src/draw.ts` | 2D-canvas renderer (adaptive scale) + hand-landmark overlay. |
| `src/oneEuro.ts` | One Euro filter, ported verbatim from the validated dot test. |
| `puppet-spike-1.html` | Original single-file spike, kept for reference. |

**2.5D plane lock:** every dynamic body uses `enabledTranslations(true,true,false)` +
`enabledRotations(false,false,true)`. Colliders share one collision group so puppet/string
parts never self-collide (avoids joint jitter). The control bar is kinematic and only ever
**rolls about Z** — pitch/yaw are faked in-plane (see above), so it too stays in the plane.
Verified headlessly: ~10 s of combined translation **and** roll/pitch/yaw sweeping →
`max |z| == 0` on every dynamic body, no NaN, nothing explodes, and each of the three rotations
demonstrably moves the torso.

## Tuning knobs (in `src/puppet.ts`)

- `ATTACH` — the four strings as data rows (name, control-bar anchor, torso anchor, chain|rope).
  This is the seam for the future "customize the rig" feature: edit/add rows toward the
  British 9-string set (add hands + knees). Head is a `chain` (the taut, weight-bearing ≥50%
  hero); the rest are loose `rope`s drawn as drooping beziers.
- `LOOSE_ROPE_SLACK` (`src/puppet.ts`) — how loose the limb ropes hang: `maxLength = rest *
  this`. ~1.18–1.30 reads relaxed; lower = tighter/more control authority, higher = droopier.
  Each rope exposes its `maxLength` so the renderer can compute live slack for the bezier sag.
- `ROPE_SAG_GRAVITY` (`src/draw.ts`) — how far the loose-rope bezier control point sags downward
  per world-unit of slack. Higher = droopier curve. (slack→0 ⇒ the curve straightens to the chord.)
- `CONTROL_HALF_W` / `CONTROL_HALF_V` — how wide the control bar spreads the shoulder strings
  and how far its cross bar reaches for head/lower-back.
- `WORLD_VIEW_HEIGHT`, `CONTROL_BASE_Y`, `HEAD_SEG_COUNT`, `SEG_HALF` — rig geometry and string length.
- `NOD_GAIN` / `TURN_GAIN` (`src/puppet.ts`) — how hard pitch nods the head string and yaw swings
  the shoulders. Keep them gentle (PRD §2 wants a deliberate tempo).

Rotation tunables in `src/main.ts`:

- `ROLL_MAX` / `PITCH_MAX` / `YAW_MAX` — per-axis angle caps (roll widest at ±25°; pitch/yaw ±15°).
- `ZGRAD_GAIN` / `ZGRAD_DEADZONE` — map the noisy MediaPipe z-gradients to pitch/yaw, with a small
  dead-zone so a flat palm reads as neutral.
- The four rotation One Euro filters (`frollX/Y`, `fpitch`, `fyaw`) — their own smoothing, separate
  from the validated position filters (`fpx/fpy`, which stay at `1.5 / 0.01`).
- The on-screen **tilt range** slider is a master multiplier over all three angles (live in the UI).

## Notes for the next pass

- **Render:** still 2D canvas (PRD §4.4 permits it; fastest for a feel test). Three.js
  migration is deferred to whenever spike-2 needs it — `three` is intentionally not a dep yet.
- The Rapier API was version-checked against the installed `@dimforge/rapier3d-compat@0.19.3`.
- The verdict on whether this is "legible enough to act with intent" is **Scott's hand
  judgment** (PRD §6) — it gates whether spike-2 (fingers → individual string motors) proceeds.
