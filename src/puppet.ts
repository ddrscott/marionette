import type RAPIER_NS from "@dimforge/rapier3d-compat";

// ---- terminology (per https://en.wikipedia.org/wiki/Marionette) ----
// Spike-2 control: we drop the rigid "control bar" (crossbeam) and instead give each FINGER its own
// string to a body part — the puppeteer's fingertips ARE the control points. (Fingers → individual
// strings is the PRD §7 spike-2 increment, pulled forward.)

// ---- world layout (the renderer shows WORLD_VIEW_HEIGHT units tall) ----
export const WORLD_VIEW_HEIGHT = 12;
export const CONTROL_BASE_Y = 11; // default height of the finger control points (top of the view)

// Damping. LINEAR damping is velocity drag = air resistance: too much caps fall speed at terminal
// velocity (≈ gravity/linDamp) and the puppet FLOATS. Kept low (0.4 → natural fall); the slider
// raises it. ANGULAR damping settles spin without touching the fall, so it stays higher.
// These apply to the PUPPET PARTS only.
export const DEFAULT_LINEAR_DAMPING = 0.4;
export const DEFAULT_ANGULAR_DAMPING = 1.0;

// STRING FRICTION — damping on the chain SEGMENTS, decoupled from the puppet's fall. The heavy
// segments otherwise wobble in long S-curves and take ~20s to rest; this is the "joint friction"
// (per-link velocity/spin drag) that calms them. Higher = stiffer/settles faster; too high and the
// strings lag the control (sluggish). Live via the string-friction slider. Segment angular damping =
// friction * STRING_ANG_RATIO (bending needs more than translation).
export const DEFAULT_STRING_FRICTION = 8;
const STRING_ANG_RATIO = 2;

export const CENTER_STRING_LEN = 6.2; // head string length -> 51.7% of a 12u view (> 50% required)

// Strings are CHAINS of stiff segment links (spherical joints): inextensible (no rubberband) but
// free to FOLD at every hinge, so they drape/go-slack and never snap-bounce. `STRING_SLACK` 1.0 =>
// chain length is exactly the straight-line span, so the string is straight/taut at the rest pose.
const SEG_COUNT = 10;
const SEG_RAD = 0.04;
// Heavy links so the strings read as CHAINS (hang/swing with visible weight), not floaty thread.
// Sized for the DEFAULT puppet weight (4×): each string's total mass (~0.08) stays well under the
// lightest limb it pulls — the arm (~0.17 at weight 4) — so the puppet drives the strings, never the
// reverse (no "tail wags dog" limb whipping). Heavier links also improve the link↔puppet mass ratio,
// which REDUCES chain stretch, and fall faster under the linear drag (less floaty).
// CAVEAT: puppet weight is a live slider (1–12). At very low weight the limbs get light enough that a
// heavy string can approach/exceed limb mass (e.g. at weight 1 the arm is ~0.043 < string ~0.08),
// where wagging can creep in. The default (4×) is the design point; this is intentional.
const SEG_DENSITY = 2.0;
const STRING_SLACK = 1.0;

// Collision filtering (high 16 = membership, low 16 = mask of groups it collides with).
const PUPPET_GROUP = 0x00010002; // member group 0, collides with group 1 (floor)
const STRING_GROUP = 0x00010002; // member group 0, collides with the floor (bit1) but not the puppet or other segments
const FLOOR_GROUP  = 0x00020001; // member group 1, collides with group 0 (puppet)

// Floor: static shelf near the bottom so a lowered control rests the puppet on-screen.
export const FLOOR_TOP = 0.8;
const FLOOR_HALF_H = 0.5;
const FLOOR_HALF_W = 50; // wide enough to span any viewport aspect
const FLOOR_HALF_D = 1;  // z-thickness so the z-locked puppet (z=0) always overlaps the floor

// Puppet weight multiplier (heavier parts keep more tension on the strings). Live via setPuppetWeight.
export const DEFAULT_PUPPET_WEIGHT = 4;

// A 5-string rig with closed loops needs many solver passes to keep the chains rigid; cheap enough.
const SOLVER_ITERATIONS = 48;

export interface Vec2 { x: number; y: number; }
export interface Capsule {
  body: RAPIER_NS.RigidBody; half: number; rad: number; color: string;
  collider: RAPIER_NS.Collider; baseDensity: number; // for the live weight slider (setPuppetWeight)
}

export type TargetName = "torso" | "lArm" | "rArm" | "lLeg" | "rLeg";

// One string: a chain from a finger control point (its top) to a body part.
export interface PuppetString {
  name: string;
  control: RAPIER_NS.RigidBody; // the kinematic finger control point — the string's top
  body: RAPIER_NS.RigidBody;    // the part the string ends on
  target: TargetName;           // which part — so a hand can drive a control BY TARGET (handedness)
  bodyAnchor: Vec2;             // body-local
  segs: RAPIER_NS.RigidBody[];  // the chain links, control-side -> body-side
  nominalLen: number;           // total chain length (its inextensible limit)
}

// Finger → part bindings. Fingers 1..5 = thumb..pinky (MediaPipe fingertip landmarks 4/8/12/16/20).
// This is the seam for the future puppet editor — re-point any finger at any part here.
export interface FingerBind { name: string; landmark: number; target: TargetName; bodyAnchor: Vec2; }

// The fingertip landmark per finger slot (0..4 = thumb..pinky), in FINGERS order.
export const FINGERTIPS = [4, 8, 12, 16, 20];

// This is the RIGHT-hand binding: in the selfie-mirrored view a right hand's thumb sits screen-LEFT,
// so the thumb drives the screen-LEFT part (lArm) and the pinky the screen-RIGHT part (rArm) — no
// crossing. The left-hand binding is the L↔R mirror of this (see mirrorBinding / LEFT_HAND_BINDING).
export const FINGERS: FingerBind[] = [
  { name: "1 thumb→L.hand",  landmark: 4,  target: "lArm",  bodyAnchor: { x: 0, y: -0.4 } },
  { name: "2 index→L.foot",  landmark: 8,  target: "lLeg",  bodyAnchor: { x: 0, y: -0.45 } },
  { name: "3 middle→head",   landmark: 12, target: "torso", bodyAnchor: { x: 0, y: 0.5 } },
  { name: "4 ring→R.foot",   landmark: 16, target: "rLeg",  bodyAnchor: { x: 0, y: -0.45 } },
  { name: "5 pinky→R.hand",  landmark: 20, target: "rArm",  bodyAnchor: { x: 0, y: -0.4 } },
];

// L↔R mirror of a binding: swap each part's left/right side (head/torso stays), keep the landmark
// order. Used to build the LEFT-hand binding so the OTHER hand also never crosses its strings.
const MIRRORED_TARGET: Record<TargetName, TargetName> = {
  torso: "torso", lArm: "rArm", rArm: "lArm", lLeg: "rLeg", rLeg: "lLeg",
};
const swapLR = (s: string): string => s.replace(/[LR]\./g, (m) => (m[0] === "L" ? "R." : "L."));
export function mirrorBinding(binding: FingerBind[]): FingerBind[] {
  return binding.map((f) => ({
    name: swapLR(f.name),
    landmark: f.landmark,
    target: MIRRORED_TARGET[f.target],
    bodyAnchor: { x: -f.bodyAnchor.x, y: f.bodyAnchor.y },
  }));
}

export const RIGHT_HAND_BINDING = FINGERS;            // thumb screen-left → screen-left part
export const LEFT_HAND_BINDING = mirrorBinding(FINGERS); // thumb screen-right → screen-right part

// --- THE FLIPPABLE HANDEDNESS CONSTANT ---
// MediaPipe reports handedness from the UNMIRRORED camera image (`categoryName` "Left"/"Right"), but
// our preview + stage are selfie-MIRRORED. Empirically (user-confirmed on a live webcam) the raw
// MediaPipe label already matches our mirrored stage, so we do NOT invert it. `false` = use the
// label as-is. If the connections ever come out crossed again, flip this back to `true`.
export const HANDEDNESS_LABEL_IS_MIRRORED = false;

// Choose the no-crossing binding for a detected hand from its MediaPipe handedness label.
export function bindingForHandedness(categoryName: string): FingerBind[] {
  const physical = HANDEDNESS_LABEL_IS_MIRRORED
    ? categoryName === "Left" ? "Right" : "Left"
    : categoryName;
  return physical === "Right" ? RIGHT_HAND_BINDING : LEFT_HAND_BINDING;
}

// Puppets sit side by side at ±this x-offset in the shared world.
export const PUPPET_X_OFFSET = 3;

export interface Puppet {
  controls: RAPIER_NS.RigidBody[]; // 5 finger control points (aligned with `binding` / `strings`)
  parts: Capsule[];                // torso + limbs
  torso: RAPIER_NS.RigidBody;
  strings: PuppetString[];         // 5 finger strings (each carries its target part)
  binding: FingerBind[];           // the binding this puppet was built with
  xOffset: number;
}

// Create the shared world + floor ONCE. Each puppet is then added via addPuppet at an x-offset.
export function buildWorld(RAPIER: typeof RAPIER_NS, gravityY: number): RAPIER_NS.World {
  const world = new RAPIER.World({ x: 0, y: -gravityY, z: 0 });
  world.integrationParameters.numSolverIterations = SOLVER_ITERATIONS;

  // ---- floor: a shared static shelf spanning both puppets ----
  const floorBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, FLOOR_TOP - FLOOR_HALF_H, 0),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(FLOOR_HALF_W, FLOOR_HALF_H, FLOOR_HALF_D).setCollisionGroups(FLOOR_GROUP),
    floorBody,
  );
  return world;
}

// Add one puppet (torso + limbs + 5 controls + 5 chain strings) to the shared world at xOffset.
// Physics is identical to the original single-puppet rig — only the x position is shifted.
export function addPuppet(
  RAPIER: typeof RAPIER_NS,
  world: RAPIER_NS.World,
  xOffset: number,
  binding: FingerBind[],
): Puppet {
  const parts: Capsule[] = [];

  // 2.5D plane lock on every dynamic body. zRot pre-rotates (aligns chain segments along a string).
  const dyn = (cx: number, cy: number, zRot = 0) =>
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(cx, cy, 0)
      .setRotation({ x: 0, y: 0, z: Math.sin(zRot / 2), w: Math.cos(zRot / 2) })
      .enabledTranslations(true, true, false)
      .enabledRotations(false, false, true)
      .setLinearDamping(DEFAULT_LINEAR_DAMPING)
      .setAngularDamping(DEFAULT_ANGULAR_DAMPING);

  const limb = (cx: number, cy: number, half: number, rad: number, density: number, color: string) => {
    const body = world.createRigidBody(dyn(cx, cy));
    const collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(half, rad).setDensity(density).setCollisionGroups(PUPPET_GROUP),
      body,
    );
    parts.push({ body, half, rad, color, collider, baseDensity: density });
    return body;
  };

  const spherical = (b1: RAPIER_NS.RigidBody, a1: Vec2, b2: RAPIER_NS.RigidBody, a2: Vec2) =>
    world.createImpulseJoint(
      RAPIER.JointData.spherical({ x: a1.x, y: a1.y, z: 0 }, { x: a2.x, y: a2.y, z: 0 }),
      b1, b2, true,
    );

  // ---- torso + limbs (shifted by xOffset; spherical anchors are body-local, so unchanged) ----
  const X = xOffset;
  const torsoHalf = 0.5;
  const torsoCY = CONTROL_BASE_Y - CENTER_STRING_LEN - torsoHalf; // 4.3
  const torso = limb(X + 0, torsoCY, torsoHalf, 0.25, 1.4, "#e8e8e8");
  const lArm = limb(X - 0.3, torsoCY - 0.1, 0.4, 0.12, 1.0, "#39d98a");
  const rArm = limb(X + 0.3, torsoCY - 0.1, 0.4, 0.12, 1.0, "#39d98a");
  spherical(torso, { x: -0.3, y: 0.3 }, lArm, { x: 0, y: 0.4 });
  spherical(torso, { x:  0.3, y: 0.3 }, rArm, { x: 0, y: 0.4 });
  const lLeg = limb(X - 0.15, torsoCY - 0.95, 0.45, 0.14, 1.1, "#5b8cff");
  const rLeg = limb(X + 0.15, torsoCY - 0.95, 0.45, 0.14, 1.1, "#5b8cff");
  spherical(torso, { x: -0.15, y: -0.5 }, lLeg, { x: 0, y: 0.45 });
  spherical(torso, { x:  0.15, y: -0.5 }, rLeg, { x: 0, y: 0.45 });

  const targets: Record<TargetName, RAPIER_NS.RigidBody> = { torso, lArm, rArm, lLeg, rLeg };

  // ---- chain builder: SEG_COUNT stiff links from a control body's origin to body@anchor ----
  const buildChain = (fromBody: RAPIER_NS.RigidBody, toBody: RAPIER_NS.RigidBody, toAnchor: Vec2) => {
    const f = fromBody.translation();
    const top = { x: f.x, y: f.y };
    const bt = toBody.translation();
    const bot = { x: bt.x + toAnchor.x, y: bt.y + toAnchor.y };
    const restDist = Math.hypot(bot.x - top.x, bot.y - top.y) || 1e-3;
    const nominalLen = restDist * STRING_SLACK;
    const segHalf = nominalLen / SEG_COUNT / 2;
    const theta = Math.atan2((bot.x - top.x) / restDist, -(bot.y - top.y) / restDist);
    const segs: RAPIER_NS.RigidBody[] = [];
    let prev = fromBody;
    let prevBottom: Vec2 = { x: 0, y: 0 }; // control point = the body origin
    for (let i = 0; i < SEG_COUNT; i++) {
      const t = (i + 0.5) / SEG_COUNT;
      const seg = world.createRigidBody(dyn(top.x + (bot.x - top.x) * t, top.y + (bot.y - top.y) * t, theta));
      world.createCollider(
        RAPIER.ColliderDesc.capsule(segHalf, SEG_RAD).setDensity(SEG_DENSITY).setCollisionGroups(STRING_GROUP),
        seg,
      );
      // string friction: heavily damp the link (decoupled from the puppet) so chains settle, not floppy.
      seg.setLinearDamping(DEFAULT_STRING_FRICTION);
      seg.setAngularDamping(DEFAULT_STRING_FRICTION * STRING_ANG_RATIO);
      segs.push(seg);
      spherical(prev, prevBottom, seg, { x: 0, y: segHalf });
      prev = seg;
      prevBottom = { x: 0, y: -segHalf };
    }
    spherical(prev, prevBottom, toBody, toAnchor);
    return { segs, nominalLen };
  };

  // ---- one finger control point + string per binding row ----
  const controls: RAPIER_NS.RigidBody[] = [];
  const strings: PuppetString[] = binding.map((f) => {
    const body = targets[f.target];
    const bt = body.translation();
    // default control point: straight above the part's anchor at the top -> string vertical at spawn.
    const control = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(bt.x + f.bodyAnchor.x, CONTROL_BASE_Y, 0),
    );
    controls.push(control);
    const { segs, nominalLen } = buildChain(control, body, f.bodyAnchor);
    return { name: f.name, control, body, target: f.target, bodyAnchor: f.bodyAnchor, segs, nominalLen };
  });

  return { controls, parts, torso, strings, binding, xOffset };
}

// Swing damping on the PUPPET PARTS (the "drag" / float knob). Segments are handled separately by
// setStringFriction so the string settling is decoupled from the puppet's fall.
export function setDamping(puppet: Puppet, linear: number, angular: number): void {
  for (const p of puppet.parts) { p.body.setLinearDamping(linear); p.body.setAngularDamping(angular); }
}

// String friction (the "joint friction" knob): per-segment velocity + spin damping. Decoupled from
// the parts so cranking it calms the floppy chains WITHOUT floating the puppet's fall. Too high and
// the strings lag the control (sluggish).
export function setStringFriction(puppet: Puppet, friction: number): void {
  for (const s of puppet.strings) for (const seg of s.segs) {
    seg.setLinearDamping(friction);
    seg.setAngularDamping(friction * STRING_ANG_RATIO);
  }
}

// Scale puppet mass at runtime (part density = baseDensity * weight). Segments stay light on purpose.
export function setPuppetWeight(puppet: Puppet, weight: number): void {
  for (const p of puppet.parts) {
    p.collider.setDensity(p.baseDensity * weight);
    p.body.recomputeMassPropertiesFromColliders();
  }
}
