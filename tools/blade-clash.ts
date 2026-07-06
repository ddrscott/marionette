// Headless proof that BLADE-TO-BLADE collision is active under the per-player collision-group scheme.
// Weapons carry their owner puppet's `collisionGroup` = puppetGroupFor(playerIndex) (see armPuppet), so
// this tests those exact group values on bare capsule colliders (a weapon IS a capsule collider):
//   - CROSS  (player0 group vs player1 group): must COLLIDE → two overlapping capsules push apart.
//   - SAME   (player0 group vs player0 group):  must NOT collide (self-filter) → stay overlapping.
// No gravity, motion locked to x, so the only thing that can move them is a resolved contact.
//   npx tsx tools/blade-clash.ts
import RAPIER from "@dimforge/rapier3d-compat";
import { puppetGroupFor } from "../src/puppet.ts";

const RAD = 0.2, HALF = 0.5, GAP = 0.2; // two capsules whose centers start GAP apart → overlap by (2·RAD-GAP)

// Drop two x-only capsules that start overlapping (centers ±GAP/2) with the given groups; step; return
// their final center-to-center x separation. If they collide, contact recovery pushes them to ~2·RAD.
function finalSep(groupA: number, groupB: number): number {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // no gravity — isolate contact response
  const mk = (x: number, group: number) => {
    const rb = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0, 0).enabledTranslations(true, false, false).lockRotations(),
    );
    world.createCollider(RAPIER.ColliderDesc.capsule(HALF, RAD).setDensity(1).setCollisionGroups(group), rb);
    return rb;
  };
  const a = mk(-GAP / 2, groupA);
  const b = mk(GAP / 2, groupB);
  for (let i = 0; i < 180; i++) world.step();
  return Math.abs(b.translation().x - a.translation().x);
}

(async function main() {
  await RAPIER.init();
  const P0 = puppetGroupFor(0), P1 = puppetGroupFor(1);
  const cross = finalSep(P0, P1); // opposing players' blades
  const same = finalSep(P0, P0);  // same player's two blades
  const TOUCH = 2 * RAD;          // ~0.40: fully separated (just touching)

  const crossPass = cross > TOUCH - 0.02; // pushed apart to ~touching
  const samePass = same < GAP + 0.02;     // stayed overlapping (no push)

  console.log(`groups: player0=0x${P0.toString(16)} player1=0x${P1.toString(16)}`);
  console.log(`CROSS (p0 vs p1): start sep ${GAP.toFixed(2)} → final ${cross.toFixed(3)} u  (touching≈${TOUCH.toFixed(2)})  -> blades COLLIDE: ${crossPass ? "PASS" : "FAIL"}`);
  console.log(`SAME  (p0 vs p0): start sep ${GAP.toFixed(2)} → final ${same.toFixed(3)} u  -> same-player blades pass through (no self-collision): ${samePass ? "PASS" : "FAIL"}`);
  console.log(crossPass && samePass ? "ALL PASS — blade-to-blade clashes; a puppet's own weapons don't self-collide." : "FAIL");
})();
