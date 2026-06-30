# Make the strings heavier (read as chains, not floaty thread)

## Problem
The string segments are very light (`SEG_DENSITY = 0.3` in `puppet.ts`), so the strings hang/move
like weightless thread and feel floaty. The user wants them to **read as chains** — links that hang
and swing with visible weight. Bonus physics win: heavier segments improve the link-to-puppet **mass
ratio**, which is the root cause of the chain-stretch we've been fighting, so heavier should also
*reduce* stretch (not increase it — that was the opposite case, a heavier puppet vs light links).

## Decisions (from the user, do not relitigate)
- **Heavier default, no slider.** Just raise `SEG_DENSITY` to a heavier constant. (No new UI knob.)
- **"Clearly heavy chains."** Links should hang/swing with visible weight — but the string must stay
  **lighter than the limb it pulls** at the default puppet weight, so the puppet drives the strings,
  not the reverse (no "tail wags dog" / limb whipping).

## Guidance
- Pick `SEG_DENSITY` so that, at the **default puppet weight (4×)**, each string's *total* mass is a
  clear step up from now (~0.01) yet comfortably **below** the mass of the limb it attaches to.
  Rough masses at weight 4: arm ≈ 0.17, leg ≈ 0.29 (compute exactly in a headless check). A start of
  `SEG_DENSITY ≈ 2.0` gives ~0.05–0.08 total string mass — clearly heavy, still well under the limbs.
  Tune from there toward "clearly heavy chains" without crossing limb mass.
- Note the caveat in a comment: the puppet weight is a live slider (1–12). At **very low** puppet
  weight the limbs get light enough that a heavy string could approach/exceed limb mass (wagging).
  Size the default for weight 4; if needed, mention the low-weight caveat.
- Heavier segments also fall faster under the existing linear drag (less floaty) and drape under
  their own weight — both desired.

## Acceptance Criteria
- [ ] `SEG_DENSITY` raised so the strings read as **clearly heavier** (verify total string mass is a
      multiple of the current value).
- [ ] At the default puppet weight (4×), each string's total mass is **< the limb mass** it pulls
      (report the numbers: per-string string-mass vs target-limb-mass).
- [ ] Headless stability: full sweep (finger-spread + hand-sweep, the current rig's sim) → **no
      NaN/explosion, `max |z| == 0`**; puppet still rests cleanly on the floor.
- [ ] Chain **stretch under a yank does not get worse** (ideally improves) vs the light version —
      measure with the existing summed-link-length-vs-nominal metric and report.
- [ ] `npm run build` passes clean; README's `SEG_DENSITY` mention updated.

## Relevant Files
- `src/puppet.ts` — `SEG_DENSITY` constant; the rig (parts masses, chain build), `setPuppetWeight`.
- `README.md` — the `SEG_DENSITY` tuning-knob line.
- Headless test pattern: `node --experimental-strip-types` importing `./src/puppet.ts`, building the
  rig, driving the 5 `rig.controls` (kinematic) over a sweep, checking parts + `s.segs`.

## Constraints
- Don't break the dynamic-body Z-lock or the 5-string rig's stability (heavier links + the closed
  loops are the risk — verify).
- Keep `SOLVER_ITERATIONS` adequate (heavier links may need no more, possibly fewer — don't lower it
  without confirming stretch stays low).
- Don't add a slider (the user chose a fixed default). Stay on 2D canvas; no emojis in UI.
- Rapier is `@dimforge/rapier3d-compat@0.19.3`.
