# Fix double finger-numbers during attach; connect strings to the moving fingertips

## Problem
During the ATTACHING phase you see two overlapping sets of the 1..5 numbered discs (`1 1 · 2 2 ·
3 3 …`). Two things draw numbered discs at once:
- `Renderer.drawPuppet` (src/draw.ts ~196-213) draws a numbered disc at each ATTACHED string's
  control point — and the attach logic FREEZES those controls at the CAPTURED pose.
- `Renderer.drawFingerPoints` (src/draw.ts ~258-271) draws numbered discs at the LIVE, moving
  fingertips (`pilot.pos` / `handStates[].pos`).
As the hand drifts from where the capture happened, the frozen set and the live set separate →
visible doubled numbers. And because the string control points are frozen at the captured
positions, the strings anchor to stale points instead of following the fingers.

Freeze points:
- Pilot: `src/pilot.ts` attaching case — `s.control.setNextKinematicTranslation({x: this.captured[s.slot].x, …})`.
- Game/Stage: `src/engine.ts:358` — `s.control.setNextKinematicTranslation({x: st.captured[s.slot].x, …})`.

## Desired outcome (from the user)
- **Only ONE set of 1..5 numbers** visible at any time during the attach.
- **Strings connect to the moving fingertips** — during attach the string control points follow
  the LIVE fingertips (not the frozen capture), so the strings visibly track the fingers.

## Fix sketch
1. **Controls follow the live fingertips during attach.** In `pilot.ts` (attaching case) and
   `engine.ts:358`, drive each attached string's control to the LIVE fingertip for that slot
   (`this.pos[slot]` / `h.pos[slot]`) instead of `captured[slot]`. Reuse the same smoothed control
   path the "running" phase uses if it reads cleaner (smoothControls / smoothDamp), so the discs
   don't jitter. KEEP the reset-on-move gate (`maxPtDist(pos, captured) > ATTACH_MARGIN → reset`)
   — capture stays the reference for "moved too far, reset", it just no longer pins the controls.
2. **Draw exactly one numbered set per phase.** Since the control discs now sit on the live
   fingertips during attach, they'd coincide with `drawFingerPoints`. Make it single: during
   waiting + attaching draw the live finger points as the one set (all 5 visible so the player
   can line up), and SUPPRESS `drawPuppet`'s numbered control discs until "running"; in running,
   the control discs (which track the driven controls) are the single set and `drawFingerPoints`
   is already off. Net: never both at once. (Alternative: keep control discs as the single set and
   drop drawFingerPoints — either is fine as long as one set shows and the strings still connect
   to the live fingers.)

## Acceptance criteria
- On /pose, /characters, and /game, during the whole attach there is exactly ONE set of the 1..5
  numbered discs (no doubling).
- The strings visibly connect to the moving fingertips during attach (control points track the
  live fingers, verified by moving the hand slightly while strings snap on).
- Attach ritual preserved: moving beyond ATTACH_MARGIN still RESETS; the no-hold-steady-dwell
  behavior is intact; the "raise a hand" / "hold still…" prompt + progress bar still show.
- Soft-string goal-drive + anti-seizure invariants unaffected (re-run tools/soft-string.ts).
- `npm run build` clean.

## Relevant files
- `src/pilot.ts` — attaching case (control freeze at `this.captured`); reuse smoothControls/drive.
- `src/engine.ts` — Stage attach state machine: control freeze at `st.captured` (~line 358), the
  attach draw block (`drawPrompt` + `drawFingerPoints` ~465-467).
- `src/pose.ts` (~247-253) and `src/characters.ts` (~191-197) — the per-frame draw block that calls
  `drawPrompt` + `drawFingerPoints` during waiting/attaching.
- `src/draw.ts` — `drawPuppet` numbered control discs (~196-213), `drawFingerPoints` (~258-271).

## Constraints
- Strings stay FORCE-DRIVEN (do NOT reintroduce physical string chains) — this is purely a
  control-position + rendering fix.
- Don't regress the attach "seizure" fix, the soft-string goal-drive, or the collision groups.
- Keep the fix consistent across the Pilot scenes and the game's Stage ritual (both freeze; both
  double-draw), so behavior matches everywhere.
