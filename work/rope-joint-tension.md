# Rope joint carries string tension (parallel to the visual chain)

## Problem

Each puppet string is a chain of 20 rigid capsule links + 21 spherical impulse joints
(`buildChain`, `src/puppet.ts`). Impulse-joint chains stretch under load because the iterative
solver spreads error across every joint. The codebase currently compensates in three coupled ways:

- `SOLVER_ITERATIONS = 48` (`src/puppet.ts`) — expensive, needed to keep 5 chains rigid.
- Heavy segments (`SEG_RAD = 0.1`, `SEG_DENSITY = 1.2`) — the "string-dominant" mass ratio the
  comment at the top of `buildChain`'s constants flags: a string outweighs the limbs it pulls.
- High per-segment damping (`DEFAULT_STRING_FRICTION = 8`) to suppress the resulting S-curve
  wobble — with the documented downside that cranking it makes strings lag the control.

Rapier (installed: `@dimforge/rapier3d-compat` 0.19.3) provides
`JointData.rope(length, anchor1, anchor2)` — a pure max-distance constraint between two bodies.

## Approach

In `attachStringForSlot` (`src/puppet.ts`), alongside the existing chain build, create ONE rope
impulse joint per string: control body → part body, anchors matching the chain endpoints
(control origin → `bind.bodyAnchor`), `length = nominalLen` (already computed by `buildChain`).
Store the joint on `PuppetString` (e.g. `ropeJoint: RAPIER_NS.ImpulseJoint | null`).

The rope joint does nothing while the string is slack (drape still comes from the chain) but
becomes the load-bearing constraint the instant the string goes taut — total length is enforced
by a single constraint that converges immediately instead of stretching across 21 joints.

## Critical: sever the rope joint on every cut path

The rope joint runs control→part directly, so chain-based cuts do NOT break it. Without this,
a "cut" string still invisibly holds the part up and cutting the head string no longer kills.

- `cutStringAtSeg` — remove the rope joint when severing the hinge.
- `cutAllIntact` — same.
- `detachString` / `detachAllStrings` — these remove segment bodies (which takes chain joints
  with them) but BOTH rope-joint endpoint bodies (control, part) survive — remove it explicitly.

## Follow-up tuning (same task, after the joint works)

The rope joint removes the reasons for the compensations; re-tune with the harness sliders and
the headless tools:

- Lower `SOLVER_ITERATIONS` (try 8–16).
- Lighten segments (`SEG_RAD`, `SEG_DENSITY` down) — fixes the string-dominant mass ratio;
  chain becomes visual drape + floor collision only.
- Likely lower `DEFAULT_STRING_FRICTION` once light segments stop wobbling.

## Acceptance criteria

- Strings no longer stretch/rubberband under fast swings (taut string = hard length cap).
- Cutting any string (swipe cut, kill collapse, detach/reset) fully releases the part — verify
  the head-string cut still kills on /game.
- No regression on the attach ritual / post-attach settle: `tools/attach-stability.ts` and
  `tools/attach-tautness.ts` still pass (these are the existing headless guards).
- Solver iterations reduced from 48 with no visible rigidity loss (document the final value).
- /characters rigs (bespoke `buildRig` puppets) attach and cut correctly too — they share
  `attachStringForSlot`.

## Relevant files

- `src/puppet.ts` — `PuppetString`, `buildChain`, `attachStringForSlot`, `cutStringAtSeg`,
  `cutAllIntact`, `detachString`, `detachAllStrings`, tuning constants.
- `src/engine.ts` — attach ritual / settle ramp (context; should need no change).
- `src/cut.ts`, `src/game.ts` — cut mechanics that call the cut/detach paths.
- `tools/attach-stability.ts`, `tools/attach-tautness.ts` — headless regression guards.

## Constraints

- Rope joint is straight-line only: it can't model a string wrapping around the center wall.
  Acceptable — the chain joints still bound the path length in that case (today's behavior).
- Do NOT replace the chain with the rope joint — the chain stays for drape, rendering, floor
  collision, and the cut interaction. The rope joint is additive.
- Keep slack behavior: rope caps max distance only; slack strings must still drape.
