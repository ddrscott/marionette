# Strings collide with the floor, still pass through the puppet

## Problem
The string (chain) segments currently collide with **nothing** — they pass through the floor. The
user wants the strings to **rest/pile on the floor** (not sink through it) while still **passing
through the puppet** (and each other, to avoid joint jitter). This pairs with the "heavier strings"
task: heavy chains that pile on the floor read as real chains.

## The fix (collision groups)
Rapier collision groups are 32-bit: high 16 = membership, low 16 = filter mask. Two colliders
collide iff `(A.member & B.filter) != 0 AND (B.member & A.filter) != 0`. The rig uses:
- bit 0 = puppet membership, bit 1 = floor membership.
- `PUPPET_GROUP = 0x00010002` — member bit0, collides with floor (bit1) only.
- `STRING_GROUP = 0x00010000` — member bit0, collides with **nothing** (this is what we change).
- `FLOOR_GROUP  = 0x00020001` — member bit1, collides with puppet (bit0).

Set the string segments to **member bit0, filter bit1** (i.e. `STRING_GROUP = 0x00010002`, the same
as `PUPPET_GROUP`). Then:
- string ↔ floor: collide ✓ (floor filters bit0; strings are member bit0; strings filter bit1=floor).
- string ↔ puppet: member bit0 & filter bit1 = 0 → **no collision** ✓ (passes through).
- string ↔ string: member bit0 & filter bit1 = 0 → **no self-collision** ✓ (no jitter).

So just change the `STRING_GROUP` constant value (the chain-segment collider already uses it).

## Acceptance Criteria
- [ ] String segments **rest on the floor** instead of passing through (headless: lower the controls
      so the strings pile down, confirm segment bottoms stay at/above `FLOOR_TOP`, no sinking).
- [ ] Strings still **pass through the puppet parts** (no new puppet↔string contacts) and through
      **each other**.
- [ ] Rig still stable with the added string↔floor contacts: full sweep → no NaN/explosion,
      `max |z| == 0`; puppet still rests cleanly on the floor.
- [ ] `npm run build` passes; README collision-groups note updated if present.

## Relevant Files
- `src/puppet.ts` — the `STRING_GROUP` constant (and the chain-segment collider that uses it); the
  `PUPPET_GROUP` / `FLOOR_GROUP` comments.
- `README.md` — collision-groups mention.

## Constraints
- Don't change puppet↔floor or puppet self-collision behavior.
- Watch perf/stability: ~50 thin segments may now generate floor contacts when piled — verify the
  headless sweep + floor-rest stay stable.
- Stay on 2D canvas; Rapier `@dimforge/rapier3d-compat@0.19.3`.
