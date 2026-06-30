# Direct hand→cross mapping: drive position + roll from two landmarks

## Problem
The cross currently gets ONE tracked point (palm landmark #9) for position, and its
roll/pitch/yaw are **synthesized** from hand-shape proxies (e.g. the wrist→MCP9 vector for roll).
That synthesis feels **imprecise** — the control is inferred, not measured. The fix: map actual
hand points directly onto the cross beams so the bar's pose is *measured*. The strings stay the
indirection/"rage-bait"; the **hand should directly drive the cross beams**.

This is still spike-1 control-feel work (the cross mapping), NOT finger→string control (that's
spike-2, out of scope).

## Decisions (from the user — reconciled from the clarifying answers)
- **Rigid 2-point drive.** Two hand landmarks define the horizontal bar; the cross stays a rigid
  "+". Its **position = midpoint** of the two points and its **roll = the angle of the line
  between them** — both measured, replacing the synthesized roll entirely.
- **Default point selection = dynamic extremes.** "Let's try 2 points from the furthest-left and
  furthest-right landmarks": each frame pick the landmark with min stage-x and the one with max
  stage-x (stage-x = mirrored, +x = screen-right), assign them to the left/right bar ends. This
  auto-adapts to hand orientation and maximizes spread. (Geometry stays continuous even when the
  identity of the extreme landmark switches, because min/max *position* is continuous — smooth the
  derived center/angle, not the landmark identity.)
- **Fixed binding = the configurable alternative.** Index-MCP (5) and pinky-MCP (17) — the knuckle
  row, stable and curl-proof — is the documented fixed-mode default.
- **Config now, UI later.** Expose a data-driven binding config (edit-in-code), the seam for the
  future in-app point-picker. No picker UI this pass.
- **Keep pitch on the finger-drop** signal (just added) and **leave yaw on the z-gradient** for
  now. Only position + roll change here. (Yaw *could* later come from the 2-point spread, but
  spread can't tell turn direction, so keep z-gradient for now.)
- **Keep the cross a fixed-size rigid "+".** Use the two points only for center + roll; do NOT
  scale the string anchor span with hand spread (that would restretch the shoulder-string rest
  lengths and destabilize the rig). Bar size stays `CONTROL_HALF_W/V`.

## Latency — this is half the fix (user follow-up)
> "The precision of the video overlay looks perfect, so I know the detection ability is good
> enough. Our math is causing the delay."

The raw landmark overlay (drawn unfiltered) has no perceptible lag, so detection is fast and
low-jitter. The delay the user feels is **our smoothing + derivation**, not MediaPipe. One Euro
adds the MOST lag during slow, deliberate motion (its cutoff drops as hand speed drops — exactly
the marionette tempo). So:
- **Cut the control-path latency.** Since detection jitter is low, the control needs far less
  smoothing. Raise the control One Euro `minCutoff` substantially (snappier; e.g. position from
  `1.5` toward `~4–8`, and roll similarly), or reduce to a light touch — tune so the cross tracks
  the hand nearly as immediately as the raw overlay, without visible jitter. Expose the values as
  named constants so the user can dial responsiveness vs steadiness by feel.
- **Minimize cascaded filtering.** Direct mapping already removes the synthesized-roll filter
  stage. Keep the derivation to a single smoothing stage per channel — no redundant passes.
- This **reopens the §2 smoothing defaults for the control path specifically** — the user reopened
  it with evidence. Keep the One Euro *filter*; just tune it for responsiveness now that jitter is
  low. (The filter math itself is fine; it's the conservative cutoff that adds the lag.)

## Implementation notes (suggested)
- `src/hands.ts`: add a `controlDrive(landmarks, config)` returning the two **stage-space** points
  `{ left:{x,y}, right:{x,y} }`. `config.mode === "extremes"` → scan all 21 landmarks for min/max
  mirrored-x; `"fixed"` → use `config.left`/`config.right` indices. Stage-space = mirrored x
  (`0.5 - lm.x` style, matching the existing translation mapping) and y-up.
- `src/main.ts`:
  - **Position:** `center = midpoint(left,right)`; map like today — mirror already applied in stage
    space, scale x by `swingRange`, map y into the small control-height band. Smooth with the
    EXISTING position One Euro filters (`fpx/fpy`, the validated §2 `1.5/0.01` — unchanged).
  - **Roll:** `rollAngle = atan2(left.y - right.y, right.x - left.x)` (0 when the bar is level).
    Smooth via sin/cos components (dedicated filters) to avoid wrap; clamp to `ROLL_MAX` (consider
    widening it since roll is now a direct 1:1 measurement — e.g. ~35°). Feed it to `poseControl`
    exactly as today (the control body still only rolls in-plane Z; `poseControl` is unchanged).
  - Drop the old synthesized-roll proxy use (`pose.rollX/rollY` path). Keep `pose.pitch`
    (finger-drop) and `pose.yaw` (z-gradient) feeding pitch/yaw as now.
  - `DRIVE` config object lives here (or hands.ts), e.g.
    `const DRIVE = { mode: "extremes", left: 5, right: 17 };` — the customization seam.
- `poseControl` (puppet.ts), the loose-bezier strings, and the pitch/yaw foreshortening stay as-is.

## Acceptance Criteria
- [ ] Roll is **measured** from two hand landmarks (furthest-left/right by default), not
      synthesized; rotating the hand rotates the cross ~1:1 and feels tighter/more precise.
- [ ] Position comes from the **midpoint** of the two driving points; the swing-range slider still
      scales it.
- [ ] Binding is **data-driven** with `extremes` (default) and `fixed` modes; index-MCP(5)/
      pinky-MCP(17) documented as the fixed alternative. No regression to pitch (finger-drop) or yaw.
- [ ] The control body still only rolls in-plane; dynamic-body **Z-lock holds**; loose-bezier
      strings and pitch/yaw foreshortening still work.
- [ ] `npm run build` passes clean.
- [ ] Headless check (no webcam needed): feed synthetic landmark sets to `controlDrive` +
      the roll math and assert — level hand → roll ≈ 0; tilting the two points → proportional,
      correctly-signed roll; and the derived center/angle stay **continuous across an extreme-point
      switch** (no jump). Re-run the rig stability sim (physics unchanged → should still PASS,
      `max |z| = 0`, no explosion). Report actual output.
- [ ] **Latency cut:** control-path smoothing is lightened (snappier `minCutoff`, single stage)
      so the cross tracks the hand with minimal added lag vs the raw overlay, still jitter-free;
      responsiveness exposed as named constants.
- [ ] README updated: new direct-drive mapping, the `DRIVE` config/modes, that roll is now
      measured (pitch = finger-drop, yaw = z-gradient), and the latency/smoothing tuning.

## Relevant Files
- `src/hands.ts` — `controlDrive()` + the `DRIVE` binding config (or config in main.ts).
- `src/main.ts` — position from midpoint, roll from the 2-point angle; keep pitch/yaw.
- `README.md` — document the direct mapping + config.
- (`src/puppet.ts` / `src/draw.ts` should NOT need changes — the control is still kinematic
  translate + Z-roll, and `poseControl` already handles pitch/yaw + rendering.)

## Constraints
- The §2 One Euro position defaults (`1.5/0.01`) ARE being revisited **for the control path** —
  the user reopened this with evidence (see Latency). It's fine to raise the cutoffs for snappier
  control; keep the One Euro filter itself and keep enough smoothing that there's no visible
  jitter. Make the values named constants.
- Keep roll clamped so a big hand tilt can't over-rotate the cross into instability.
- Don't break the dynamic-body Z-lock; stay on 2D canvas; no emojis in any UI.
- Don't revert the finger-drop pitch or the taut-center/loose-bezier string work.
