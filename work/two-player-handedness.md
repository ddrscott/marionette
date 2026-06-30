# Two players from one camera (handedness-correct, no string crossing)

## Problem
Today the rig tracks ONE hand (`numHands: 1`) and uses a fixed finger→part binding that only works
for one hand orientation — the other hand makes the strings cross. We want: (1) **detect left vs
right hand correctly** (despite the selfie mirror) so the binding never crosses, and (2) **two
players from one camera** — track both hands, each driving its own marionette.

## Decisions (from the user, do not relitigate)
- **Build two-player now.** `numHands: 2`; spawn **two puppets side by side** in one world; each hand
  drives its own puppet.
- **Mirror by screen side.** The binding follows screen position so neither hand crosses:
  - Right hand (mirrored selfie): thumb is screen-LEFT → drives the screen-left parts.
    `thumb→L.hand, index→L.foot, middle→head, ring→R.foot, pinky→R.hand` (the CURRENT `FINGERS`).
  - Left hand: thumb is screen-RIGHT → the binding is the **L↔R mirror**:
    `thumb→R.hand, index→R.foot, middle→head, ring→L.foot, pinky→L.hand` (same landmark order, swap
    the part's left/right side; head stays head).
  Pick which binding to use per detected hand from its **handedness**.

## Key gotcha — handedness + the selfie mirror
MediaPipe reports handedness per hand (`result.handednesses[i][0].categoryName` = "Left"/"Right",
camera-relative, i.e. from the **unmirrored image**). Our preview and stage are **mirrored**, so the
label as-seen-by-the-user is flipped. **Determine the correct interpretation empirically** (hold up
a known hand and check), then document it. Don't trust the label's name blindly — verify which
binding (current vs mirrored) makes the strings NOT cross for each physical hand on a live webcam.
(The worker can't run the webcam — so make the flip a single clearly-named constant/boolean that
the user can flip if it's backwards, and say so in the report.)

## Architecture (suggested)
- **One world, shared floor, two puppets.** Refactor `buildRig` so the world + floor are created
  once and each puppet is added at an x-offset (e.g. ±3), with its own 5 controls + 5 strings +
  parts. E.g. `buildWorld()` → `{world}` and `addPuppet(world, RAPIER, xOffset, fingerBinding)` →
  a `Puppet` ({controls, parts, torso, strings}); the app holds `[puppetA, puppetB]`. Keep all the
  rig constants/behaviour (chains, damping, weight, collision groups) identical per puppet.
- **Hand → puppet assignment.** Two players sit side by side, so assign by **screen position**: the
  hand whose wrist is further screen-left drives the left puppet, the other drives the right puppet.
  (Robust and matches the physical setup; handedness picks the *binding mirror*, screen-side picks
  the *puppet*.) Handle 0, 1, or 2 hands gracefully — a puppet with no hand just hangs (controls hold
  last position).
- **Per-hand mapping/smoothing.** Each hand needs its own 5×(x/y) One Euro filters. The full-screen
  finger mapping is unchanged per hand (each finger → its world position); each player keeps their
  hand on their side so the puppets stay separated, but motion isn't clamped (foul lines later).
- **Rendering.** Draw both puppets. Keep the per-finger colours; optionally tint or label per player
  so it's clear which hand controls which. Overlay: ring the fingertips of BOTH hands.

## Acceptance Criteria
- [ ] `numHands: 2`; two puppets spawn side by side and each is driven by a hand.
- [ ] **Neither hand's strings cross** — the binding mirrors by handedness (verify the geometry: for
      each hand, the screen-left finger drives a screen-left part). The mirror choice is a single
      flippable constant in case the live handedness label is inverted by the mirror.
- [ ] Works with 0 / 1 / 2 hands present (no crash; absent puppet just hangs).
- [ ] Headless stability: build the two-puppet world (~100 segments), drive both sets of controls
      over a sweep → no NaN/explosion, `max |z| == 0`, both puppets rest on the floor.
- [ ] `npm run build` passes; README updated (two-player + handedness section).

## Relevant Files
- `src/hands.ts` — `numHands: 2`; expose handedness from the detection result.
- `src/puppet.ts` — refactor to world + per-puppet build; the mirrored `FINGERS` binding (a helper
  that swaps L↔R targets).
- `src/main.ts` — two hands, per-hand filters, hand→puppet assignment, drive both rigs.
- `src/draw.ts` — render both puppets; overlay both hands' fingertips.
- `README.md` — two-player / handedness docs.

## Constraints
- Keep each puppet's physics identical to the current single-puppet rig (chains, `SEG_DENSITY`,
  damping, weight slider, collision groups, `SOLVER_ITERATIONS`). The weight/drag sliders should
  apply to BOTH puppets.
- Don't break the Z-lock or stability; ~100 segments + 2 sets of closed loops — verify headless.
- Don't clamp player motion (foul lines are a later, in-game rule).
- Stay on 2D canvas; no emojis in UI. Rapier `@dimforge/rapier3d-compat@0.19.3`.
- This builds on the just-committed heavier-strings and (pending) strings-hit-floor changes — don't
  revert them.
