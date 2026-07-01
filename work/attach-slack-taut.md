# Near-straight strings at attach — normalize the capture to a reference hand pose

## Problem
When the strings first attach to a puppet there is a lot of **slack** in the chains (see the
user's screenshot: the strings visibly sag/bow between the control cross and the attach points).
That slack is a **dead zone** — the puppeteer has to move enough to take up the slack before the
puppet responds, which makes the puppet hard to manipulate right after attach.

**This is NOT a rendering problem.** Confirmed by tracing `src/draw.ts:141-151`: the string is
drawn from the REAL physics bodies — `s.control.translation()` (top) plus every
`s.segs[].translation()` (the actual ~20 chain-segment rigid bodies) — and `smoothPath`
(`draw.ts:87`) only draws a quadratic curve *through those real nodes* so the discrete links read
as one continuous string. The bezier follows the joints/constraints faithfully; it never invents
sag. So the slack is **genuine physics** and must be fixed in the physical string / capture
geometry, not the renderer. Do not "fix" this by changing how the string is drawn.

## Root cause (traced — read before coding)
- `buildChain` (`src/puppet.ts:225`) builds each string at length `restDist * STRING_SLACK`, where
  `restDist` is the straight-line span **at the captured pose** and `STRING_SLACK` is currently
  `1.0` (`puppet.ts:42`). So a string is built *taut to whatever geometry it was captured in*.
- The controls are captured at the **fingertips** and mapped to world by
  `x = stageX(lm) * worldWidth * swingRange`, `y = VERT_CENTER + stageY(lm) * VERT_SPAN * swingRange`
  (`engine.ts:241,245`; mirrored in `pilot.ts:111-112`). `swingRange` default `1.0`.
- With the assumed input pose — **palm to camera, fingers pointing slightly at the camera
  (foreshortened), fingers relaxed (not clenched, not fully extended)** — the fingertips are
  *bunched near the palm center* in the 2D projection. So the 5 controls land close together and
  close to the body. The string builds short/taut to THAT bunched geometry — but the instant the
  hand settles into a comfortable neutral, the control→part span drops below the built length and
  the chain goes slack. That residual slack is what the user sees and fights.

## Decisions (from the user — do NOT relitigate)
- **Target tautness = near-taut with a small give.** At the assumed relaxed-hand attach pose the
  real chains should hang **near-straight**, but keep a *hair* of slack so a deliberate hand
  tilt/move still visibly takes up and poses the puppet (preserve the marionette feel; kill the
  dead zone). NOT bolt-stiff, NOT today's droop.
- **Mechanism = normalize the capture to a reference pose.** At attach, remap the captured
  fingertip spread to a **target span** derived from the assumed canonical pose (fingers
  foreshortened toward camera, palm centered, relaxed) so the controls sit far enough apart /
  high enough that the taut build is *also* near-taut once the hand relaxes into comfortable
  neutral. This is preferred over just cranking `STRING_SLACK` blindly — though a small
  `STRING_SLACK` tweak MAY be used as the "small give" knob on top of the normalized capture.

## Reconcile with the loose-limb bezier work (important)
The earlier [loose-string-beziers.md](loose-string-beziers.md) task deliberately gave the limb
strings droop and the center string taut. The droop there is REAL chain slack (same mechanism),
smoothed by the same renderer. This task does not revert that intent — it removes the *excess
dead-zone slack present at the moment of attach* so the puppet is controllable, while the marionette
droop can still emerge later when the live hand actually relaxes a string during play. Keep the
taut-center / loose-limb *relative* character; just start from near-taut instead of pre-sagged.

## Suggested implementation
- **Define the reference pose → target span.** Pick a canonical captured-spread reference (the
  relaxed, foreshortened, palm-centered hand) and normalize the captured control positions so the
  control→part straight-line span at attach ≈ the string's intended near-taut length. Practically:
  scale/spread the captured fingertip cluster about its centroid (and/or lift toward
  `CONTROL_BASE_Y`) to a target span before it's frozen into the strings.
- **Small give.** Layer a small slack factor (e.g. `STRING_SLACK` ~`1.0`–`1.05`, tune by feel, or a
  per-attach factor) so it's near-taut with a hair of give — not zero, not today's amount.
- **Apply in BOTH capture paths.** The capture + attach logic is duplicated in
  `src/engine.ts` (the two-player `/game` path, `updateSlot` / `captureControls` around
  `engine.ts:345-416`, `st.captured`) and `src/pilot.ts` (the `/characters` demo,
  `pilot.ts:111-198`). Fix both, or factor the normalization into a shared helper (DRY) and call
  it from each.
- Respect the `ATTACH_MARGIN = 0.8` guard (`engine.ts:33`) — normalizing must not make the attach
  falsely fail (it compares live fingertip motion to the captured points during the attach ritual).
- Don't disturb the One Euro filter defaults (PRD §2) or the settle/anti-seizure work
  ([attach-seizure.md](attach-seizure.md)).

## Acceptance Criteria
- [ ] Right after strings attach, with a relaxed palm-to-camera hand, the strings read
      **near-straight** (small give only) — no large baked-in sag / dead zone.
- [ ] A deliberate hand tilt/move immediately poses the puppet (the slack no longer eats the first
      bit of motion). The puppet feels controllable from the first frame after attach.
- [ ] The taut-center / looser-limb *relative* character from `loose-string-beziers` is preserved;
      marionette droop can still appear when the live hand actually slackens a string in play.
- [ ] Both the `/game` (engine.ts) and `/characters` (pilot.ts) attach paths get the change; the
      capture normalization is shared, not copy-pasted divergently.
- [ ] Attach still succeeds reliably (the `ATTACH_MARGIN` guard isn't tripped by the normalization);
      no attach "seizure" regression.
- [ ] `npx tsc --noEmit` + `npm run build` clean.

## Verify it HEADLESSLY (this project does this)
Extend the existing headless Rapier sim (Node, `@dimforge/rapier3d-compat`, `node
--experimental-strip-types`): build a puppet, run the attach at a **simulated relaxed/foreshortened
capture pose**, step ~2–3s, and MEASURE each string's post-settle **tautness** — e.g.
`dist(control, partAnchor) / nominalLen` should be ≳ ~0.95 (near-taut) rather than well below 1
(slack). Show it's near-taut with the fix and slack without. Also confirm no post-attach explosion /
sustained oscillation (reuse the seizure sim's max-part-speed check). State clearly that on-screen
FEEL still needs a Chrome check on `/game` and `/characters`.

## Relevant Files
- `src/puppet.ts` — `STRING_SLACK` (line 42), `buildChain` (225), `attachStringForSlot` (403),
  `CONTROL_BASE_Y`/`CENTER_STRING_LEN`.
- `src/engine.ts` — `/game` capture + attach (`readFingerPositions` 236, `updateSlot`/capture
  345-416, `st.captured`, `swingRange`, `ATTACH_MARGIN`).
- `src/pilot.ts` — `/characters` capture + attach (111-198), same normalization.
- `src/control.ts` — `stageX`/`stageY` mapping (if the reference-pose normalization lives here).
- `src/draw.ts` — REFERENCE ONLY (`smoothPath` 87, string draw 141-151); do NOT change rendering.
- `README.md` — update the string-model / capture section with the reference-pose normalization.

## Constraints
- Do NOT change the renderer to fake tautness — the bezier already maps to the real chain.
- Keep the deliberate/slow marionette tempo; near-taut with a *small* give, not stiff.
- Don't break the dynamic-body Z-lock; stay on 2D canvas (no Three.js); no new deps; no emojis.
- Don't revert the control-pitch, loose-limb-bezier, or anti-seizure work.
- Don't touch the validated One Euro position defaults (PRD §2).
