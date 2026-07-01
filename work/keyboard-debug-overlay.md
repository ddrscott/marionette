# Debug overlay on /keyboard — finger→thumb distances + confidence

## Problem
On `/keyboard`, gestures sometimes aren't picked up when the hand is near the **left edge** of the
camera, and there's no way to see WHY. Add a live debug overlay that surfaces the exact signals the
pinch detector uses — the per-finger distance-to-thumb and the detection confidence — so the user
can watch how far "off" the numbers get at the frame edge and diagnose the dropoff.

## The metrics to show (these are what detection ACTUALLY uses — read `src/gesture.ts`)
Pinch detection runs on MediaPipe **3D world landmarks**, size-normalized:
- `scale = dist3(world[9], world[0])` (wrist → middle-MCP), for hand-size invariance.
- For each fingertip `t ∈ {8 index, 12 middle, 16 ring, 20 pinky}`:
  `ratio = dist3(world[t], world[4 thumb]) / scale`.
- `PINCH_THRESHOLD = 0.45`; a finger counts as pinched when `ratio < 0.45` (open ≳ 0.7, real
  pinch ≲ 0.3). `pinchedFinger()` returns the CLOSEST fingertip under threshold; `isPinch()` = index
  or middle (the press); pinky (20) = DELETE.
Confidence: `hand.score` (per-hand MediaPipe confidence). The click is gated by
`CLICK_MIN_CONFIDENCE = 0.9` (`handCursor.ts`) — below that, the click is REJECTED even if the pinch
ratio passes. That gate is a prime suspect for the edge dropoff, so it must be visible.

## What the overlay should display (per detected hand, updated every frame)
- **Detected?** yes/no; handedness (Left/Right).
- **Confidence:** `score` to 2–3 decimals, with a clear PASS/FAIL vs the `0.9` gate (color it).
- **Per finger (index / middle / ring / pinky):** the normalized `ratio` to the thumb, the `0.45`
  threshold, and a highlight when `ratio < threshold` (this finger is pinched). Mark which fingers
  are "press" (index/middle) vs "delete" (pinky).
- **Resolved gesture:** what `pinchedFinger()` / `isPinch()` currently return this frame.
- **Position (to test the left-edge theory):** the hand's normalized image position — wrist `[0]` or
  palm centroid x,y in `[0,1]` — and an EDGE flag when x is near 0 (left) or 1 (right). This lets the
  user correlate "near the left edge" with a score drop / ratio noise directly.

## Implementation notes
- **Reuse the detector math — do NOT reimplement it** (numbers must match what fires the click, and
  it's DRY). Export a helper from `src/gesture.ts`, e.g. `fingerThumbRatios(world): { tip: number;
  ratio: number }[]` (and/or expose `PINCH_THRESHOLD`, `PINCH_TIPS`), then refactor `pinchedFinger` /
  `isPinch` to consume it so the overlay and the detector share one code path. Also surface
  `CLICK_MIN_CONFIDENCE` (already exported from `handCursor.ts`) for the gate line.
- **Wire it in the `/keyboard` loop.** `keyboard.ts` already has `const d = hands.latest[0] ?? null`
  every frame (line 61) carrying `world` + `score` + `handedness`. Feed `d` to the overlay right
  after `kb.update`. Handle `d === null` (show "no hand") and `d.world` missing (fall back to
  `d.landmarks`, and say which is used).
- **Presentation:** a fixed monospace HUD panel in a corner (top-left is fine; keep it off the
  keyboard/self-view). Reuse the existing debug/stat styling if there is one; teal accent, no emojis.
  Always-on is acceptable for this test bed, but prefer a small toggle (a checkbox/button, NOT a
  letter key — the keydown handler routes a–z into the buffer, so don't bind a typing key). Persist
  the toggle if trivial; not required.
- **Scope: `/keyboard` only** (the user said "the keyboard page"). Don't add it to `/game` or
  `/characters`.

## Acceptance Criteria
- [ ] `/keyboard` shows a live debug panel with: hand detected + handedness, `score` vs the 0.9 gate
      (PASS/FAIL), per-finger normalized distance-to-thumb ratios vs the 0.45 threshold (pinched
      fingers highlighted), the resolved pinch/delete gesture, and the hand's normalized position
      with a left/right EDGE flag.
- [ ] The displayed ratios and gate are computed by the SAME code the detector uses (shared helper in
      `gesture.ts`), so what the overlay shows is exactly what decides a press — verified by pinching
      and watching the highlighted finger match the actual key press.
- [ ] Moving the hand toward the left edge visibly changes the numbers (score and/or ratios), making
      the dropoff observable.
- [ ] Gracefully handles no-hand and missing-world frames; updates every frame without tanking FPS.
- [ ] Doesn't interfere with typing (no typing-key bound to the toggle), the hand cursor, or the
      landmark overlay.
- [ ] `npx tsc --noEmit` + `npm run build` clean; no emojis; no new deps.

## Relevant Files
- `src/gesture.ts` — export a shared `fingerThumbRatios()` (+ threshold/tips); refactor
  `pinchedFinger`/`isPinch` onto it so overlay == detector.
- `src/keyboard.ts` — read `d = hands.latest[0]` in the loop (61) and update the overlay; add the
  panel + optional toggle.
- `keyboard/index.html` — add the debug panel element (or inject from `keyboard.ts`).
- `src/style.css` — panel styling (reuse `.stat`/debug styles if present).
- `src/handCursor.ts` — `CLICK_MIN_CONFIDENCE` (the gate to display).

## Constraints
- Diagnostic only — this task ADDS the overlay; it does NOT change gesture thresholds or "fix" the
  edge dropoff. (Findings from it may spawn a follow-up.)
- Reuse the detector's own math (DRY); the overlay must not drift from what actually fires a click.
- `/keyboard` only; don't regress typing, the cursor, click sound, or pointer/tap input.
- Vite + TS; no new deps; no emojis.
