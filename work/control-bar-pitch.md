# Control bar can pitch/roll/yaw to match hand orientation

## Problem
The control bar currently only **translates** — palm landmark #9 drives its X/Y position and
nothing else. A real puppeteer also **rotates** the control bar to lean, turn, and weight-shift
the puppet. For a side-view fighting game that expressive tilt is the difference between "a body
on strings" and "a marionette you fight with." We want the control bar to rotate to match the
hand's orientation, with the puppet responding **physically through the strings**.

This is a 2.5D game rendered orthographically in the XY plane, so out-of-plane rotations
(pitch, yaw) must be **simulated orthographically** rather than truly shown.

## Decisions (from the user, do not relitigate)
- **Scope:** in-plane **roll** *plus* simulated **pitch and yaw**. (Not cosmetic-only; not a
  full depth-driven 3D rig.)
- **Coupling:** **physical via strings** — rotating the control re-poses the torso through the
  four strings, it is not a decorative bar rotation.

## Recommended approach (the rig already supports this)
The control is a `kinematicPositionBased` body, so we can set its **full 3D pose** each frame
(`setNextKinematicRotation(quat)` alongside the existing `setNextKinematicTranslation`). The
dynamic puppet stays Z-locked, so it naturally responds to the **in-plane projection** of the
3D string geometry, and the orthographic renderer already drops Z — so foreshortening is mostly
free. Three rotations:

- **Roll** = rotation about **Z** (screen normal). Tilts the "+" in-plane: one shoulder anchor
  rises, the other drops → the torso leans. Fully visible, no faking needed.
- **Pitch** = rotation about **X** (screen-horizontal axis). The cross-bar's head/lower-back
  anchors swing out of plane (Z≠0); their **projected** vertical reach shortens → puppet nods /
  shifts weight. Bar visually foreshortens vertically.
- **Yaw** = rotation about **Y** (screen-vertical axis). The horizontal bar's shoulder anchors
  go out of plane; their projected X-span narrows → shoulder strings pull inward → puppet turns.
  Bar foreshortens horizontally.

Build the control quaternion from (roll, pitch, yaw) — pick a sane compose order (e.g.
yaw·pitch·roll) and document it.

### Hand-orientation signal (from MediaPipe landmarks)
- **Roll (in-plane):** angle of the vector wrist(0) → middle-finger MCP(9) in the image plane,
  `atan2(dy, dx)`. Robust, no depth. Filter the **sin/cos** (or the vector components) to avoid
  angle-wrap discontinuities — do **not** feed raw degrees to One Euro.
- **Pitch (fwd/back):** proxy from foreshortening — e.g. the wrist(0)→middle-MCP(9) length
  shrinks as the hand tips forward, or the wrist↔fingertip `.z` delta. Modest, heavily smoothed.
- **Yaw (turn):** proxy from the palm's horizontal span, e.g. index-MCP(5)↔pinky-MCP(17)
  distance shrinking, or their `.z` delta. Modest, heavily smoothed.

Depth (`.z`) is the noisiest signal — prefer the geometric foreshortening proxies, keep angle
ranges small, and smooth hard.

## Acceptance criteria
- [ ] Rolling the hand in-plane visibly rotates the control "+", and the **puppet leans through
      the strings** (physics, not just the drawn bar).
- [ ] Pitching the hand forward/back foreshortens the cross-bar (vertical member) and the puppet
      responds (nod / weight shift).
- [ ] Yawing the hand left/right foreshortens the horizontal bar; shoulder strings pull inward /
      the puppet turns.
- [ ] All three rotations are smoothed and feel deliberate (no twitch/jitter); One Euro position
      defaults (`minCutoff 1.5`, `beta 0.01`) are **unchanged** — new signals get their own
      smoothing.
- [ ] **Z-plane lock still holds for the dynamic puppet** (puppet body `z ≈ 0`); only the
      kinematic control leaves the plane.
- [ ] Existing translation control + fps / hand-LOST / swing / gravity instrumentation still work.
- [ ] Headless stability check: control sweeping rotation **and** translation for several seconds
      → no NaN/explosion, puppet bodies stay near `z = 0`. (Extend the `node --experimental-strip-types`
      rig sim already used in this project.)

## Relevant files
- `src/hands.ts` — add a `handPose(landmarks)` helper returning `{ roll, pitch, yaw }` proxies.
- `src/main.ts` — One Euro instances for the new signals; build the quaternion; call
  `control.setNextKinematicRotation(...)`.
- `src/draw.ts` — place the four control anchors + bar geometry using the control's **full
  quaternion** (not the Z-only `zAngle`), then orthographic-project (drop Z). Puppet bodies stay
  Z-only, so `zAngle`/`localToWorld` is still correct for them.
- `src/puppet.ts` — control stays `kinematicPositionBased` (already rotation-capable). Re-check
  rope rest lengths still behave when anchors leave the plane.
- `index.html` / `src/style.css` — optional: a "tilt range" slider + readout, matching the
  existing swing/gravity instrumentation pattern.

## Constraints
- Do **not** retune the validated One Euro **position** defaults (PRD §2).
- Keep the **deliberate/slow tempo** (PRD §2) — modest angle ranges (roll ≲ ±25°, pitch/yaw
  smaller), strong smoothing.
- Do **not** break the Z-lock on dynamic bodies — only the kinematic control may go out of plane.
- Stay on **2D canvas** (PRD §4.4); do not start the Three.js migration for this.
- This is a **feel/control capability**, not combat. Don't add fight semantics (what a lean/turn
  *does* in a duel) — that's later (PRD §7). Just the control rotation + puppet response.
