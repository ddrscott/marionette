# Puppets collide with each other (no passthrough)

## Problem
In `/game` the two puppets (and their weapons) pass straight through each other. Every puppet
part AND every weapon collider shares ONE collision group — `PUPPET_GROUP = 0x00010002` in
`src/puppet.ts` (membership group 0, mask = group 1 = floor/wall only). Because both players'
parts are the same membership and their mask excludes group 0, nothing on one puppet ever
collides with the other. Suspected consequence (per the report): a limb or weapon can
interpenetrate the opponent's body and reach strings it shouldn't, so **strings get cut too
easily**. Making the puppets solid should force cuts to come from reaching a string legitimately
rather than by clipping through the body.

## Chosen approach (recommended defaults — confirm/adjust with the user if unsure)
The clarifying questions weren't answered before this was queued. Proceed with these defaults;
they're the most direct fix. Note them in the PR so they can be changed:
- **Collision scope: bodies + weapons vs the opponent.** Puppet parts collide with the OTHER
  puppet's parts, and each puppet's weapons are physically blocked by the opponent's body (a
  blade can't pass through the torso to reach far strings). (Alternative the user was offered:
  "bodies only" — weapons still pass; or "bodies + weapons clash" — weapons also collide with
  the opponent's weapons. Pick bodies+weapons unless told otherwise.)
- **Self-collision: OFF (cross-puppet only).** A puppet's own jointed limbs keep overlapping
  freely as today — do NOT make a puppet solid against itself (jointed limbs would jam/jitter
  and could revive the attach-settle "seizure").

## Implementation sketch
Rapier collision filter = high 16 bits membership, low 16 bits mask; two colliders collide iff
`(A.mem & B.mask) && (B.mem & A.mask)`. Move from one shared group to per-player groups:
- bit 0 = floor/wall (existing group 1 → keep as the "environment" bit).
- bit 1 = player 0's puppet + its weapons.
- bit 2 = player 1's puppet + its weapons.
- Player 0 collider: membership `bit1`, mask `floor | bit2` → hits floor + player 1, NOT itself.
- Player 1 collider: membership `bit2`, mask `floor | bit1` → hits floor + player 0, NOT itself.
- Floor/wall: membership `floor`, mask `bit1 | bit2` (both players).

`addPuppet` / `buildRig` currently hard-code `PUPPET_GROUP` on every capsule; parameterize the
collision group per puppet (by player index / slot) and thread it from `engine.ts` where the two
players are created (slot 0 vs slot 1). Do the same for the weapon colliders in `src/weapons.ts`
(currently also `PUPPET_GROUP`) so a player's weapons carry that player's group. Single-puppet
scenes (`/characters`, `/pose`) just get one player's group — they still collide with the floor
and there's no second puppet, so behavior is unchanged there.

## Acceptance criteria
- In `/game`, the two puppets' bodies cannot overlap/pass through each other — a limb/torso of
  one player is physically stopped by the other player's body.
- A puppet's own limbs still overlap freely (no new self-collision jitter; no attach-seizure
  regression — re-run the anti-seizure guard, e.g. `tools/soft-string.ts`).
- Weapons are blocked by the opponent's body (chosen scope) but a player's weapon does NOT
  collide with its own puppet.
- Strings can still be cut when a weapon/limb legitimately reaches them (don't over-block so the
  game becomes uncuttable) — sanity-check that cutting still works.
- `/characters` and `/pose` (single puppet) are unaffected: puppet still rests on the floor,
  attaches, and drives normally.
- `npm run build` clean.

## Relevant files
- `src/puppet.ts` — `PUPPET_GROUP` / `FLOOR_GROUP` constants (~line 38-40), `buildWorld` floor +
  center-wall colliders (~line 200-218), `addPuppet` capsule colliders (~line 273), `buildRig`
  capsule colliders (~line 340), and any other `setCollisionGroups(PUPPET_GROUP)` (~line 552).
- `src/weapons.ts` — weapon collider group (shares `PUPPET_GROUP` today).
- `src/engine.ts` — where the two players/puppets are built (slot 0/1) — thread the per-player
  collision group in.
- `src/cut.ts` — how strings are cut (to sanity-check cuts still fire and aren't over-blocked).

## Constraints
- Keep the center divider wall + its bottom opening (`WALL_OPENING`) and the floor collision.
- Puppets are z-locked at z=0; keep colliders overlapping in z so x/y collision resolves.
- Do NOT regress the attach "seizure" fix or the soft-string goal-drive invariants.
- Scope the behavioral change to `/game`; leave `/characters` and `/pose` playing as they do now.
