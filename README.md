# Marionette Fighter — Spike 2 (fingers → strings)

Control a physics marionette with your hand via webcam. **Each fingertip is a string**: five
numbered control points follow your fingers, and each pulls one body part. It answers *can a person
puppeteer a hanging physics body with intent, or is it chaos?*

> Evolved past spike-1: the rigid control bar (the "+") and its roll/pitch/yaw posing are **gone**,
> replaced by per-finger string control (the PRD §7 spike-2 increment, pulled forward). A floor was
> also added. Combat, netcode, and the puppet editor are still out of scope.

**Finger → part map** (fingers 1..5 = thumb..pinky; fingertip landmarks 4/8/12/16/20):
`1 thumb→left hand · 2 index→left foot · 3 middle→head · 4 ring→right foot · 5 pinky→right hand`.
Move your whole hand to move the puppet; spread/curl fingers to work the limbs. Editable later via
the puppet editor (the `FINGERS` array in `puppet.ts` is that seam).

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

- **control** — the device the puppeteer holds. Spike-1 used a rigid **horizontal control** (the
  cross/"+"); spike-2 drops it: the puppeteer's **fingertips** are the control points directly.
- **strings** — the threads. The British **9-string standard** runs one to each knee, hand and
  shoulder, two to the head, one to the lower back. Our five (head, two hands, two feet) are a
  subset; the puppet editor will let you re-bind fingers to any parts toward the full set.

## What it does

- **Fingers → control points:** MediaPipe Hand Landmarker (VIDEO mode, 1 hand, GPU) gives 21
  landmarks. Each of the five fingertips (`FINGERS` in `puppet.ts`: landmarks 4/8/12/16/20) is mapped
  through stage space (`stageX/stageY` in `control.ts` — mirrored x, y-up) to a **kinematic control
  point**, smoothed by its own One Euro filter. The full detection range maps to the full view, both
  axes, scaled by the **swing range** slider (`0–1`). Moving your whole hand moves all five together;
  spreading/curling a finger moves that control point alone.
- **One string per finger:** five 10-link **chains**, one from each finger control point to its body
  part (`FINGERS`): `1 thumb→lArm`, `2 index→lLeg`, `3 middle→torso(head)`, `4 ring→rLeg`,
  `5 pinky→rArm`. The torso hangs from the head (middle-finger) string; arms and legs hang off the
  torso (spherical joints) **and** are pulled by their own finger strings — so each limb forms a
  closed loop the foldable chains accommodate. Rendered as smooth curves colour-coded per finger.
  - **Chains, not ropes:** rigid spherical-joint links make each string inextensible (no
    rubberband), but the hinges let it **fold** — it goes slack by draping and never snap-bounces.
    Length = the straight-line span at the rest pose (`STRING_SLACK = 1.0`), so strings are straight
    when the hand is level. The head string spans **51.7% of viewport** (`CENTER_STRING_LEN`).
  - **Stiffness caveat:** a 10-link series chain of light links needs many solver passes
    (`SOLVER_ITERATIONS = 48`) to stay rigid; even so it stretches ~1–2% under normal motion (more
    under an aggressive yank, since the control is One-Euro-smoothed and never teleports). Watch it
    live with the debug overlay.
- **Floor:** a static shelf (`FLOOR_TOP`) near the bottom so a lowered hand rests the puppet
  on-screen instead of dropping it away. Collision groups: puppet parts hit the floor but not each
  other; string segments collide with nothing. Lower your fingers and the puppet **crumples onto
  the floor** (rests cleanly, ~3 mm contact, no burying); raise them and it lifts off.
- **Hand overlay:** all 21 landmarks + `HAND_CONNECTIONS` over the camera preview, with the **five
  driving fingertips ringed in their finger colours and numbered 1–5**, matching the on-stage
  control points — so the finger→part mapping reads at a glance.
- **Instrumentation:** fps, hand-LOST indicator, a **swing-range slider** (`0–1` =
  fraction of full-screen reach, default `1.0`), gravity slider,
  a **drag slider** (linear damping / air resistance; low = falls naturally, high =
  floats but settles fast), a **weight slider** (puppet mass multiplier; runtime `setPuppetWeight` rescales each part's
  density — heavier parts keep more tension on the chains, though they also lag more under fast
  yanks), a string-length-% readout, and a **debug: physics lines** checkbox — overlays Rapier's raw
  `world.debugRender()` segments (every chain link + joint) plus each chain's measured summed length
  vs `nominalLen` and live **stretch %** (red past 0.3%), to watch how much the chains actually give.
- **Damping / floatiness:** every dynamic body carries linear + angular damping (`DEFAULT_*_DAMPING`
  in `puppet.ts`). **Linear damping is air resistance** — it caps fall speed at terminal velocity
  ≈ `gravity / linDamp`, so too much makes the puppet *float* down. At gravity 9.8 a screen-height
  fall naturally reaches ~15 u/s, so linear damping is kept low (**0.4**, terminal ~25 → no cap →
  natural fall) and exposed as the **drag slider**; angular damping (fixed `1.0`) settles spin
  without touching the fall. Zero drag = swings forever (the slider's bottom); raising it trades
  natural fall for faster settle. Gravity sets swing *frequency*, not its decay.

## Architecture

| File | Responsibility |
|---|---|
| `src/main.ts` | Loop: physics steps every frame; `detectForVideo` only on new camera frames. Maps each fingertip → its control-point world position (per-finger One Euro filter), drives the 5 kinematic controls, and owns the sliders. |
| `src/control.ts` | **Dependency-free** `stageX`/`stageY` (landmark → mirrored, y-up stage space). No MediaPipe import. |
| `src/puppet.ts` | Rapier rig: 5 finger control points + 5 chain strings, torso + limbs, floor. The `FINGERS` binding array and all rig constants live here. |
| `src/hands.ts` | MediaPipe init (CDN WASM + model) and `HAND_CONNECTIONS`. |
| `src/draw.ts` | 2D-canvas renderer (adaptive scale, finger-coloured strings + control points) + hand-landmark overlay + physics-debug overlay. |
| `src/oneEuro.ts` | One Euro filter, ported verbatim from the validated dot test. |
| `puppet-spike-1.html` | Original single-file spike, kept for reference. |

**2.5D plane lock:** every dynamic body uses `enabledTranslations(true,true,false)` +
`enabledRotations(false,false,true)`, so it stays on the z=0 plane. The 5 control points are
kinematic (driven directly). Verified headlessly: spawn settles, a finger-spread + hand-sweep run
keeps `max |z| == 0` with no NaN/explosion, and the puppet rests cleanly on the floor.

## Tuning knobs (in `src/puppet.ts`)

- `FINGERS` — the finger→part bindings as data rows (`name`, `landmark`, `target` body, `bodyAnchor`).
  This is the seam for the puppet editor: re-point any finger at any part (`torso`/`lArm`/`rArm`/
  `lLeg`/`rLeg`). Each row becomes one kinematic control point + a chain string.
- `SEG_COUNT` (`10`) / `SEG_RAD` / `SEG_DENSITY` (`2.0`) — links per string, and how thin/heavy they
  are. More links fold finer but stretch more. `SEG_DENSITY` `2.0` makes the strings read as **heavy
  chains** (each string ≈ `0.08` total mass) while staying **below the lightest limb it pulls** at the
  default `4×` weight (arm ≈ `0.17`), so the puppet drives the strings, not the reverse. Heavier links
  also *improve* the link↔puppet mass ratio, so stretch went **down** (≈ `6.8% → 5.6%` under the same
  hard sweep). Caveat: the weight slider goes as low as `1×`, where the arm (≈ `0.04`) drops under the
  string mass and wagging can creep in — the constant is sized for the `4×` default on purpose.
- `SOLVER_ITERATIONS` (`48`) — a 10-link series chain of light links needs many passes to stay rigid
  (and the 5-string rig adds closed loops). 48 holds ~1–2% stretch at normal speed; it plateaus past
  ~48 (residual is series-compliance, not iteration count).
- `STRING_SLACK` (`1.0`) — chain length = `restDist * slack`. `1.0` = exactly the straight-line span,
  so strings are straight at the rest pose; `>1` adds fold room.
- `DEFAULT_LINEAR_DAMPING` (`0.4`, the **drag** slider) / `DEFAULT_ANGULAR_DAMPING` (`1.0`, fixed) —
  linear damping is air resistance and caps fall speed (`terminal ≈ gravity/linDamp`); kept low so
  the puppet falls naturally. Angular settles spin without touching the fall.
- `DEFAULT_PUPPET_WEIGHT` (`4`, the **weight** slider) — part mass multiplier (`setPuppetWeight`).
- `WORLD_VIEW_HEIGHT`, `CONTROL_BASE_Y`, `CENTER_STRING_LEN`, `FLOOR_TOP` — rig geometry / floor height.

Control-path tunables in `src/main.ts`:

- `swingRange` (the **swing range** slider, `0–1`) — scales each fingertip's mapped position; `1.0`
  = full screen. `VERT_CENTER` / `VERT_SPAN` set the vertical band (full `[0,12]`).
- `POS_MIN_CUTOFF` (`5.0`) / `POS_BETA` — per-finger One Euro smoothing. The raw landmark overlay has
  no perceptible lag, so little smoothing is needed; higher = snappier, lower = steadier.

## Notes for the next pass

- **Puppet editor:** the `FINGERS` array is the data seam — an in-app binding picker is the next step.
- **Render:** still 2D canvas (PRD §4.4 permits it). Three.js migration deferred; `three` is not a dep.
- The Rapier API was version-checked against the installed `@dimforge/rapier3d-compat@0.19.3`.
- The verdict on "legible enough to act with intent" is **Scott's hand judgment** (PRD §6).
