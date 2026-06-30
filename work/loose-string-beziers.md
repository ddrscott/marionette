# Taut center string; loose limb strings as bezier curves

## Problem
Right now the **center/head** string is the sagging 5-segment chain and the **limb** strings
(two shoulders, lower back) are near-taut straight rope lines (`×1.04` of rest length). That's
backwards from how a real marionette reads: the **center bears the puppet's weight so it is
taut**, while the **limb strings carry little load, so they hang loose** with visible slack.
We want to flip the visual/physical emphasis and draw the loose strings as **smooth bezier
curves** (not segmented polylines) so they read as relaxed string, not a stiff chain.

## Decisions (from the user, do not relitigate)
- **Loose limb strings = dynamic slack.** Give the shoulder + lower-back rope joints real slack
  so they visibly droop. Render them as bezier curves whose **sag is computed from the actual
  slack** — `sag ∝ (maxLength − distance(endpoints))`. A string pulls straight when the control
  tilts/moves enough to take up its slack, and droops when relaxed. It must **react to motion**,
  not be a fixed decorative curve.
- **Center string = keep the chain, render straight.** Keep the existing 5-segment head chain
  (the heavy torso tensions it so it already hangs essentially straight/taut). Just confirm it
  reads taut; preserve its ≥50%-of-viewport length and its natural secondary pendulum motion. Do
  **not** convert it to a single line.

## Sequencing — this lands AFTER the control-pitch task
The `control-bar-pitch.md` task (in progress) makes the control bar roll/pitch/yaw and pose the
puppet **through the strings**. Reconcile with it:
- Loosening the limb strings reduces their control authority. Keep enough that **tilting/moving
  the control still takes up the slack and visibly poses the limbs** — i.e. tilt must still *do
  something*. Tune the slack so it's loose at rest but engages on deliberate motion (the user
  picked "dynamic slack" precisely so tilt → slack taken up → limb posed).
- Pick up the post-pitch code: by the time this runs, `src/draw.ts` already projects control
  anchors through the bar's full quaternion (`controlPt`) and `src/puppet.ts` strings may carry
  rotation-related changes. Build on that; don't revert it.

## Implementation notes (suggested)
- **Slack (puppet.ts):** raise the rope `maxLength` multiplier for the loose strings from `×1.04`
  to something visibly loose (start ~`×1.18`–`×1.30`, tune by feel). Center chain unchanged.
- **Bezier (draw.ts):** for each loose string, endpoints are the projected control anchor (top)
  and the body anchor (`localToWorld`). Compute `slack = maxLength − dist(top,end)` (clamp ≥0).
  Draw a quadratic (or cubic) bezier whose control point is the midpoint displaced **downward**
  (gravity, −world-Y / +screen-Y) by an amount proportional to `slack` (scale by `this.scale`).
  When `slack→0` the curve becomes the straight taut line. Keep `lineCap/Join` round, same color.
  The string needs to expose its `maxLength` to the renderer (add it to the `PuppetString` /
  rope record so the draw layer can compute slack) — straightforward.
- Leave the **chain** (center) rendering as the existing polyline; under tension it draws ~straight.

## Acceptance Criteria
- [ ] The center string reads **taut/straight**; it still swings as a pendulum and is ≥50% of
      viewport height.
- [ ] The limb strings (2 shoulders, lower back) visibly **hang loose with smooth bezier curves**
      — no segmented/polyline look.
- [ ] The bezier sag is **dynamic**: a loose string straightens when the control tilts/moves to
      take up its slack and droops when relaxed (sag tracks `maxLength − endpoint distance`).
- [ ] Tilting/moving the control still **poses the puppet** (the pitch feature isn't neutered by
      the added slack).
- [ ] `npm run build` passes clean; Z-lock on dynamic bodies still holds; no explosion in the
      headless rig sim. (Extend the existing `node --experimental-strip-types` sim; report PASS.)
- [ ] README updated: describe taut-center / loose-bezier-limbs and any new slack tuning knob.

## Relevant Files
- `src/puppet.ts` — loose-string `maxLength` multipliers; expose `maxLength` on the string record.
- `src/draw.ts` — replace the straight-line rope branch with the slack-driven bezier curve.
- `README.md` — keep current (string model section).

## Constraints
- Do **not** change the validated One Euro position defaults (PRD §2).
- Keep the deliberate/slow tempo; slack should look relaxed, not floppy-to-the-floor.
- Don't break the dynamic-body Z-lock; stay on 2D canvas (no Three.js).
- Don't revert the control-pitch work that landed just before this.
