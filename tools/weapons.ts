// Headless weapon harness (no webcam, no DOM). Exercises the real puppet.ts weapon primitives on a
// real Rapier world and proves the disjoint-weapon invariants:
//   (a) ARM — a blade adds one collider to the limb body and increases its mass (the commitment).
//   (b) REACH — the blade tip sits ~reach beyond the bare limb tip (offense that outranges the body).
//   (c) DISARM — dropping the blade removes the collider, returns mass to bare, and zeroes the reach
//       so the limb can no longer cut (isArmed/liveWeaponReach). Idempotent.
//   (d) REARM — re-applying the stored loadout rebuilds the dropped blade (what round-start does).
//
//   npx esbuild tools/weapons.ts --bundle --format=esm --platform=node --outfile=/tmp/weapons.mjs
//   node /tmp/weapons.mjs
import RAPIER from "@dimforge/rapier3d-compat";
import {
  buildWorld, addPuppet, armPuppet, disarmWeapon, isArmed, liveWeaponReach, limbAxisPoint,
  RIGHT_HAND_BINDING, type WeaponDef, type Capsule,
} from "../src/puppet.ts";

let failed = 0;
const check = (name: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};

await RAPIER.init();
const world = buildWorld(RAPIER, 20);
const p = addPuppet(RAPIER, world, 0, RIGHT_HAND_BINDING);
const rArm: Capsule = p.parts.find((c) => c.body === p.partByTarget["rArm"])!;

const bareTip = limbAxisPoint(rArm, rArm.half);
const bareMass = rArm.body.mass();
const bareColliders = rArm.body.numColliders();

const REACH = 1.6;
const defs: WeaponDef[] = [{ name: "blade", target: "rArm", reach: REACH, thickness: 0.1, density: 6, color: "#fff" }];
armPuppet(RAPIER, world, p, defs);

const tip = limbAxisPoint(rArm, rArm.half + liveWeaponReach(rArm));
const reachDist = Math.hypot(tip.x - bareTip.x, tip.y - bareTip.y);

// (a) arm
check("arm adds one collider", rArm.body.numColliders() === bareColliders + 1, `${bareColliders}→${rArm.body.numColliders()}`);
check("arm increases limb mass", rArm.body.mass() > bareMass, `${bareMass.toFixed(3)}→${rArm.body.mass().toFixed(3)}`);
check("loadout stored on puppet", p.loadout.length === 1);
check("isArmed true", isArmed(p));
// (b) reach
check("blade tip ~reach past bare tip", Math.abs(reachDist - REACH) < 0.05, `dist=${reachDist.toFixed(3)}`);
check("liveWeaponReach == reach", Math.abs(liveWeaponReach(rArm) - REACH) < 1e-6);

// (c) disarm
const dropped = disarmWeapon(world, rArm);
check("disarm returns true", dropped);
check("disarm removes the collider", rArm.body.numColliders() === bareColliders);
check("disarm restores bare mass", Math.abs(rArm.body.mass() - bareMass) < 1e-3, `mass=${rArm.body.mass().toFixed(3)}`);
check("disarm zeroes reach", liveWeaponReach(rArm) === 0);
check("isArmed false after disarm", !isArmed(p));
check("disarm is idempotent", disarmWeapon(world, rArm) === false);

// (d) rearm from stored loadout (what a round reset does)
armPuppet(RAPIER, world, p, p.loadout);
check("rearm rebuilds the blade", isArmed(p) && rArm.body.numColliders() === bareColliders + 1);

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
