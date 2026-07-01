# Smooth the UI cursor with the existing One-Euro filter (not a hand-rolled EMA)

## Problem
The palm-centroid cursor jitters frame-to-frame. `HandCursor.read()`
(`src/handCursor.ts:60-78`) averages the palm landmarks `PALM = [0, 5, 9, 13, 17]` (wrist + MCPs,
**includes the jittery landmark 9**) and returns that centroid **raw** — there is NO smoothing on
the cursor position anywhere in the pointer path. Every UI scene that points with the hand inherits
the jitter:
- `/keyboard` and `/game` initials entry (via `HandKeyboard`, `handkeyboard.ts:120`)
- `/characters` roster picker (`characters.ts:139`, `cursor.read(det, now)`)

The known-good fix for cursor-from-tracking is the **One-Euro filter**: it smooths hard when the
hand is still and stays low-latency when it's moving — exactly the pointer tradeoff. A fixed-alpha
EMA lags on fast motion; Kalman is overkill. **Do not roll a new EMA.**

## Key fact — we already HAVE One-Euro; the cursor just doesn't use it
`src/oneEuro.ts` is a real One-Euro filter (adaptive cutoff `minCutoff + beta*|velocity|`, not a
fixed-alpha EMA). The **game** hand→puppet path already runs every fingertip through it
(`engine.ts` / `pilot.ts` `ffx`/`ffy`). The **UI cursor does not** — that's the whole gap. This task
is: apply the existing `OneEuro` to the cursor centroid. It is NOT "add a filter from scratch."

## Decision (from the user — do NOT relitigate)
Use the **One-Euro filter** (the existing `src/oneEuro.ts`) for the cursor. No home-rolled EMA, no
`smoothDamp`/spring for the pointer (a prior brief loosely said "0.01 damping" — supersede that:
One-Euro is the pointer-correct choice and it already exists).

## Implementation notes
- In `HandCursor`, hold two `OneEuro` instances (one for `x`, one for `y`) and filter the mapped
  centroid inside `read(hand, now)` before returning — pass `now` (ms) as the timestamp so the
  adaptive cutoff sees real dt. Filter the final normalized/remapped `x`,`y` (2 scalars); don't
  filter each landmark separately.
- Reset the filters when the hand goes absent (the `!hand` branch) so a re-acquired hand doesn't
  ease in from a stale position — cleanest is to null out / recreate the filter state on absence
  (add a small `reset()` to `OneEuro`, or reconstruct the two instances).
- **Params:** reuse `OneEuro`'s validated defaults (`minCutoff 1.5`, `beta 0.01`) as the starting
  point — `oneEuro.ts` marks them as a settled §2 decision. If the POINTER wants slightly different
  responsiveness than the puppet, expose optional constructor params on `HandCursor`
  (`minCutoff`/`beta`) and tune by feel; do NOT edit the shared `oneEuro.ts` defaults (they're
  protected — the game relies on them).
- The filter must NOT gate/delay the click: the confidence gate + fist/pinch edge logic stays as-is;
  only the RETURNED `x`,`y` are smoothed. The click gestures already keep the centroid stable, so
  smoothing position won't add click latency.

## Acceptance Criteria
- [ ] The cursor position on `/keyboard`, `/game` initials, and `/characters` is visibly steadier
      when the hand is held still, with no noticeable added lag when the hand moves quickly
      (One-Euro's still-vs-moving tradeoff).
- [ ] Smoothing uses the existing `src/oneEuro.ts` `OneEuro` (two instances, x/y) — no new EMA/spring
      is introduced for the pointer.
- [ ] Filter state resets on hand loss so a re-acquired hand snaps to its true position (no glide
      from a stale point).
- [ ] Click behavior (fist / pinch, confidence gate, cooldown, pinky-pinch DELETE) is unchanged and
      not delayed by the position smoothing.
- [ ] Shared `src/oneEuro.ts` defaults are untouched; `npx tsc --noEmit` + `npm run build` clean.

## Relevant Files
- `src/handCursor.ts` — `HandCursor.read` (60-78): add the two `OneEuro` instances + reset-on-absence.
- `src/oneEuro.ts` — REUSE as-is (maybe add a tiny `reset()`); do NOT change its defaults.
- `src/handkeyboard.ts` (120) / `src/characters.ts` (139) — consumers; should need no change (they
  get the smoothed `cs.x`,`cs.y` for free). Verify both still feel right.
- `src/keyboard.ts`, `src/game.ts` — mounts to sanity-check.

## Constraints
- One-Euro only for the pointer; no hand-rolled EMA and no `smoothDamp` on the cursor.
- Don't retune or edit the shared `oneEuro.ts` §2 defaults (the game path depends on them).
- Don't add click latency — smooth POSITION only, leave the gesture edges alone.
- Vite + TS; no new deps; no emojis.
