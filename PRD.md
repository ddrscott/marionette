# Marionette Fighter — Prototype PRD (Spike 1)

**Status:** active prototype · **Owner:** Scott Pierce · **Handoff target:** Claude Code
**Starting code:** `puppet-spike-1.html` (single-file spike, working). This PRD evolves it into a proper Vite/TS project and adds the changes in §4.

---

## 1. What this is

A real-time, browser-based, 1v1 **fighting game where you control a physics marionette with your hands via webcam.** Your hand is the puppeteer's control bar; the puppet is a segmented ragdoll hanging on strings. Combat (later) is about severing the opponent's strings, not bludgeoning them. Design pillar: **easy to understand, hard to master.** Virality vector: it's clippable and shareable by URL.

This PRD covers only the **control/feel prototype**, not the full game. The job of this prototype is to answer one question: *can a person puppeteer a hanging physics body with their hand and act with intent, or is it uncontrollable chaos?* The hand-tracking signal itself is already validated (see §2).

---

## 2. Validated decisions — do not relitigate

These are settled and backed by reasoning or empirical tests. Treat as fixed unless Scott reopens them.

| Decision | Choice | Why |
|---|---|---|
| Platform | **Web app** | MediaPipe Hand Landmarker is browser JS/WASM; web also gives frictionless URL sharing. |
| Render | **Three.js** | Standard web 3D. (Spike-1 uses 2D canvas; see §4.4 note.) |
| Physics | **Rapier** (`@dimforge/rapier3d-compat`) | Cross-platform, WASM, real joint constraints; joint motors are PD controllers (stiffness/damping) — the future "string tension" dial. Use `-compat` to avoid Vite WASM-plugin config. |
| Language / build | **TypeScript + Vite** | Fast HMR, types help with 3D/physics math. |
| Hand tracking | **MediaPipe Tasks Vision — Hand Landmarker**, VIDEO mode, `numHands:1` (→2 later), GPU delegate | Validated: a "dot test" confirmed it produces a steerable signal at default smoothing. Chrome-only GPU delegate; Safari falls back to slower WASM. |
| Input smoothing | **One Euro filter**, `minCutoff 1.5`, `beta 0.01` | Validated as feeling responsive-yet-steady in the dot test. Keep as defaults. |
| Dimensionality | **2.5D** = full 3D physics locked to a plane | Side-view readability + 3D ragdoll behavior. Lock Z translation + X/Y rotation per body. |
| Control metaphor | **Marionette (hand→perch→strings→body)**, not direct joint torque | More legible to learn, more novel, gives progressive-degradation combat later. Accepted cost: harder to build. |
| Combat tempo | **Deliberate / slow**, not twitchy | Slow hand motion tracks cleanly (avoids motion-blur dropouts) and fits real marionette feel. |

**Explicitly rejected:** Godot/desktop (web won), turn-based (Scott dislikes it), determinism-based rollback netcode (moot on web; deferred entirely), direct-torque ragdoll, and the zero-length pin used in spike-1 (replaced by real strings — see §4.1).

---

## 3. Current state (spike-1)

`puppet-spike-1.html` does: MediaPipe palm landmark (#9) → One Euro filter → kinematic Rapier "perch" body. A 5-part puppet (torso, 2 arms, 2 legs) of dynamic capsules linked by **spherical joints** hangs off the perch. Bodies are Z-locked to the plane. Rendered via orthographic 2D-canvas projection. Two live sliders: swing range (perch travel) and gravity (floaty↔snappy).

**Known limitation driving this iteration:** the torso is pinned *directly* to the perch (coincident anchors = zero-length, invisible string). There is nothing to see and nothing that reads as "a marionette."

---

## 4. This iteration — required changes

The prototype must let Scott **visually understand the rig**. Three required changes:

### 4.1 Visible strings, length ≥ 50% of viewport height *(required)*

- The puppet must hang from the perch on **strings that are visibly rendered** and whose length is **at least half the canvas height** (compute from viewport so it holds on resize — not a hardcoded constant).
- Move the perch to the **top of the view**; the puppet hangs in the lower portion, string(s) spanning the gap.
- Physics: strings must behave like strings (hang taut under gravity, swing as a pendulum, allow some slack), not like a rigid rod.
  - **Recommended:** model each string as a short **chain of 4–6 low-mass segment bodies** joined by spherical joints. This visibly sags/curves/swings and unambiguously reads as a string.
  - **Acceptable simpler fallback:** a single **rope joint** (`JointData.rope(maxLength, a1, a2)`) per string, drawn as a line from perch to attach point.
- **Rig:** at minimum one **center string** (perch → torso). Recommended for legibility: add **two shorter strings** perch → each hand, so raising the perch lifts the arms (classic marionette life) and Scott can see which string affects what. Keep total strings small for spike-1.

### 4.2 Hand-landmark overlay *(required)*

- Render the tracked hand over/near the camera preview: all **21 landmarks + `HandLandmarker.HAND_CONNECTIONS`** (use MediaPipe `DrawingUtils.drawConnectors` / `drawLandmarks`, or draw manually).
- Highlight **landmark #9** (the control point) distinctly, and draw a visual link/indicator showing how the hand maps to the perch position, so Scott can correlate hand motion → perch motion at a glance.

### 4.3 Keep the existing feel instrumentation

- Retain: fps readout, "hand LOST" indicator, swing-range slider, gravity slider. Keep the One Euro defaults from §2.

### 4.4 Render note

Spike-1 used 2D canvas to minimize dependencies for the dot-test phase. This iteration may **stay on 2D canvas** (faster to iterate, fully sufficient for a feel test) **or** move to Three.js now. Either is acceptable; do not block string/overlay work on the Three.js migration. If migrating, Three is orthographic side-view.

---

## 5. Technical architecture

**Loop:** decouple physics from detection. Step Rapier every `requestAnimationFrame` (fixed `world.step()`); only run `detectForVideo` on new camera frames (`video.currentTime` changed). Feed the last known smoothed palm target to the perch every physics frame.

**Control mapping:** palm landmark #9 → One Euro (x,y) → perch world position. Mirror X (selfie-natural). Map hand Y to perch height within a small range. Perch is `kinematicPositionBased`; set via `setNextKinematicTranslation` each frame. Perch Z = 0.

**Puppet bodies:** dynamic capsules, per body:
`RigidBodyDesc.dynamic().enabledTranslations(true,true,false).enabledRotations(false,false,true)` (the 2.5D plane lock). Colliders use `setCollisionGroups` so puppet/string parts **do not self-collide** (prevents joint jitter). Mass via collider density.

**Joints:** `JointData.spherical(anchor1, anchor2)` inserted with `world.createImpulseJoint(...)`. Anchors are body-local points. Place bodies at their resting hang positions on spawn so joints don't snap violently.

**API spots most likely to need version-checking** (Rapier JS API drifts across versions — verify against the installed `@dimforge/rapier3d-compat` version, currently ~0.19.x): `enabledTranslations`/`enabledRotations`, `JointData.spherical`/`.rope`, `setNextKinematicTranslation`, quaternion→Z-angle for rendering. If the puppet explodes on load or drifts off-plane, these are the first suspects.

**MediaPipe init (compat with CDN or NPM):** `FilesetResolver.forVisionTasks(wasmPath)` → `HandLandmarker.createFromOptions({ baseOptions:{ modelAssetPath, delegate:"GPU" }, runningMode:"VIDEO", numHands:1 })`. Model: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`. Detection blocks the main thread — fine for spike-1; move to a Web Worker if frame rate suffers.

---

## 6. Acceptance criteria

- [ ] Strings between perch and puppet are clearly visible and span ≥ 50% of canvas height, holding on window resize.
- [ ] Strings read as strings: they hang, swing, and respond to perch motion (not a rigid stick).
- [ ] Hand landmark skeleton (21 points + connections) renders live; control point #9 is highlighted; hand→perch mapping is visually legible.
- [ ] Moving the hand moves the perch, which swings the puppet through the strings, in real time with no perceptible added lag beyond the validated filter.
- [ ] Z-plane lock holds (no sideways drift out of the view plane).
- [ ] fps, hand-LOST, swing-range, and gravity controls all present and working.
- [ ] **The judgment call (Scott, by hand):** with strings + overlay visible, is the rig now legible enough to act with intent? This gates whether spike-2 proceeds.

---

## 7. Out of scope (and why)

Do **not** build these yet — each is a separate, later increment, and adding them now obscures the one thing this prototype tests:

- **Per-finger string control** (fingers → individual joint motors) — this is spike-2, the next increment.
- **String cutting / combat / win condition** — depends on control feel being proven first.
- **Second player, networking/netcode** — last, and easier on web than originally planned; don't touch.
- **Mass-budget build system, string-topology customization, character marketplace** — game-layer, post-prototype.
- **Floor / locomotion / standing** — spike-1 puppet hangs in space; standing is a later feel test.
- **Auto-clip / sharing / UI polish** — virality features come after the core is fun.

---

## 8. Roadmap (context only)

1. **Spike-1 (this PRD):** palm→perch, visible strings, hand overlay. Prove legible intent.
2. **Spike-2:** fingers → individual string motors (Rapier `configureMotorPosition`, stiffness = chaos dial). Prove per-limb control.
3. **Spike-3:** add a floor + the cutting mechanic; second puppet (local hotseat / two hands). Prove the duel is fun locally.
4. Later: build system (per-body mass + string topology), netcode, marketplace (shareable loadout codes + moderated cosmetics), clip export.

---

## 9. Setup / run

```
npm create vite@latest marionette -- --template vanilla-ts
cd marionette
npm i three @dimforge/rapier3d-compat @mediapipe/tasks-vision
npm run dev
```

- `@dimforge/rapier3d-compat`: `import RAPIER from "@dimforge/rapier3d-compat"; await RAPIER.init();` before use (WASM is async, inlined — no Vite WASM plugin needed).
- Webcam requires a **secure context**: Vite dev server on `http://localhost` qualifies; `file://` does not.
- Use **Chrome** during development (GPU delegate). Verify Safari/Firefox later.

---

## Appendix — reference

- **Hand landmarks:** 0 = wrist, 4 = thumb tip, 8 = index tip, 9 = middle-finger MCP (palm center, used as control point), 12/16/20 = middle/ring/pinky tips. `x,y` normalized [0,1] (y increases downward); `z` is relative depth. World landmarks available in meters if needed for finger control later.
- **Validated filter params:** One Euro `minCutoff 1.5`, `beta 0.01`.
- **Rapier joint motors (future strings):** `configureMotorPosition(targetPos, stiffness, damping)` — PD controller; stiffness is the tunable "tautness/chaos" dial.
- **Collision groups:** 32-bit, high 16 = membership, low 16 = filter. Use to make puppet/string parts ignore each other.
