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

const HEAD_SEG_COUNT = 5;
const SEG_HALF = 0.62; // capsule half-height; joint-to-joint spacing = 2*SEG_HALF
const SEG_RAD = 0.05;
export const CENTER_STRING_LEN = HEAD_SEG_COUNT * SEG_HALF * 2; // 6.2u -> 51.7% of a 12u view (> 50% required)

const NOSELF = 0x00010000; // membership bit 1, filter mask 0 -> collides with nothing (no joint jitter)

export interface Vec2 { x: number; y: number; }
export interface Capsule { body: RAPIER_NS.RigidBody; half: number; rad: number; color: string; }

// A puppet string drawn from a point on the control to a point on a body.
// 'chain'  -> segment bodies (sags/swings, the §4.1 hero);  'rope' -> taut max-length line.
export interface PuppetString {
  name: string;
  kind: "chain" | "rope";
  controlAnchor: Vec2;               // control-local (the NEUTRAL anchor; poseControl foreshortens it)
  body: RAPIER_NS.RigidBody;         // body the string ends on
  bodyAnchor: Vec2;                  // body-local
  segs: RAPIER_NS.RigidBody[];       // chain segments top->bottom ([] for rope)
  controlJoint: RAPIER_NS.ImpulseJoint; // the control-side joint; its anchor1 is updated for pitch/yaw
  maxLength: number;                 // rope max-length (the slack budget); 0 for chains
}

// The four attach points. Spreading them across the control bar — instead of pinning
// everything to one spot — is what makes this read as a marionette, and these rows are
// exactly what a future "customize the rig" feature would edit (toward the 9-string set).
interface AttachSpec { name: string; controlAnchor: Vec2; bodyAnchor: Vec2; kind: "chain" | "rope"; }
const ATTACH: AttachSpec[] = [
  { name: "head",      controlAnchor: { x: 0, y: 0 },                bodyAnchor: { x: 0, y: 0.5 },     kind: "chain" },
  { name: "lShoulder", controlAnchor: { x: -CONTROL_HALF_W, y: 0 },  bodyAnchor: { x: -0.35, y: 0.4 }, kind: "rope" },
  { name: "rShoulder", controlAnchor: { x:  CONTROL_HALF_W, y: 0 },  bodyAnchor: { x:  0.35, y: 0.4 }, kind: "rope" },
  { name: "lowerBack", controlAnchor: { x: 0, y: -CONTROL_HALF_V },  bodyAnchor: { x: 0, y: -0.5 },    kind: "rope" },
];

export interface Rig {
  world: RAPIER_NS.World;
  control: RAPIER_NS.RigidBody;
  parts: Capsule[];          // torso + limbs (drawn thick)
  torso: RAPIER_NS.RigidBody;
  strings: PuppetString[];   // the four control strings (head is the long center chain)
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
// The CENTER head chain bears the torso weight and stays taut — it is NOT a rope, so it ignores
// this. Keep it relaxed, not floppy-to-the-floor (PRD §2 deliberate tempo): ~1.18-1.30.
const LOOSE_ROPE_SLACK = 1.22;

function posedAnchor(name: string, base: Vec2, pitch: number, yaw: number): Vec2 {
  let x = base.x * Math.cos(yaw);   // horizontal members foreshorten as the bar yaws
  let y = base.y * Math.cos(pitch); // vertical members foreshorten as the bar pitches
  if (name === "head") y -= pitch * NOD_GAIN;        // pull the head string -> nod / weight shift
  else if (name === "lShoulder") y += yaw * TURN_GAIN; // shoulders swap height -> turn
  else if (name === "rShoulder") y -= yaw * TURN_GAIN;
  return { x, y };
}

export function buildRig(RAPIER: typeof RAPIER_NS, gravityY: number): Rig {
  const world = new RAPIER.World({ x: 0, y: -gravityY, z: 0 });
  const parts: Capsule[] = [];

  // 2.5D plane lock on every dynamic body: free X/Y translation, no Z; rotate only about Z.
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

  const spherical = (b1: RAPIER_NS.RigidBody, a1: Vec2, b2: RAPIER_NS.RigidBody, a2: Vec2) =>
    world.createImpulseJoint(
      RAPIER.JointData.spherical({ x: a1.x, y: a1.y, z: 0 }, { x: a2.x, y: a2.y, z: 0 }),
      b1, b2, true,
    );

  // ---- control bar: kinematic, follows the palm; no collider needed (joints use local anchors) ----
  const control = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, CONTROL_BASE_Y, 0),
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

  // ---- four control strings from the control bar to the torso ----
  const controlT = control.translation();
  const torsoT = torso.translation();
  const strings: PuppetString[] = ATTACH.map((spec) => {
    const top: Vec2 = { x: controlT.x + spec.controlAnchor.x, y: controlT.y + spec.controlAnchor.y };
    const bot: Vec2 = { x: torsoT.x + spec.bodyAnchor.x, y: torsoT.y + spec.bodyAnchor.y };

    if (spec.kind === "rope") {
      // Loose limb string: maxLength carries deliberate slack so it droops (the renderer reads
      // maxLength back to bend the bezier). Tilting/moving the control takes the slack up and poses
      // the limb, so the control still has authority despite the droop.
      const restDist = Math.hypot(top.x - bot.x, top.y - bot.y);
      const maxLength = restDist * LOOSE_ROPE_SLACK;
      const controlJoint = world.createImpulseJoint(
        RAPIER.JointData.rope(
          maxLength,
          { x: spec.controlAnchor.x, y: spec.controlAnchor.y, z: 0 },
          { x: spec.bodyAnchor.x, y: spec.bodyAnchor.y, z: 0 },
        ),
        control, torso,
        true,
      );
      return { name: spec.name, kind: "rope", controlAnchor: spec.controlAnchor, body: torso, bodyAnchor: spec.bodyAnchor, segs: [], controlJoint, maxLength };
    }

    // chain: light segments spawned along the (vertical) line top -> bot so joints don't snap.
    const segs: RAPIER_NS.RigidBody[] = [];
    let prev: RAPIER_NS.RigidBody = control;
    let prevBottom: Vec2 = spec.controlAnchor;
    // The first joint (control -> seg0) is the control-side handle whose anchor1 we foreshorten.
    let controlJoint!: RAPIER_NS.ImpulseJoint;
    for (let i = 0; i < HEAD_SEG_COUNT; i++) {
      const cy = top.y - (i + 0.5) * (SEG_HALF * 2);
      const seg = world.createRigidBody(dyn(top.x, cy));
      world.createCollider(
        RAPIER.ColliderDesc.capsule(SEG_HALF, SEG_RAD).setDensity(0.4).setCollisionGroups(NOSELF),
        seg,
      );
      segs.push(seg);
      const j = spherical(prev, prevBottom, seg, { x: 0, y: SEG_HALF });
      if (i === 0) controlJoint = j;
      prev = seg;
      prevBottom = { x: 0, y: -SEG_HALF };
    }
    spherical(prev, prevBottom, torso, spec.bodyAnchor);
    return { name: spec.name, kind: "chain", controlAnchor: spec.controlAnchor, body: torso, bodyAnchor: spec.bodyAnchor, segs, controlJoint, maxLength: 0 };
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
