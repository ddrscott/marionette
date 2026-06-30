# Finger control points can't go below the floor (but may exceed top/left/right)

## Problem
The finger control points (the kinematic string tops) are driven to the mapped fingertip position,
whose Y can map below the floor (vertical mapping spans `[0, 12]`, floor top is `FLOOR_TOP = 0.8`).
A control point pushed below the floor drags the string/part down into/under the floor. The user
wants the control points **clamped at the floor on the bottom only** — they may still go past the
**top, left, and right** screen bounds freely (no clamping there).

## The fix
In `main.ts` where each finger's world target is computed (`readFingerPositions`, both hands), clamp
only the **Y** to `>= FLOOR_TOP`:
- `pos.y = Math.max(FLOOR_TOP, VERT_CENTER + fy * VERT_SPAN * swingRange)`
- Leave `pos.x` unclamped (may exceed left/right), and don't cap the top (Y above the view is fine).
`FLOOR_TOP` is already exported from `puppet.ts`. Apply identically to both players' control points.

The puppet still crumples onto the floor when you lower your fingers (the parts collide with the
floor); the control point just rests at the floor surface instead of sinking below it.

## Acceptance Criteria
- [ ] A control point's Y never goes below `FLOOR_TOP` (drive a finger to the bottom of the frame →
      the control point stops at the floor line, doesn't sink). Verify the clamp in code + a headless
      check that a low-mapped target yields a control Y == FLOOR_TOP.
- [ ] X is NOT clamped — a finger near the screen edge still maps past the left/right bound; and a
      finger near the top still maps above the view (no top cap).
- [ ] Applies to BOTH players' control points.
- [ ] Puppet still rests/crumples on the floor when fingers are lowered (parts collide with floor).
- [ ] `npm run build` passes; brief README note if the mapping section mentions bounds.

## Relevant Files
- `src/main.ts` — `readFingerPositions` (the finger→world Y mapping); import `FLOOR_TOP` from puppet.ts.
- `README.md` — the finger-mapping / vertical-range note, if present.

## Constraints
- Only clamp the bottom (floor); do not clamp X or the top.
- Don't change the physics rig, collision groups, or the two-player logic — this is purely the
  control-point target mapping in main.ts.
- Stay on 2D canvas; no emojis. Rapier `@dimforge/rapier3d-compat@0.19.3`.
