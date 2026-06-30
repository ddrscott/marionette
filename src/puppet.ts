import type RAPIER_NS from "@dimforge/rapier3d-compat";

// ---- terminology (per https://en.wikipedia.org/wiki/Marionette) ----
// "control" / "control bar": the device the puppeteer holds. We use a *horizontal
//   control* — the cross with bars at right angles, the US style for human figures.
//   (We render its "+" in the screen plane as a 2.5D stylization so both string
//   spreads stay visible side-on.)
// "strings": the threads. The British 9-string standard runs one to each knee, hand
//   and shoulder, two to the head, and one to the lower back. Our four (head, two
//   shoulders, lower back) are a subset of that — room to grow into hands + knees.

// ---- world layout (units; the renderer shows WORLD_VIEW_HEIGHT units tall) ----
// Because the renderer maps a *fixed* world height to whatever pixel height the
// canvas has, a string measured in world units is a constant fraction of the
// viewport on any resize (see draw.ts / §4.1 "compute from viewport").
export const WORLD_VIEW_HEIGHT = 12;
export const CONTROL_BASE_Y = 11; // the control bar rides near the top of the view

// Horizontal-control geometry, in control-local units.
export const CONTROL_HALF_W = 1.0; // central bar: half-length (spreads the shoulder strings)
export const CONTROL_HALF_V = 0.5; // cross bar: half-length (head tip up, lower-back tip down)

// Swing damping. Gravity sets the swing FREQUENCY, not its decay — with zero damping a pendulum
// conserves energy and swings forever. Damping bleeds velocity each step (air drag / joint
// friction) so the puppet settles after a few oscillations. Tunable live via the damping slider.
export const DEFAULT_LINEAR_DAMPING = 1.0;
export const DEFAULT_ANGULAR_DAMPING = 1.0;

export const CENTER_STRING_LEN = 6.2; // head rope length -> 51.7% of a 12u view (> 50% required)

// Rope slack: maxLength = restDist * slack. The head is near-taut (bears the torso weight, hangs it
// at the right height) but still a rope, so it goes slack when the puppet rests. The limbs hang
// loose — relaxed, not floppy-to-the-floor (PRD §2 deliberate tempo).
const HEAD_SLACK = 1.0;
const LOOSE_ROPE_SLACK = 1.22;
const HAND_SLACK = 1.15; // hand strings: hang loose-ish but responsive to raising/tilting the bar

// Collision filtering (32-bit: high 16 = membership, low 16 = mask of groups it collides with).
// Puppet parts collide with the FLOOR but not each other (no self-jitter); the floor collides only
// with the puppet parts. Strings are pure rope joints now (no bodies of their own).
const PUPPET_GROUP = 0x00010002; // member group 0, collides with group 1 (floor)
const FLOOR_GROUP  = 0x00020001; // member group 1, collides with group 0 (puppet)

// Floor geometry (world units). Its top sits just above the bottom of the 12u view, so a lowered
// control rests the puppet on-screen instead of letting it fall away (the world constrains motion,
// the input isn't artificially clamped).
export const FLOOR_TOP = 0.8;
const FLOOR_HALF_H = 0.5;
const FLOOR_HALF_W = 50; // wide enough to span any viewport aspect
const FLOOR_HALF_D = 1;  // z-thickness so the z-locked puppet (z=0) always overlaps the floor

export interface Vec2 { x: number; y: number; }
export interface Capsule { body: RAPIER_NS.RigidBody; half: number; rad: number; color: string; }

// A puppet string: a non-rigid rope joint from a point on the control to a point on the torso.
// Every string can go slack (one-sided max-length constraint) — it pulls when taut, never pushes.
export interface PuppetString {
  name: string;
  controlAnchor: Vec2;               // control-local (the NEUTRAL anchor; poseControl foreshortens it)
  body: RAPIER_NS.RigidBody;         // body the string ends on
  bodyAnchor: Vec2;                  // body-local
  controlJoint: RAPIER_NS.ImpulseJoint; // the control-side joint; its anchor1 is updated for pitch/yaw
  maxLength: number;                 // rope max-length (the slack budget; sag = maxLength - dist)
}

// The four attach points. Spreading them across the control bar — instead of pinning
// everything to one spot — is what makes this read as a marionette, and these rows are
// exactly what a future "customize the rig" feature would edit (toward the 9-string set).
// `target`: which body the string ends on; `slack`: maxLength = restDist * slack. The head bears
// the weight (near-taut) but is STILL a rope, so it goes slack when the puppet rests; the others
// hang looser. The two bar ends run to the HANDS (arm tips), so raising/tilting the bar moves the
// arms directly (classic marionette hand control).
type TargetName = "torso" | "lArm" | "rArm";
interface AttachSpec { name: string; target: TargetName; controlAnchor: Vec2; bodyAnchor: Vec2; slack: number }
const ATTACH: AttachSpec[] = [
  { name: "head",      target: "torso", controlAnchor: { x: 0, y: 0 },               bodyAnchor: { x: 0, y: 0.5 },  slack: HEAD_SLACK },
  { name: "lHand",     target: "lArm",  controlAnchor: { x: -CONTROL_HALF_W, y: 0 }, bodyAnchor: { x: 0, y: -0.4 }, slack: HAND_SLACK },
  { name: "rHand",     target: "rArm",  controlAnchor: { x:  CONTROL_HALF_W, y: 0 }, bodyAnchor: { x: 0, y: -0.4 }, slack: HAND_SLACK },
  { name: "lowerBack", target: "torso", controlAnchor: { x: 0, y: -CONTROL_HALF_V }, bodyAnchor: { x: 0, y: -0.5 }, slack: LOOSE_ROPE_SLACK },
];

export interface Rig {
  world: RAPIER_NS.World;
  control: RAPIER_NS.RigidBody;
  parts: Capsule[];          // torso + limbs (drawn thick)
  torso: RAPIER_NS.RigidBody;
  strings: PuppetString[];   // the four control strings (all non-rigid ropes; head bears the weight)
  // Control-local anchor positions AFTER pitch/yaw posing (aligned with `strings`), plus the
  // cross-bar's decorative top tip. The renderer draws the bar + string tops from these so the
  // strings always stay attached to the foreshortened "+". The body itself only carries ROLL.
  posedAnchors: Vec2[];
  barTip: Vec2;
}

// ---- control tilt response: how roll/pitch/yaw re-pose the IN-PLANE control anchors ----
// The control body only rolls (in-plane Z) — rotating it out of plane would yank the z-locked
// lower-back rope perpendicular to its only free axes and blow the solver up (verified). So pitch
// and yaw are simulated by repositioning the anchors within the plane:
//   * cos() foreshortening shrinks the bar (vertical member under pitch, horizontal under yaw) —
//     the orthographic cue the PRD asks for;
//   * a small NOD/TURN pull then actually moves the puppet through the strings (foreshortening
//     alone only slackens the max-length ropes, so it can't pull on its own).
// PRD §2: keep it modest — these gains are deliberately gentle and ride heavily-smoothed signals.
const NOD_GAIN = 1.4;  // pitch(rad) -> head anchor drop: the head string tips the torso into a nod
const TURN_GAIN = 0.7; // yaw(rad)  -> asymmetric shoulder height: the shoulders swing the torso round

// Loose-limb slack: the limb ropes (shoulders + lower back) carry little load, so they hang with
// visible slack and droop. maxLength = rest distance * this multiplier. >1 buys droop; tilting or
// moving the control takes the slack up and re-poses the limb (so the pitch feature still bites).
function posedAnchor(name: string, base: Vec2, pitch: number, yaw: number): Vec2 {
  let x = base.x * Math.cos(yaw);   // horizontal members foreshorten as the bar yaws
  let y = base.y * Math.cos(pitch); // vertical members foreshorten as the bar pitches
  if (name === "head") y -= pitch * NOD_GAIN;     // pull the head string -> nod / weight shift
  else if (name === "lHand") y += yaw * TURN_GAIN; // bar ends swap height -> turn (now via the hands)
  else if (name === "rHand") y -= yaw * TURN_GAIN;
  return { x, y };
}

// Constraint solver iterations. The rope joints are meant to be inextensible, but at the default
// (~4) they visibly stretch under a hard yank (~2.7%) — that overshoot-and-snap reads as a
// rubberband. More iterations enforce the ropes more rigidly (16 → ~0.2% stretch, imperceptible).
// Cheap here (only ~5 bodies / 4 joints).
const SOLVER_ITERATIONS = 16;

export function buildRig(RAPIER: typeof RAPIER_NS, gravityY: number): Rig {
  const world = new RAPIER.World({ x: 0, y: -gravityY, z: 0 });
  world.integrationParameters.numSolverIterations = SOLVER_ITERATIONS;
  const parts: Capsule[] = [];

  // 2.5D plane lock on every dynamic body: free X/Y translation, no Z; rotate only about Z.
  // Damping is set so swings settle instead of oscillating forever (see DEFAULT_*_DAMPING).
  const dyn = (cx: number, cy: number) =>
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(cx, cy, 0)
      .enabledTranslations(true, true, false)
      .enabledRotations(false, false, true)
      .setLinearDamping(DEFAULT_LINEAR_DAMPING)
      .setAngularDamping(DEFAULT_ANGULAR_DAMPING);

  const limb = (cx: number, cy: number, half: number, rad: number, density: number, color: string) => {
    const body = world.createRigidBody(dyn(cx, cy));
    world.createCollider(
      RAPIER.ColliderDesc.capsule(half, rad).setDensity(density).setCollisionGroups(PUPPET_GROUP),
      body,
    );
    parts.push({ body, half, rad, color });
    return body;
  };

  const spherical = (b1: RAPIER_NS.RigidBody, a1: Vec2, b2: RAPIER_NS.RigidBody, a2: Vec2) =>
    world.createImpulseJoint(
      RAPIER.JointData.spherical({ x: a1.x, y: a1.y, z: 0 }, { x: a2.x, y: a2.y, z: 0 }),
      b1, b2, true,
    );

  // ---- control bar: kinematic, follows the palm; no collider needed (joints use local anchors) ----
  const control = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, CONTROL_BASE_Y, 0),
  );

  // ---- floor: static shelf at the bottom so a lowered control rests the puppet on-screen ----
  const floorBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, FLOOR_TOP - FLOOR_HALF_H, 0),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(FLOOR_HALF_W, FLOOR_HALF_H, FLOOR_HALF_D).setCollisionGroups(FLOOR_GROUP),
    floorBody,
  );

  // ---- torso, placed so the head chain hangs at exactly its rest length ----
  const torsoHalf = 0.5;
  const torsoCY = CONTROL_BASE_Y - CENTER_STRING_LEN - torsoHalf; // 4.3
  const torso = limb(0, torsoCY, torsoHalf, 0.25, 1.4, "#e8e8e8");

  // ---- limbs hang passively off the torso (same topology as spike-1) ----
  const lArm = limb(-0.3, torsoCY - 0.1, 0.4, 0.12, 1.0, "#39d98a");
  const rArm = limb( 0.3, torsoCY - 0.1, 0.4, 0.12, 1.0, "#39d98a");
  spherical(torso, { x: -0.3, y: 0.3 }, lArm, { x: 0, y: 0.4 });
  spherical(torso, { x:  0.3, y: 0.3 }, rArm, { x: 0, y: 0.4 });

  const lLeg = limb(-0.15, torsoCY - 0.95, 0.45, 0.14, 1.1, "#5b8cff");
  const rLeg = limb( 0.15, torsoCY - 0.95, 0.45, 0.14, 1.1, "#5b8cff");
  spherical(torso, { x: -0.15, y: -0.5 }, lLeg, { x: 0, y: 0.45 });
  spherical(torso, { x:  0.15, y: -0.5 }, rLeg, { x: 0, y: 0.45 });

  // ---- four control strings: head + lower-back to the torso, the two bar ends to the hands ----
  const targets: Record<TargetName, RAPIER_NS.RigidBody> = { torso, lArm, rArm };
  const controlT = control.translation();
  const strings: PuppetString[] = ATTACH.map((spec) => {
    const body = targets[spec.target];
    const bodyT = body.translation();
    const top: Vec2 = { x: controlT.x + spec.controlAnchor.x, y: controlT.y + spec.controlAnchor.y };
    const bot: Vec2 = { x: bodyT.x + spec.bodyAnchor.x, y: bodyT.y + spec.bodyAnchor.y };
    // Every string is a non-rigid rope (one-sided max-length): it pulls when taut, never pushes, and
    // goes slack when the body is closer than maxLength (e.g. resting on the floor). The renderer
    // reads maxLength back to bend the bezier; slack = maxLength - distance.
    const restDist = Math.hypot(top.x - bot.x, top.y - bot.y);
    const maxLength = restDist * spec.slack;
    const controlJoint = world.createImpulseJoint(
      RAPIER.JointData.rope(
        maxLength,
        { x: spec.controlAnchor.x, y: spec.controlAnchor.y, z: 0 },
        { x: spec.bodyAnchor.x, y: spec.bodyAnchor.y, z: 0 },
      ),
      control, body,
      true,
    );
    return { name: spec.name, controlAnchor: spec.controlAnchor, body, bodyAnchor: spec.bodyAnchor, controlJoint, maxLength };
  });

  const posedAnchors = strings.map((s) => ({ ...s.controlAnchor }));
  return { world, control, parts, torso, strings, posedAnchors, barTip: { x: 0, y: CONTROL_HALF_V } };
}

// Pose the control each frame. Roll is a REAL in-plane Z rotation of the kinematic body, so it
// poses the torso through the strings (one shoulder rises, the other drops -> the puppet leans).
// Pitch & yaw are simulated in-plane via posedAnchor() — the body never leaves z=0, so every
// dynamic body stays Z-locked while the bar still foreshortens and the puppet still responds.
export function poseControl(rig: Rig, roll: number, pitch: number, yaw: number): void {
  // physics: in-plane roll only — a pure quaternion about Z (out-of-plane rotation would yank the
  // z-locked bodies and blow the solver up). Pitch/yaw are baked into the anchors below instead.
  rig.control.setNextKinematicRotation({ x: 0, y: 0, z: Math.sin(roll / 2), w: Math.cos(roll / 2) });
  for (let i = 0; i < rig.strings.length; i++) {
    const s = rig.strings[i];
    const a = posedAnchor(s.name, s.controlAnchor, pitch, yaw);
    s.controlJoint.setAnchor1({ x: a.x, y: a.y, z: 0 });      // foreshortened + nod/turn pull
    rig.posedAnchors[i] = a;
  }
  rig.barTip = { x: 0, y: CONTROL_HALF_V * Math.cos(pitch) }; // decorative top of the "+"
}

// Set swing damping on every dynamic body (torso, limbs, string segments) at runtime — driven by
// the damping slider. The kinematic control is excluded (it's positioned directly, not simulated).
export function setDamping(rig: Rig, linear: number, angular: number): void {
  const apply = (b: RAPIER_NS.RigidBody) => { b.setLinearDamping(linear); b.setAngularDamping(angular); };
  for (const p of rig.parts) apply(p.body);
}
