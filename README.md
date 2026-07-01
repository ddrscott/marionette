# Marionette Fighter — Spike 2 (fingers → strings)

Control physics marionettes with your hands via webcam. **Each fingertip is a string**: five
numbered control points follow your fingers, and each pulls one body part. **Two players, one
camera** — two marionettes stand side by side and each hand drives the puppet on its side. It
answers *can a person puppeteer a hanging physics body with intent, or is it chaos?*

A puppet starts **inert** — you bring it alive with a calibration ritual: raise a hand over its
outline and hold still while the strings attach (the
[attach ritual](#bringing-a-puppet-alive-the-attach-ritual)).

> Evolved past spike-1: the rigid control bar (the "+") and its roll/pitch/yaw posing are **gone**,
> replaced by per-finger string control (the PRD §7 spike-2 increment, pulled forward). A floor was
> added, then a second player. Combat, netcode, and the puppet editor are still out of scope.

**Finger → part map** (fingers 1..5 = thumb..pinky; fingertip landmarks 4/8/12/16/20). The binding
**mirrors per hand by screen side** so neither hand's strings cross. For the hand on the right of
screen (the `FINGERS` / right-hand binding):
`1 thumb→screen-left hand · 2 index→screen-left foot · 3 middle→head · 4 ring→screen-right foot ·
5 pinky→screen-right hand`. The other hand's binding is the left/right mirror (see
[Two players & handedness](#two-players--handedness)). Move your whole hand to move the puppet;
spread/curl fingers to work the limbs. Editable later via the puppet editor (the `FINGERS` array in
`puppet.ts` is that seam).

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

- **Fingers → control points:** MediaPipe Hand Landmarker (VIDEO mode, **2 hands**, GPU) gives 21
  landmarks per hand. **Detection runs in a CLASSIC Web Worker** (off the render thread — see
  [Detection off-thread](#detection-off-thread-classic-web-worker)). Each of the five fingertips (landmarks 4/8/12/16/20) is mapped through stage
  space (`stageX/stageY` in `control.ts` — mirrored x, y-up) to a **kinematic control point**,
  smoothed by its own One Euro filter (each hand keeps its own 5 x/y filters). A **play margin** insets
  the camera→play mapping (the central `1 − 2m` of the camera fills the **whole** canvas; default `m =
  0.10` → central 80%), so the play-area edge is reachable while your hand stays comfortably inside the
  frame, and pushing into the outer margin band drives the control **offscreen** (overshoot off the
  sides/top). That mapping is then scaled by the **swing range** slider (`0–1`) — the two **compose**:
  margin amplifies camera→play so edges are reachable + overshoot, swing range sets how much of the
  canvas the puppet covers. Moving your whole hand moves all five together; spreading/curling a finger
  moves that control point alone.
  Because detection lands off-thread at a sub-60 rate, each control then **glides** to its target
  every render frame with a critically-damped **SmoothDamp** spring (the **smoothing** slider) — so
  the kinematic joint never sees a one-step teleport that would whip the puppet.
- **One string per finger:** five 10-link **chains**, one from each finger control point to its body
  part (`FINGERS`): `1 thumb→lArm`, `2 index→lLeg`, `3 middle→torso(head)`, `4 ring→rLeg`,
  `5 pinky→rArm`. The torso hangs from the head (middle-finger) string; arms and legs hang off the
  torso (spherical joints) **and** are pulled by their own finger strings — so each limb forms a
  closed loop the foldable chains accommodate. Rendered as smooth curves in the puppet's **team
  colour** (rust = left / P1, teal = right / P2); each control disc is numbered **1–5** for finger identity.
  - **Chains, not ropes:** rigid spherical-joint links make each string inextensible (no
    rubberband), but the hinges let it **fold** — it goes slack by draping and never snap-bounces.
  - **Length is captured at attach, not fixed:** a chain is built taut (`STRING_SLACK = 1.0`) to the
    straight-line span between the **captured fingertip and its part at attach time**, so the rest
    lengths match *your* arched hand — spread your fingers wider and the outer strings come out longer
    (see [the attach ritual](#bringing-a-puppet-alive-the-attach-ritual)). The puppet's home geometry
    sets the scale: the torso sits `CENTER_STRING_LEN` below the control row, so the head string spans
    **~51.7% of viewport**.
  - **Stiffness caveat:** a 10-link series chain of light links needs many solver passes
    (`SOLVER_ITERATIONS = 48`) to stay rigid; even so it stretches ~1–2% under normal motion (more
    under an aggressive yank, since the control is One-Euro-smoothed and never teleports). Watch it
    live with the debug overlay.
- **Floor:** a static shelf (`FLOOR_TOP`) near the bottom so a lowered hand rests the puppet
  on-screen instead of dropping it away. Collision groups: puppet parts hit the floor but not each
  other; string segments **also hit the floor** (so the heavy chains pile/drape on it) but still
  **pass through the puppet and through each other** (no joint jitter). Lower your fingers and the
  puppet **crumples onto the floor** (rests cleanly, ~3 mm contact, no burying); raise them and it
  lifts off.
- **Camera source + quality pickers:** two sidebar `<select>`s. **Camera** lists the available video
  input devices (`enumerateDevices()` → `kind === "videoinput"`, by `label`; "Camera N" until labels
  populate after the first permission grant). **Quality** is three fixed preset tiers —
  **480p (640×480, default)**, 720p (1280×720), 1080p (1920×1080); higher = sharper but **heavier
  detection**, so 480p is the default (fastest, matches the original hardcoded resolution). Switching
  either **re-acquires the stream live** — `hands.useSource()` stops the old tracks, `getUserMedia`s
  the new device + resolution, and swaps `video.srcObject` — **without a reload and without restarting
  the detection worker** (the worker keeps pumping frames off the same `<video>`). The **`deviceId` is
  an `exact` constraint** (a bare/`ideal` deviceId is treated as optional and silently falls back to
  the system-default camera — the switch would do nothing); **resolution stays `ideal`** so a camera
  that can't hit the tier still opens at its nearest mode. An unavailable device (saved id unplugged /
  in use) throws and falls back to the default, clearing the dead id.
  Both picks persist in `localStorage` (`handbattle.cam.deviceId`, `handbattle.cam.quality`) and are
  re-applied on boot; a saved device that's gone falls back to the default gracefully. Hot-plug
  (`devicechange`) refreshes the dropdown and re-acquires only if the active device vanished.
- **Hand overlay:** all 21 landmarks + `HAND_CONNECTIONS` over the camera preview, with the **five
  driving fingertips ringed in that player's team colour (rust / teal) and numbered 1–5**, matching
  the on-stage control points — so the finger→part mapping reads by number and the two players by hue.
- **Instrumentation:** fps, hand-LOST indicator, a **swing-range slider** (`0–1` =
  fraction of full-screen reach, default `1.0`), a **play-margin slider** (`0–0.25`, default `0.10` =
  central 80% of the camera fills the canvas; the margin band overshoots offscreen — composes with
  swing range, see [Fingers → control points](#what-it-does)), gravity slider,
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
- **String friction (chain settle):** the heavy chain segments otherwise wobble in long S-curves and
  take ~20 s to rest. The **string-friction slider** (`DEFAULT_STRING_FRICTION = 8`, `setStringFriction`)
  applies per-segment linear + angular damping — effectively "joint friction" — **decoupled from the
  puppet parts**, so cranking it calms the chains (settle ~5–8 s) *without* re-floating the fall. Low =
  floppy, high = stiff but the strings start to lag the control (sluggish). The drag slider now affects
  only the puppet parts; this one only the string segments.

## Bringing a puppet alive (the attach ritual)

A puppet doesn't come alive on its own — it sits **inert at its neutral scene-setup pose** until you
"start the engine" with a calibration ritual. Each side runs its own state machine (in `main.ts`), so
one raised hand brings one puppet alive while the other keeps waiting:

**`WAITING → STEADYING → ATTACHING → RUNNING`**

- **WAITING / STEADYING** — a grey hand **outline** (`public/hand-left.svg`, tinted `#808080`,
  mirrored for the right side) is drawn **above** the puppet, top third, ~30% of screen height. Raise
  a hand and your **live fingertip points** appear (team-coloured + numbered) so you can line them up with
  the outline. Hold still — a progress bar fills over **`HOLD_MS` (0.7 s)**; drift a fingertip more
  than **`STEADY_MARGIN`** and the hold restarts.
- **ATTACHING** — the held pose is **captured** and the five strings snap on **one at a time**
  (**`ATTACH_STRING_MS` = 0.2 s** each, head first), while the body is held crisp at its neutral pose.
  Each string is **built to the captured part→fingertip distance**, so the rest lengths match *your*
  arched hand. Move a fingertip more than **`ATTACH_MARGIN`** before it finishes and the attach
  **aborts** back to the prompt.
- **RUNNING** — normal puppeteering (the [control scheme](#what-it-does): smoothdamp + sliders).
- **Reset** — a hand gone from the camera for **`GRACE_MS` (0.5 s)** cuts the strings and snaps the
  puppet back to its neutral home pose, prompt and all. Brief detection gaps ride through.

This is why strings are **not** built in `addPuppet`: `attachStringForSlot` creates each chain at
attach time (capturing the arch), `detachAllStrings` removes them on reset, and `reposePuppet` resets
the body to its neutral home pose (per-part home offsets, upright). The two sides are fully
independent — raise one hand for a one-puppet game, or both (each attaches when its own hand is
steady).

## Two players & handedness

Two marionettes share one world and one floor, spawned side by side at `±PUPPET_X_OFFSET` (`3`). Each
hand drives the puppet on its side. The split is clean:

- **Screen side picks the puppet.** Each frame the (up to two) detected hands are ordered by **wrist
  screen-x**: the further-screen-left wrist drives the **left** puppet, the other drives the **right**
  puppet. With one hand, it drives the puppet on its half (left/right of centre); with none, both
  puppets just **hang** (their kinematic controls hold their last position). Filters stay tied to a
  screen side, so smoothing is continuous as long as each player stays on their half. Motion is **not
  clamped** (foul lines are a later, in-game rule).
- **Handedness picks the binding mirror (so strings never cross).** In the selfie-mirrored view a
  **right** hand's thumb sits screen-**left**, so the right-hand binding (`FINGERS`) sends the thumb to
  a screen-left part and the pinky to a screen-right part — nothing crosses. A **left** hand is the
  L↔R mirror (`LEFT_HAND_BINDING = mirrorBinding(FINGERS)`: swap each part's left/right side, head
  stays, same landmark order). Each control is driven **by its target part**, so whichever hand lands
  on a puppet, the screen-left fingertip always pulls a screen-left part.

  | hand | binding (thumb→ … →pinky) |
  |---|---|
  | right-hand (`FINGERS`) | thumb→L.hand, index→L.foot, middle→head, ring→R.foot, pinky→R.hand |
  | left-hand (mirror) | thumb→R.hand, index→R.foot, middle→head, ring→L.foot, pinky→L.hand |

- **⚠ The selfie-mirror flip — `HANDEDNESS_LABEL_IS_MIRRORED` in `puppet.ts`.** MediaPipe reports
  handedness (`categoryName` "Left"/"Right") from the **unmirrored** camera image, but our preview and
  stage are **selfie-mirrored**, so the label as the user sees it is usually flipped (a physically
  right hand is labelled "Left"). The constant defaults to **`true`** (invert the label before picking
  the binding) — the best guess for a mirrored view, but **unverified on a live webcam**. If on camera
  the two hands come out with **crossed strings**, flip `HANDEDNESS_LABEL_IS_MIRRORED` to `false`.

## Detection off-thread (CLASSIC Web Worker)

**Resolves PRD §5's note** — *"Detection blocks the main thread — fine for spike-1; move to a Web
Worker if frame rate suffers."* A Chrome profile showed `detectForVideo` (WASM inference) at
**~24.6 ms** per call on the render thread; with `numHands: 2` that pinned fps well below 60 (physics
is only ~1.5 ms/step — not the sim). Detection now runs in a Web Worker so the physics/render loop
never waits on inference:

- **It MUST be a CLASSIC (non-module) worker.** MediaPipe's wasm-glue loader (in `vision_bundle`)
  only handles two environments: a classic worker (loads the glue via `importScripts`) or the main
  thread (via `document.createElement("script")`). A `type:"module"` worker has **neither**
  `importScripts` *nor* `document`, so it takes the `document` branch → `document is not defined` →
  **"ModuleFactory not set"**. (The first attempt used a module worker and hit exactly that; reverted,
  commit `be33381`.) Google's own example `import`s `@mediapipe/tasks-vision` in *source*, but that
  compiles to a classic worker — which is what we run here.
- **No ESM `import` in the worker — it `importScripts` a VENDORED bundle.** A classic worker can't
  execute an ESM `import`, and in **dev** Vite serves the worker source with the `import` still in it
  (only the production build inlines it) → the worker silently never starts. So `handsWorker.ts` has
  **no** runtime import; it `importScripts` the MediaPipe **CommonJS** bundle and reads its API off an
  `exports`/`module` shim. The bundle is **vendored** at `public/vendor/mediapipe-tasks-vision-0.10.35.js`
  (a copy of the package's `vision_bundle.cjs`) and loaded **same-origin** — because jsdelivr serves
  `.cjs` with MIME `application/node`, which the browser **refuses** to `importScripts` under strict
  MIME checking. Same-origin as `.js` → `text/javascript` → runs. This path is identical in dev and
  build (no Vite dep-bundling involved). *(If you bump the tasks-vision version, re-copy the `.cjs`
  and update the filename + the `VISION_CJS`/CDN version strings in `handsWorker.ts`.)*
- **The worker body is wrapped in an IIFE.** `importScripts` evaluates the vendored bundle in the
  worker's **global** scope, and that minified bundle declares its own top-level identifiers (`g`,
  …). The production build already wraps the worker in an IIFE, but dev serves a **flat** classic
  script — so a bare top-level `const g` here would be a global-lexical binding that collides
  (*"Identifier 'g' has already been declared"*). The IIFE keeps our identifiers out of the global
  scope; only `module`/`exports` are intentionally put on `self` (the bundle resolves them there).
- **Worker init (`handsWorker.ts`):** builds the `HandLandmarker` once (VIDEO, `numHands: 2`). It
  **fetches the model in-worker** and passes it as a `modelAssetBuffer` (the official MediaPipe worker
  pattern — a model-download failure surfaces explicitly instead of dying inside `createFromOptions`),
  and tries the **GPU delegate, falling back to CPU** (GPU works on the main thread but can fail in a
  worker with no GL context; CPU in the worker still never janks the render). It then posts
  `{ ready }`, and on each posted frame runs `detectForVideo` and posts back per-hand
  `{ landmarks, handedness(categoryName) }`. The main bundle imports **zero** `@mediapipe` code.
- **No silent boot hang.** `hands.ts` attaches its message/error listeners **before** awaiting the
  camera, so the worker's near-instant `ready` (and any early error) is never lost; and `main()`
  awaits **only the camera**, not the worker — a worker that never readies leaves the puppets hanging
  with a console error, never a frozen loading screen. `pump()` no-ops until `ready`.
- **Frame transfer (main → worker):** each new camera frame, the main thread does
  `createImageBitmap(video)` and `worker.postMessage({ bmp, t }, [bmp])` — a zero-copy **transfer**.
  The worker `close()`s the bitmap after detecting (every path, no leak).
- **Backpressure — one frame in flight.** `hands.ts` won't ship a new frame until the previous
  result returns (an `inFlight` guard), and only when `video.currentTime` advanced. Newer frames are
  **dropped, not queued**, so detection runs at its own best-effort rate and never builds a backlog.
- **Decoupled loop + control smoothing (§5).** Physics steps every `requestAnimationFrame`; `main.ts`
  consumes the worker's **latest** result and re-assigns hands only when a new one arrives
  (`hands.seq`), otherwise the puppets hold their last-known hands. Because detection lands at a
  sub-60 rate, each fingertip **target** updates in bursts — so every render frame each control
  **glides** toward its target with a critically-damped **SmoothDamp** spring (the `smoothing`
  slider) instead of snapping on each detection. A snap would teleport the whole delta in one physics
  step and inject a huge one-step velocity into the kinematic joint (the puppet gets whipped); the
  velocity-continuous spring removes that acceleration spike. Re-acquiring a lost hand **snaps** (no
  cross-screen sweep); only the continuous small gaps are smoothed. Per-hand assignment by wrist-x,
  the handedness binding, `drivePuppet`, the overlay, and the 0/1/2-hand handling are unchanged.
- **Typed both directions.** `handsProtocol.ts` is a dependency-free contract; every `postMessage`
  payload is a typed `WorkerInbound`/`WorkerOutbound` (no `any` holes).

> **Not verified headlessly:** the build/types check and the worker is provably a classic script that
> `importScripts` the vendored bundle, but the actual two-hand **fps win**, worker round-trip, the
> GPU/CPU delegate, `createImageBitmap`/`getUserMedia`, and MediaPipe-in-worker runtime init all need
> a **real Chrome + webcam**. The worker logs each init stage (`[handsWorker] vision bundle loaded` →
> `model fetched` → `landmarker ready (GPU|CPU)`); a stall names the failing stage.

## Architecture

| File | Responsibility |
|---|---|
| `src/main.ts` | Loop: physics steps every frame; reads the **worker's latest** detection (re-assigns only when a new result arrives — `hands.seq`). Assigns the two hands to the two puppets by wrist screen-x, picks each hand's binding from handedness, runs each puppet's **attach-ritual state machine** (`waiting→steadying→attaching→running`), drives a RUNNING puppet's controls **by target part** (per-hand One Euro + smoothdamp), and owns the sliders. |
| `src/control.ts` | **Dependency-free** `stageX`/`stageY` (landmark → mirrored, y-up stage space; optional `m` play-margin rescales by `1/(1−2m)` around centre, default `0` = no inset). No MediaPipe import. |
| `src/puppet.ts` | Rapier rig, split **world + puppet**: `buildWorld` makes the shared world + floor; `addPuppet(world, xOffset, binding)` adds one puppet (5 controls + torso/limbs) — **strings are built later by the attach ritual**, not here. `attachStringForSlot` / `detachAllStrings` build & cut chains capturing the held arch; `reposePuppet` resets the body to its neutral home pose. The `FINGERS` binding, `mirrorBinding`, the `HANDEDNESS_LABEL_IS_MIRRORED` flip, and all rig constants live here. |
| `src/hands.ts` | **Main-thread interface** to detection: owns the camera + spawns the CLASSIC detection worker, pumps frames to it (one in flight, gated to new camera frames), and exposes the **latest** per-hand `{ landmarks, handedness }`. Also owns camera **source/quality switching** — `useSource({deviceId, tier})` stops the old tracks and re-acquires the stream (quality tiers in `QUALITY_TIERS`), `listCameras()` enumerates video inputs. Re-exports `HAND_CONNECTIONS` + the `Landmark` type — **no `@mediapipe` import on the main thread**. |
| `src/handsWorker.ts` | **CLASSIC Web Worker**, IIFE-wrapped, **no ESM import**. `importScripts` the vendored MediaPipe CJS bundle (via an `exports`/`module` shim), builds the `HandLandmarker` (VIDEO, **`numHands: 2`**, model fetched in-worker as `modelAssetBuffer`, GPU→CPU fallback), and runs `detectForVideo` on each transferred frame, posting back per-hand `{ landmarks, handedness }`. Logs each init stage. |
| `src/handsProtocol.ts` | **Dependency-free** main↔worker message contract: the typed `WorkerInbound`/`WorkerOutbound` unions, the `Landmark`/`WorkerHand` types, and a hardcoded `HAND_CONNECTIONS` (so the main bundle never pulls in `@mediapipe`). |
| `public/vendor/mediapipe-tasks-vision-0.10.35.js` | Vendored copy of `@mediapipe/tasks-vision`'s `vision_bundle.cjs`, served **same-origin** as `text/javascript` so the worker can `importScripts` it (the CDN serves `.cjs` as `application/node`, which the browser refuses). Re-copy + rename on version bumps. |
| `vite.config.ts` | Sets `worker.format = "iife"` so the **built** worker chunk is a classic script (matches the dev `{ type: "classic" }` spawn). |
| `src/draw.ts` | 2D-canvas renderer (`clear()` + per-puppet `drawPuppet()`, adaptive scale, team-coloured strings + control points, numbered 1–5) + the attach-ritual `drawPrompt()` (the `#808080`-tinted hand outline above each puppet) and `drawFingerPoints()` (live calibration points) + both-hands landmark overlay (`drawHands`) + physics-debug overlay. |
| `public/hand-left.svg` | The attach-ritual prompt art (a left hand). Re-tinted to `#808080` on an offscreen canvas at load and mirrored for the right side. |
| `src/oneEuro.ts` | One Euro filter, ported verbatim from the validated dot test. |
| `src/sound.ts` | **Game-only** procedural WebAudio SFX. One shared `AudioContext` + master `GainNode` bus; `blip`/`noise`/`throttled` primitives + a named `sfx` map (slice, clash, attach, ko, round, fight, time, win, beep). `unlock()` (gesture-gated) and `setMuted()` drive the whole graph. Plus one decoded-sample one-shot — `sfx.key()` plays cached `AudioBuffer`s (`/assets/kb-click.wav`) through the same bus. No deps. |
| `src/music.ts` | **Game-only** adaptive chiptune on a lookahead scheduler (own `setInterval`, off the render loop). Two tracks share sound.ts's bus: a calm `MENU_SONG` and an adaptive `FIGHT_SONG` (`setIntensity(0..1)` tiers instruments in + climbs tempo). `startMenu()`/`startCombat()` crossfade so a switch never overlaps. |
| `puppet-spike-1.html` | Original single-file spike, kept for reference. |

**2.5D plane lock:** every dynamic body uses `enabledTranslations(true,true,false)` +
`enabledRotations(false,false,true)`, so it stays on the z=0 plane. The control points are kinematic
(driven directly). Verified headlessly on the **two-puppet** world **with both puppets attached**
(100 chain segments + 2 sets of closed loops — at scene setup, before the attach ritual, there are no
strings): driving both puppets' controls through an aggressive sweep+spread keeps
`max |z| == 0`, `max |coord| ≈ 9.94` (no explosion), no NaN, and lowering both hands crumples each
puppet to rest cleanly on the shared floor (lowest point ≈ `0.797` vs `FLOOR_TOP 0.8` — ~3 mm
contact). The mirrored binding geometry is also asserted: ordering each hand's fingers left→right by
screen position yields part sides `[-1,-1,0,1,1]` (non-decreasing) for **both** hands — no crossing.

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
- `STRING_SLACK` (`1.0`) — chain length = `restDist * slack`, where `restDist` is the captured
  fingertip→part span **at attach time**. `1.0` = exactly that span (taut); `>1` adds fold room.
- `DEFAULT_LINEAR_DAMPING` (`0.4`, the **drag** slider) / `DEFAULT_ANGULAR_DAMPING` (`1.0`, fixed) —
  linear damping is air resistance and caps fall speed (`terminal ≈ gravity/linDamp`); kept low so
  the puppet falls naturally. Angular settles spin without touching the fall.
- `DEFAULT_PUPPET_WEIGHT` (`4`, the **weight** slider) — part mass multiplier (`setPuppetWeight`,
  applied to **both** puppets).
- `PUPPET_X_OFFSET` (`3`) — the two puppets spawn at `±` this x. `HANDEDNESS_LABEL_IS_MIRRORED`
  (`true`) — the selfie-mirror flip for the handedness label (see [Two players & handedness](#two-players--handedness); flip if strings cross on a live webcam).
- `WORLD_VIEW_HEIGHT`, `CONTROL_BASE_Y`, `CENTER_STRING_LEN`, `FLOOR_TOP` — rig geometry / floor height.

Control-path tunables in `src/main.ts`:

- `swingRange` (the **swing range** slider, `0–1`) — scales each fingertip's mapped position; `1.0`
  = full screen. `VERT_CENTER` / `VERT_SPAN` set the vertical band (full `[0,12]`).
- `playMargin` (the **play margin** slider, `0–0.25`, default `0.10`) — insets the camera→play
  mapping in `control.ts`: the centred stage coord is divided by `(1 − 2·playMargin)`, so the central
  `1 − 2m` of the camera fills the full canvas and the outer margin band maps **offscreen**
  (overshoot). Applied to **both** axes, **before** One Euro, `swingRange`, and the bottom-only floor
  clamp (so left/right/top overshoot is visible; the bottom still rests on the floor). `0` reproduces
  the old edge-to-edge behavior exactly. **Composes with** `swingRange` — it doesn't replace it. Does
  **not** affect wrist-x side assignment (that call passes no margin). Clamped so `(1 − 2m) > 0`.
- `POS_MIN_CUTOFF` (`5.0`) / `POS_BETA` — per-finger One Euro smoothing. The raw landmark overlay has
  no perceptible lag, so little smoothing is needed; higher = snappier, lower = steadier.
- `smoothTime` (`0.01`, the **smoothing** slider, seconds) — the SmoothDamp control spring's
  time-to-target. Bridges the sub-60 detection rate so controls glide instead of teleporting (no joint
  whip); `0` = snap (old behavior), higher = smoother but laggier.
- **Attach-ritual constants** (see [the attach ritual](#bringing-a-puppet-alive-the-attach-ritual)):
  `HOLD_MS` (`700`) — how long to hold still over the outline to attach; `STEADY_MARGIN` (`0.5`, world
  units) — how far a fingertip may wander and still count as "still"; `ATTACH_STRING_MS` (`200`) — per
  string in the snap-on animation; `ATTACH_MARGIN` (`0.8`) — move more than this mid-attach and it
  aborts; `GRACE_MS` (`500`) — a hand absent this long detaches + resets; `ATTACH_ORDER`
  (`[2,0,4,1,3]`) — slot order strings attach in (head first, then hands, then feet).

## Audio (game only)

`/game` has procedural WebAudio — **no new deps** (`/harness` is silent and untouched).
`src/sound.ts` synthesises every SFX from oscillators + noise bursts; `src/music.ts` is an adaptive
chiptune on a lookahead scheduler. Both share **one `AudioContext` + master gain bus**, so the mute
kills SFX *and* music at once.

- **Keyboard click (`sfx.key()`)** — the one **decoded-sample** SFX. `public/assets/kb-click.wav`
  (served at the absolute URL **`/assets/kb-click.wav`** — subpath scenes) is fetched + `decodeAudioData`'d
  **once** on `unlock()` and cached as an `AudioBuffer`; each press spins a fresh `AudioBufferSourceNode`
  through the master bus (so mute + level apply), fire-and-forget with a ~30ms throttle. It fires from
  `HandKeyboard.pushChar` — the single chokepoint for **every** accepted key (letters/digits/symbols/
  space/DEL/OK) from **both** hand presses and physical typing — plus the `?123`/`ABC` layer toggle.
  `/keyboard` (no mute button) unlocks the context on its first `pointerdown`/`keydown` and honors the
  saved mute; `/game` initials entry gets the click for free.

- **Unlock (browser autoplay policy):** WebAudio can't start without a user gesture, and this game is
  hands-only (a webcam frame is *not* a gesture). So nothing plays until the first `click` / `keydown`
  / `pointerdown`, which calls `unlock()` → `ctx.resume()`. A small "click or press any key for sound"
  hint sits by the mute button until then; the music track for the current phase kicks in on unlock.
- **Mute:** the `M` key or the corner speaker button (Lucide `volume-2`/`volume-x` icon, no emoji);
  driven through the master gain and persisted in `localStorage` (`handbattle.audio.muted`).
- **Wiring** — hooks/callbacks, kept off the render-critical path: `stage.onAttach(slot, i)` fires the
  rising attach pluck; `match.cutEvents = { onSlice, onClash }` rings the **slice** (a string cut, in
  `cut.ts`) and **clash** (the two puppets' limbs colliding — added `detectClash` proximity check in
  `cut.ts`, since the puppets share no collision group and pass through each other). `game.ts` polls
  `match` phase/announce/time deltas each frame for round/FIGHT!/K.O./TIME stingers, the win fanfare,
  final-10s beeps, menu↔fight crossfade, and adaptive fight intensity (rises as strings drop / the
  clock runs out). Every trigger is throttled so a burst can't machine-gun the synth.
- **Verification:** audio is runtime-only — **not provable headlessly**. `tsc`/`build` pass; the actual
  sound needs a real Chrome session (mic/gesture + speakers) to judge.

## Notes for the next pass

- **Puppet editor:** the `FINGERS` array is the data seam — an in-app binding picker is the next step.
- **Render:** still 2D canvas (PRD §4.4 permits it). Three.js migration deferred; `three` is not a dep.
- The Rapier API was version-checked against the installed `@dimforge/rapier3d-compat@0.19.3`.
- The verdict on "legible enough to act with intent" is **Scott's hand judgment** (PRD §6).
