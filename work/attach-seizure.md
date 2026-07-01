# Fix attach "seizure" — puppet spasms after the strings attach before settling

## Problem
When the strings finish attaching, the puppet **seizes / does a crazy dance for a few seconds**
before the joints rest and stabilize. Only ~5% of attaches are clean; ~95% spasm first. It should
come to a stable hang without the wild oscillation. (User is fine with ANY approach that's most
stable — including a brief graceful "settle" ramp, not necessarily instant stability.)

## Root-cause analysis (this codebase — read before coding)
The attach ritual (in `src/engine.ts` `updateSlot`, phases `attaching` → `running`):
- During **`attaching`**, EVERY frame: `reposePuppet(p, st.attachTorso)` force-pins the PARTS
  (`setTranslation` + zeroes PART linvel/angvel), the controls are pinned at the captured fingertip
  positions, and the 5 strings snap on one at a time (0.2s each). Crucially, **the chain SEGMENTS are
  NOT pinned/zeroed** — they're dynamic and hang between the pinned control (top) and pinned part
  (bottom).
- The segments are **very heavy** (`SEG_RAD` is large, ~20 links, so a string weighs ~an order of
  magnitude more than the limbs). Heavy 20-link chains take **seconds** to settle and are still
  swinging when the attach animation ends.
- At the **`attaching` → `running`** transition, the per-frame pinning STOPS and the parts become
  free. The still-swinging heavy chains + any constraint inconsistency (the strings were built while
  the parts were pinned at their NEUTRAL pose, which is NOT their gravity-settled hang) dump energy
  into the newly-free bodies → the solver oscillates → the "crazy dance". The 5%-vs-95% variance is
  exactly the hallmark of sensitivity to the segments' swing velocity/phase at the release instant.

So: the puppet is released to physics with (a) mid-swing heavy chains carrying velocity, and (b) a
built geometry that fights gravity. That's the seizure.

## Candidate fixes (combine; pick the most reliable — settle ramp is expected to be the winner)
1. **Zero ALL velocities at release.** At the `attaching`→`running` transition, zero linvel+angvel of
   every PART **and every string SEGMENT** (currently only parts get zeroed, and only during
   pinning). Removes carried swing energy. Cheap, high-impact.
2. **Settle ramp (~0.5–1s after release).** Temporarily apply MUCH higher linear+angular damping to
   parts AND segments (well above the sliders), then ease back to the normal `drag` /
   `DEFAULT_STRING_FRICTION` values. Absorbs residual oscillation so the puppet "takes hold" calmly.
   `setDamping` / `setStringFriction` already exist — add a timed settle state in the engine.
3. **Calm the chains DURING attach, not just after.** In the `attaching` per-frame step, also zero
   (or heavily damp) the SEGMENT velocities each frame, so the heavy chains are already at rest by
   the time we release. (reposePuppet only touches parts today.)
4. **Reduce the build-vs-rest constraint conflict.** The strings are built with the parts pinned at
   NEUTRAL; consider building them at (or letting them relax to) the gravity-settled hang, or building
   slightly slack (`STRING_SLACK` > 1 just for the attach), so there's less tension to resolve on
   release.
5. Optional: briefly **raise `numSolverIterations`** and/or **soft-start gravity** (ramp 0→full over
   ~0.5s) during the settle window.

The heavy-segment mass ratio (`SEG_RAD`/`SEG_DENSITY` in `puppet.ts`) is the underlying aggravator,
but the user WANTS heavy rope — do NOT just lighten it to "fix" this; mitigate via velocity-zeroing +
the settle ramp. (If lightening genuinely helps, surface it as a tradeoff for the user, don't decide
it unilaterally.)

## Relevant files
- `src/engine.ts` — `updateSlot` (the `attaching`/`running` transition + per-frame pinning); add a
  short post-attach "settle" state/timer that boosts damping then relaxes, and zero velocities at
  release.
- `src/puppet.ts` — `reposePuppet` (zeros part velocities today), `setDamping` / `setStringFriction`
  (reuse for the ramp), `attachStringForSlot` (could zero a new string's seg velocities on build); the
  `SEG_*` / `STRING_SLACK` constants.

## Acceptance Criteria
- [ ] After the strings attach, the puppet settles to a stable hang **without visible seizure/spasm**
      (target: essentially every attach is clean, not 5%).
- [ ] The heavy-chain look and the attach animation (strings snapping on) are preserved; the harness,
      cut-at-joint, the match FSM, and 60fps are not regressed.
- [ ] `npx tsc --noEmit` + `npm run build` clean.

## Verify it HEADLESSLY (this project has done this before — do it here)
Write a small headless Rapier sim (Node, `@dimforge/rapier3d-compat`) that: builds a puppet, runs the
attach (build the 5 strings at a captured pose), then steps ~2–3 seconds and **measures the max part
speed / positional oscillation** over that window. Show that with the fix the post-attach max speed
decays quickly and stays bounded (no explosion / sustained oscillation), vs the current spike. This
proves stability without a webcam. State clearly that the on-screen FEEL still needs a Chrome check.

## Constraints
- Vite + TS; no new deps; no emojis. Keep the heavy strings (mitigate, don't lighten to dodge it).
- Don't change the attach TIMING/feel (0.2s per string) — the settle is a post-attach concern.
