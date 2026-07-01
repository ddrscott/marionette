# Make the 10 characters radically distinct (kill the humanoid-biped sameness)

## Problem
All 10 rigs in `src/rigs.ts` currently read as the same humanoid biped (torso + 2 arms + 2 legs,
keystone = middle→torso). Even the "animals" stand upright. They need Super Smash Bros-level variety
of silhouette. Vary these axes HARD, per fighter:
- **Orientation** — not all upright. Horizontal quadruped/crawler, coiled serpent, a legless floater.
- **Number of limbs** — 0 legs, 6+ legs, one giant arm, etc. (NOT always 4 limbs).
- **Body size** — a tiny fast gremlin vs a huge slow titan (scale the whole rig).
- **Limb length** — long spindly reach vs stubby.

## Key constraint — strings (from Scott)
Every fighter must have **at least 5 strings** — the game is "cut the opponent's strings," so 5 keeps
it fair. BUT **strings are decoupled from limbs**: multiple strings may bind to the SAME part at
different body-local anchors/joints. So a legless orb can still have 5 cuttable strings (5 points
around its rim); a serpent can have 5 strings along its body. String count ≠ limb count.

Good news: `buildRig` + `attachStringForSlot` ALREADY support this — two `binding` rows can share a
`target` part id with different `bodyAnchor`s. No engine change needed just to double strings on a part.

## Engine work likely required (small, additive)
1. **Per-part neutral ROTATION.** `reposePuppet` currently forces every part to identity (upright
   capsule) each frame — so a horizontal body / angled limb can't hold its pose at neutral. Add an
   optional `rot` (z-angle radians) to `PartDef`; apply it in `buildRig` (initial `dynDesc` zRot) AND
   in `reposePuppet` (`setRotation` to that angle instead of identity). This is what unlocks
   orientation variety (lying quadruped, coiled serpent, canted scythes).
2. **Keystone centering.** `Pilot.beginAttach` (and `engine.ts`) center the slot-2 (middle) target
   part under the middle fingertip. Make sure each redesigned rig's slot-2 string targets its main
   mass so it hangs sensibly. Non-central roots are fine; just point slot 2 at the anchor part.
3. **Optional per-rig scale.** If body sizes vary a lot (tiny vs huge), the `/characters` select grid
   cards may clip. Either add a `scale`/`gridScale` to `RigDef` for the preview, or size each rig so
   it fits a card. Keep the tryout (centre) pose readable too.

## Direction — redesign ALL 10 (go wild)
Keep the genre flavor from `design/puppet-roster.md` but break the biped mold. Illustrative targets
(worker can refine — aim for 10 clearly-different silhouettes):
- **Legless floater / orb** — no legs, drifts; 5 strings fanned around the body.
- **Horizontal quadruped beast** — body lies flat (needs `rot`), 4 short legs down, head out front.
- **Coiled serpent** — a long multi-segment chain, vertical or S-coiled; 5 strings along its length.
- **Tiny gremlin** — small overall scale, stubby limbs, reads as fast/light.
- **Huge titan** — massive torso dwarfing the stage, tiny controls, reads as heavy/slow.
- **Many-legged insect/spider** — 6–8 spindly legs, small body; 5 strings on a subset + body.
- **Asymmetric one-big-arm bruiser** — one giant arm + a small body, off-center mass.
- **Long-limbed spindly reacher** — tiny torso, extremely long thin limbs.
- Plus 2 more with distinct orientation/limb-count (e.g. a top-heavy blade-arm, a wide low tank).

## Acceptance criteria
- The 10 fighters read as **clearly different silhouettes** across orientation, limb count, body size,
  and limb length — not "the same biped restyled." A glance at the `/characters` grid shows variety.
- Every rig has **≥5 strings** that are individually cuttable (fair for the game).
- All 10 still: hold in the select grid, snap to neutral on pick, attach via the ritual, drive from the
  hand, and reset — on `/characters`. Don't break `/game` or `/harness` (they use `addPuppet`, not
  `buildRig`, so leave the humanoid path intact).
- `npm run build` clean; deploy to marionette.ljs.app.

## Relevant files
- `src/rigs.ts` — all 10 `RigDef`s (the redesign).
- `src/puppet.ts` — `PartDef.rot` + `reposePuppet` rotation + `buildRig` (+ maybe `RigDef.gridScale`).
- `src/pilot.ts` / `src/engine.ts` — keystone centering sanity (slot-2 target).
- `src/characters.ts` — grid card sizing if per-rig scale is added.
- `design/puppet-roster.md` — update the roster doc to match the final designs.

## Constraints
- Keep the 5-finger control model and the shared attach ritual (Pilot / Stage) intact.
- No emojis in UI (Lucide only). Keep the duotone/mature theme.
- Leave the deployed `/game` humanoid (`addPuppet`) untouched.
