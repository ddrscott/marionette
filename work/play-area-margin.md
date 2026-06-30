# Play-area margin (inset camera→play, overshoot offscreen)

## Problem
Today the full camera frame maps directly to the full canvas: a fingertip at camera-x `0` or `1`
sits exactly at the canvas edge, and you can't push a control point past the edge without moving
your hand outside the camera's view (where detection drops). The user wants a configurable **inset**
so a smaller **play area** (default the central 90% of the camera) maps to the **whole canvas**.
Then the hand reaches the canvas edge while still comfortably inside the camera frame, and pushing
into the outer margin band drives the control point **offscreen** (a little past the edges) — useful
for swinging limbs off the sides/top.

Diagram from the user: `Camera Area` (full frame) ⊃ `Play Area` (inset ~10% on all sides) → the Play
Area maps onto the full `Visible Canvas Browser`. Anything in the margin band maps beyond the canvas.

## Decisions (from the user — do NOT relitigate)
- **Config surface:** a live **sidebar slider** "play margin", range `0–25%`, **default 10%**
  (matches the existing slider pattern in `index.html` / `main.ts`).
- **Edges:** **uniform on all four sides.** Bottom still passes through the existing floor clamp, so
  in practice the visible overshoot is left/right/top; that's expected and fine.

## How it should work (math)
- Current mapping (see `src/control.ts` + `src/main.ts` `readFingerPositions`):
  `stageX(lm) = 0.5 - lm.x`, `stageY(lm) = 0.5 - lm.y` → each ∈ `[-0.5, 0.5]` across the full camera.
- Add a margin `m` (fraction, e.g. `0.10`). The play area is the central `(1 - 2m)` of the camera.
  **Rescale the centered stage coords so the play-area edge maps to the canvas edge** by dividing by
  `(1 - 2m)`:
  - `sx' = (0.5 - lm.x) / (1 - 2*m)`
  - `sy' = (0.5 - lm.y) / (1 - 2*m)`
  At `m = 0.10`, a hand at the play-area boundary (camera 0.05/0.95) maps to ±0.5 (canvas edge); a
  hand in the margin band (camera 0–0.05) maps **past** ±0.5 (offscreen). `m = 0` reproduces today's
  behavior exactly.
- The downstream pipeline is UNCHANGED: One Euro smoothing, `swingRange` scaling, the SMOOTHDAMP
  control spring, and the **bottom-only floor clamp** (`Math.max(FLOOR_TOP, …)`) all still apply
  after this rescale. Left/right/top are already free to go offscreen (no clamp) — that's what makes
  the overshoot visible.
- This **composes with** the existing `swing range` slider (which scales reach as a fraction of the
  screen); it does NOT replace it. Margin = "amplify camera→play so edges are reachable + overshoot";
  swing range = "how much of the canvas the puppet covers".

## Acceptance Criteria
- [ ] New sidebar slider "play margin" (id NOT shadowing any library global), `0–0.25` step `0.01`,
      default `0.10`, with a live value readout like the other sliders.
- [ ] The margin rescales the fingertip mapping per the math above (central `1-2m` of the camera →
      full canvas; margin band → offscreen). `m = 0` is identical to current behavior.
- [ ] Applies to BOTH axes uniformly. Existing floor clamp, swing range, One Euro, and the smoothdamp
      control spring all still work and compose correctly.
- [ ] Two-player split still works: the margin is about each hand's own fingertip→world mapping and
      must not change wrist-x side assignment or the no-crossing bindings.
- [ ] README updated (play-area margin concept + the slider + that it composes with swing range).

## Relevant Files
- `src/control.ts` — `stageX`/`stageY` (the camera→stage mapping). Cleanest place to apply the
  `/(1 - 2m)` rescale, OR thread `m` through and apply it in `main.ts`. `control.ts` currently has no
  state, so passing `m` in (or reading a module-level value set from the slider) is fine — pick the
  simplest that keeps `stageX`/`stageY` pure or near-pure.
- `src/main.ts` — `readFingerPositions` calls `stageX`/`stageY`; wire the new slider here (mirror the
  `swingRange`/`smoothTime` slider handlers) and pass the margin into the mapping.
- `index.html` — add the slider row in `<aside>`.
- `README.md` — document it.

## Constraints
- 2D canvas; **no emojis** in the UI. No DOM `id` that shadows a library global (the `dbg` footgun).
- Don't break: off-thread detection worker, two-player handedness, finger bindings, string friction,
  floor clamp, or the control **smoothing** (smoothdamp). Keep mappings cheap (runs per fingertip per
  frame).
- Runtime/webcam behavior is UNVERIFIABLE headlessly — only build/types are provable here; say so and
  have the user test the overshoot feel in Chrome.
- Guard the math: clamp `m` so `(1 - 2m) > 0` (slider max 0.25 keeps it ≥ 0.5 — safe).
