import type RAPIER_NS from "@dimforge/rapier3d-compat";

// ---- world layout (units; the renderer shows WORLD_VIEW_HEIGHT units tall) ----
// Because the renderer maps a *fixed* world height to whatever pixel height the
// canvas has, a string measured in world units is a constant fraction of the
// viewport on any resize (see draw.ts / §4.1 "compute from viewport").
export const WORLD_VIEW_HEIGHT = 12;
export const PERCH_BASE_Y = 11; // perch rides near the top of the view

const SEG_COUNT = 5;
const SEG_HALF = 0.62; // capsule half-height; joint-to-joint spacing = 2*SEG_HALF
const SEG_RAD = 0.05;
export const CENTER_STRING_LEN = SEG_COUNT * SEG_HALF * 2; // 6.2u  ->  51.7% of a 12u view (> 50% required)

const NOSELF = 0x00010000; // membership bit 1, filter mask 0 -> collides with nothing (no joint jitter)

const ENABLE_HAND_STRINGS = true; // perch->arm rope "control lines"; flip off if the loop ever gets unstable

export interface Vec2 { x: number; y: number; }
export interface Capsule { body: RAPIER_NS.RigidBody; half: number; rad: number; color: string; }
export interface HandString { arm: RAPIER_NS.RigidBody; armAnchor: Vec2; }

export interface Rig {
  world: RAPIER_NS.World;
  perch: RAPIER_NS.RigidBody;
  parts: Capsule[];                  // torso + limbs (drawn thick)
  chain: RAPIER_NS.RigidBody[];      // center-string segments, top -> bottom (drawn as a string)
  torso: RAPIER_NS.RigidBody;
  torsoTopAnchor: Vec2;              // body-local point where the center string attaches
  handStrings: HandString[];
}

export function buildRig(RAPIER: typeof RAPIER_NS, gravityY: number): Rig {
  const world = new RAPIER.World({ x: 0, y: -gravityY, z: 0 });
  const parts: Capsule[] = [];

  // 2.5D plane lock applied to every dynamic body: free X/Y translation, no Z;
  // rotation only about the camera (Z) axis.
  const dyn = (cx: number, cy: number) =>
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(cx, cy, 0)
      .enabledTranslations(true, true, false)
      .enabledRotations(false, false, true);

  const limb = (cx: number, cy: number, half: number, rad: number, density: number, color: string) => {
    const body = world.createRigidBody(dyn(cx, cy));
    world.createCollider(
      RAPIER.ColliderDesc.capsule(half, rad).setDensity(density).setCollisionGroups(NOSELF),
      body,
    );
    parts.push({ body, half, rad, color });
    return body;
  };

  const spherical = (
    b1: RAPIER_NS.RigidBody, a1: Vec2,
    b2: RAPIER_NS.RigidBody, a2: Vec2,
  ) => world.createImpulseJoint(
    RAPIER.JointData.spherical({ x: a1.x, y: a1.y, z: 0 }, { x: a2.x, y: a2.y, z: 0 }),
    b1, b2, true,
  );

  // ---- perch: kinematic, follows the palm ----
  const perch = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, PERCH_BASE_Y, 0),
  );

  // ---- center string: a chain of light segments from perch down to the torso top ----
  // Spawn each segment along x=0 at its resting hang position so joints don't snap.
  const chain: RAPIER_NS.RigidBody[] = [];
  let prev: RAPIER_NS.RigidBody = perch;
  let prevBottom: Vec2 = { x: 0, y: 0 }; // perch attaches at its own origin
  for (let i = 0; i < SEG_COUNT; i++) {
    const cy = PERCH_BASE_Y - (i + 0.5) * (SEG_HALF * 2);
    const seg = world.createRigidBody(dyn(0, cy));
    world.createCollider(
      RAPIER.ColliderDesc.capsule(SEG_HALF, SEG_RAD).setDensity(0.4).setCollisionGroups(NOSELF),
      seg,
    );
    chain.push(seg);
    spherical(prev, prevBottom, seg, { x: 0, y: SEG_HALF });
    prev = seg;
    prevBottom = { x: 0, y: -SEG_HALF };
  }

  // ---- torso hangs off the bottom of the chain ----
  const chainBottomY = PERCH_BASE_Y - CENTER_STRING_LEN; // 4.8
  const torsoHalf = 0.5;
  const torsoTopAnchor: Vec2 = { x: 0, y: torsoHalf };
  const torso = limb(0, chainBottomY - torsoHalf, torsoHalf, 0.25, 1.4, "#e8e8e8");
  spherical(prev, prevBottom, torso, torsoTopAnchor);

  const torsoCY = chainBottomY - torsoHalf; // 4.3

  // ---- limbs (same topology as spike-1, lowered to the new torso position) ----
  const lArm = limb(-0.3, torsoCY - 0.1, 0.4, 0.12, 1.0, "#39d98a");
  const rArm = limb( 0.3, torsoCY - 0.1, 0.4, 0.12, 1.0, "#39d98a");
  spherical(torso, { x: -0.3, y: 0.3 }, lArm, { x: 0, y: 0.4 });
  spherical(torso, { x:  0.3, y: 0.3 }, rArm, { x: 0, y: 0.4 });

  const lLeg = limb(-0.15, torsoCY - 0.95, 0.45, 0.14, 1.1, "#5b8cff");
  const rLeg = limb( 0.15, torsoCY - 0.95, 0.45, 0.14, 1.1, "#5b8cff");
  spherical(torso, { x: -0.15, y: -0.5 }, lLeg, { x: 0, y: 0.45 });
  spherical(torso, { x:  0.15, y: -0.5 }, rLeg, { x: 0, y: 0.45 });

  // ---- hand strings: rope joints perch -> each arm (classic marionette "lift") ----
  // Rope is a one-sided max-length constraint, so a little slack at rest avoids
  // fighting the closed perch->arm->torso->chain->perch loop, yet still lifts the
  // arms when the perch rises.
  const handStrings: HandString[] = [];
  if (ENABLE_HAND_STRINGS) {
    const armAnchor: Vec2 = { x: 0, y: 0.4 };
    for (const arm of [lArm, rArm]) {
      const ap = arm.translation();
      const restDist = Math.hypot(ap.x, ap.y + armAnchor.y - PERCH_BASE_Y);
      world.createImpulseJoint(
        RAPIER.JointData.rope(restDist * 1.05, { x: 0, y: 0, z: 0 }, { x: 0, y: armAnchor.y, z: 0 }),
        perch, arm, true,
      );
      handStrings.push({ arm, armAnchor });
    }
  }

  return { world, perch, parts, chain, torso, torsoTopAnchor, handStrings };
}
