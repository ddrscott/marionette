# Keep the hand-outline prompts up through ATTACHING

## Problem
The "placeholder hangers" (the grey hand-outline prompt above each puppet + the live fingertip
points) are drawn only while a puppet is in `waiting` / `steadying`. The moment the hold is satisfied
and the puppet enters `attaching`, the prompt **vanishes** — but the attach animation still takes
~1 second (5 strings × 0.2s), during which the player must KEEP HOLDING STILL. Seeing the prompt
disappear, players think they're done and **move too soon**, which trips `ATTACH_MARGIN` and **aborts
the attach**. Keep the prompt (and the hold cue) visible until the LAST string has attached.

## Fix
In the engine's per-frame render (`src/engine.ts`, the `loop` — the block that calls
`renderer.drawPrompt(...)` / `renderer.drawFingerPoints(...)`), the condition is currently
`ph === "waiting" || ph === "steadying"`. Extend it to also cover **`attaching`**, so the outline +
points stay up for the whole attach animation and only clear when the puppet reaches `running`.

Recommended polish while there:
- During `attaching`, drive the prompt's progress from the **attach animation** (e.g.
  `slotStates[s].attached / ATTACH_ORDER.length`, or elapsed `(now - attachT0)` over the total attach
  time) so the bar keeps filling toward "done" — a clear "still working, keep holding" signal — rather
  than snapping to empty/full. During `steadying` it still shows the hold progress as today.
- Keep the live fingertip points visible during `attaching` too (they're pinned at the captured pose),
  so the player sees exactly where to keep their hand. Optionally tweak the sub-label to read like
  "hold…" / "attaching…" during attach.

Note: `attached`, `attachT0`, and `ATTACH_ORDER`/attach timing live in the engine; `drawPrompt` /
`drawFingerPoints` are in `src/draw.ts`. The prompt art already sits above each puppet at its x — no
positioning change needed, just WHEN it's drawn + the progress value.

## Acceptance Criteria
- [ ] The hand outline + points stay visible from `waiting` through the entire `attaching` phase and
      only disappear once the puppet is `running` (fully attached).
- [ ] The progress indicator keeps advancing during `attaching` (doesn't blank out), cueing the player
      to keep holding until the last string attaches.
- [ ] `npx tsc --noEmit` + `npm run build` clean. `/harness` and `/game` both benefit (shared engine).

## Constraints
- Don't change the attach TIMING or the abort-on-move behavior — this is purely the visual cue
  persisting longer. Don't regress the cut mechanic, match FSM, or the harness.
- Runtime/webcam-only to fully judge the feel — state that; a browser screenshot can confirm the
  prompt renders during attaching.
