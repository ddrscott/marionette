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

// SOFT GOAL-DRIVE STRINGS (capped-force) — the string is NOT a rigid chain. Each frame a CAPPED,
// DAMPED spring force drags the limb's string anchor toward its fingertip GOAL (the control point):
// it pulls only when stretched past the captured rest length (a rope, never a strut) and the pull is
// HARD-CAPPED. Because the cap sits BELOW the strength of the puppet's internal ball joints (which
// stay rigid), a fast/far fingertip can NEVER deliver enough pull to tear a limb out of its socket —
// the limb lags at the cap and follows, it can't rip. This replaces the old rigid finger→limb chain +
// `JointData.rope` (an unbounded coupling that ripped limbs off). Live via the harness sliders.
// These gains are MASS-NORMALIZED (acceleration units): the force applied is part.mass × the clamped
// value below. That makes the pull auto-scale with the part it drives — a light limb (mass ~0.17) and
// the heavy torso (mass ~1.5) and an 8× armed limb all accelerate the SAME toward their goal, so a
// single global cap can't launch the light limbs while barely holding the heavy ones (the trap a raw
// force cap falls into). "No rip" holds because the pull ACCELERATION is bounded, so the impulse the
// ball joint must resist is bounded to ~mass × cap — proportional to the limb, which the joint holds.
export const DEFAULT_STRING_STIFFNESS = 200; // k: pull accel (u/s²) per world-unit of stretch past nominalLen
export const DEFAULT_STRING_DAMPING = 18;    // c: along-string damping (1/s) — kills bounce/rubberband
export const DEFAULT_STRING_FORCE_CAP = 60;  // the no-rip cap: max pull accel (u/s²); >gravity so it holds up

export const CENTER_STRING_LEN = 6.2; // head string length -> 51.7% of a 12u view (> 50% required)

// Collision filtering (high 16 = membership, low 16 = mask of groups it collides with).
const PUPPET_GROUP = 0x00010002; // member group 0, collides with group 1 (floor)
const FLOOR_GROUP  = 0x00020001; // member group 1, collides with group 0 (puppet)

// Floor: static shelf near the bottom so a lowered control rests the puppet on-screen.
export const FLOOR_TOP = 0.8;
const FLOOR_HALF_H = 0.5;
const FLOOR_HALF_W = 50; // wide enough to span any viewport aspect
const FLOOR_HALF_D = 1;  // z-thickness so the z-locked puppet (z=0) always overlaps the floor

// Center divider wall: a thin, effectively-infinite vertical wall at x=0 that stops a puppet from
// twirling OVER the top into the opponent's half (the "kamikaze"), with an OPENING at the bottom —
// ~2 puppet heights above the floor — so the puppets can still meet and fight down low. It shares the
// floor's collision group, so it blocks both puppet parts and string segments.
const PUPPET_HEIGHT = 2;                        // approx head-to-foot span (~1.9 world units)
export const WALL_OPENING = 3 * PUPPET_HEIGHT;  // gap height above the floor (~3 puppet heights)
export const WALL_HALF_W = 0.15;                // wall thickness (x half-extent)
const WALL_TOP = 200;                           // effectively infinite (the view is only 12 tall)

// Puppet weight multiplier (heavier parts keep more tension on the strings). Live via setPuppetWeight.
export const DEFAULT_PUPPET_WEIGHT = 4;

// Solver passes per step. With the soft goal-drive model there are NO string chains — the solver only
// has to hold each puppet's handful of internal ball joints (limbs↔torso) rigid against the capped
// string forces + gravity. That's a light constraint load, so 16 passes is ample (and keeps the ball
// joints firmly satisfied, which is WHY a capped pull can't visibly separate a limb from its socket).
const SOLVER_ITERATIONS = 16;

export interface Vec2 { x: number; y: number; }

// ---- disjoint weapons (the footsies layer) ----------------------------------------------------
// A weapon is a rigid capsule collider bolted onto a limb body, extending PAST its tip along the
// limb's local axis. It gives the puppet cutting REACH beyond its own strings (so you can threaten
// the opponent's strings while your body stays back — the "safe offense" the game lacked), and its
// MASS is the commitment: a heavy blade can't be instantly recalled, so a whiffed swing leaves the
// arm extended and its string exposed to a punish. Cutting a weapon-arm's string DISARMS it (the
// collider is removed) — the middle rung between poking and the kill. See cut.ts.
export interface WeaponDef {
  name: string;
  target: TargetName; // which part holds it (the "weapon arm")
  reach: number;      // how far past the limb's tip the blade extends (world units)
  thickness: number;  // blade collider radius
  density: number;    // mass per volume — the commitment weight
  color: string;
}
export interface Weapon {
  def: WeaponDef;
  collider: RAPIER_NS.Collider; // the compound collider on the limb body; removed on disarm
  disarmed: boolean;            // true once the weapon-arm string is cut (blade dropped)
}

export interface Capsule {
  body: RAPIER_NS.RigidBody; half: number; rad: number; color: string;
  collider: RAPIER_NS.Collider; baseDensity: number; // for the live weight slider (setPuppetWeight)
  neutral: Vec2; // this part's home offset from the torso center — the neutral pose reposePuppet resets to
  neutralRot: number; // this part's home z-rotation (radians) — a canted arm / horizontal body / coil link
  weapon?: Weapon;    // a bolted-on blade (disjoint reach), if this part is a weapon arm — see armPuppet
}

// The humanoid part ids, plus ANY string id so bespoke rigs (see rigs.ts / buildRig) can name their
// own parts (a bear's "head", a mantis's "thorax", a kangaroo's "tail") while the built-in humanoid
// keeps literal-checked names. `(string & {})` preserves the literal autocomplete but widens to string.
export type TargetName = "torso" | "lArm" | "rArm" | "lLeg" | "rLeg" | (string & {});

// One string: a capped, damped spring from a finger control point (its top / GOAL) to a body part.
// There is NO physics chain — the load path is the per-frame goal force (driveStringGoal). The string
// is drawn as a light line pointing at the fingertip.
export interface PuppetString {
  name: string;
  control: RAPIER_NS.RigidBody; // the kinematic finger control point — the string's top / GOAL point
  body: RAPIER_NS.RigidBody;    // the part the string ends on
  target: TargetName;           // which part — so a hand can drive a control BY TARGET (handedness)
  bodyAnchor: Vec2;             // body-local attach point on the part
  nominalLen: number;           // captured rest length (the held-arch chord). The spring pulls ONLY when
                                // the anchor→goal distance exceeds this, so a slack string exerts no force.
  slot: number;                 // finger slot 0..4 (thumb..pinky) — stable colour/number, attach order
  // Cut state. There is no rope joint / chain to tear down: DROPPING the goal force IS the release, so a
  // "cut" string simply stops pulling and its part falls free. `cut` guards double-cut; `cutPt` is the
  // world point of the cut, kept so the severed ends can be drawn dangling instead of vanishing.
  cut: boolean;
  cutPt: Vec2 | null;
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
  controls: RAPIER_NS.RigidBody[]; // 5 finger control points (aligned with `binding`)
  parts: Capsule[];                // torso + limbs
  torso: RAPIER_NS.RigidBody;
  partByTarget: Record<TargetName, RAPIER_NS.RigidBody>; // look a part up by name (for attach)
  strings: PuppetString[];         // finger strings — EMPTY until the attach ritual builds them
  binding: FingerBind[];           // the binding this puppet was built with
  xOffset: number;
  homeTorso: Vec2;                 // torso center at scene setup — the neutral pose it's held at while waiting
  rootId: TargetName;              // the anchor part (id of parts[0]) — homeTorso positions THIS part
  loadout: WeaponDef[];            // the weapons this puppet is armed with — kept so a round reset re-arms
}

// Create the shared world ONCE. The game/harness get a floor + center divider wall (defaults); the
// `/characters` demo opts BOTH out (`{ wall:false, floor:false }`) so nothing fouls a hanging puppet
// or blocks the deselected ones from falling clean off the bottom of the screen.
export function buildWorld(
  RAPIER: typeof RAPIER_NS, gravityY: number,
  opts: { wall?: boolean; floor?: boolean } = {},
): RAPIER_NS.World {
  const { wall = true, floor = true } = opts;
  const world = new RAPIER.World({ x: 0, y: -gravityY, z: 0 });
  world.integrationParameters.numSolverIterations = SOLVER_ITERATIONS;

  // ---- floor: a shared static shelf spanning both puppets ----
  if (floor) {
    const floorBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, FLOOR_TOP - FLOOR_HALF_H, 0),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(FLOOR_HALF_W, FLOOR_HALF_H, FLOOR_HALF_D).setCollisionGroups(FLOOR_GROUP),
      floorBody,
    );
  }

  // ---- center divider wall: x=0, from `openTop` (opening) up to ~infinity ----
  if (wall) {
    const openTop = FLOOR_TOP + WALL_OPENING; // top of the bottom opening = bottom of the wall
    const wallBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, (openTop + WALL_TOP) / 2, 0),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(WALL_HALF_W, (WALL_TOP - openTop) / 2, FLOOR_HALF_D).setCollisionGroups(FLOOR_GROUP),
      wallBody,
    );
  }
  return world;
}

// ---- module-level rig helpers (used by addPuppet AND the attach ritual) ----

// 2.5D plane lock on every dynamic body. zRot pre-rotates (aligns chain segments along a string).
function dynDesc(RAPIER: typeof RAPIER_NS, cx: number, cy: number, zRot = 0): RAPIER_NS.RigidBodyDesc {
  return RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(cx, cy, 0)
    .setRotation({ x: 0, y: 0, z: Math.sin(zRot / 2), w: Math.cos(zRot / 2) })
    .enabledTranslations(true, true, false)
    .enabledRotations(false, false, true)
    .setLinearDamping(DEFAULT_LINEAR_DAMPING)
    .setAngularDamping(DEFAULT_ANGULAR_DAMPING);
}

function spherical(
  RAPIER: typeof RAPIER_NS, world: RAPIER_NS.World,
  b1: RAPIER_NS.RigidBody, a1: Vec2, b2: RAPIER_NS.RigidBody, a2: Vec2,
): RAPIER_NS.ImpulseJoint {
  return world.createImpulseJoint(
    RAPIER.JointData.spherical({ x: a1.x, y: a1.y, z: 0 }, { x: a2.x, y: a2.y, z: 0 }),
    b1, b2, true,
  );
}

// World-space position of a body-LOCAL anchor, honouring the part's z-rotation. This is the point the
// string is bolted to (and drawn to). Identity-ish for upright humanoid parts; matters for canted /
// horizontal / coiled rig parts. Shared by the attach capture, the goal-force drive, and the renderer.
export function anchorWorld(body: RAPIER_NS.RigidBody, a: Vec2): Vec2 {
  const p = body.translation();
  const q = body.rotation();
  const ang = 2 * Math.atan2(q.z, q.w);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  return { x: p.x + a.x * ca - a.y * sa, y: p.y + a.x * sa + a.y * ca };
}

// Add one puppet (torso + limbs + 5 kinematic controls) to the shared world at xOffset. Strings are
// NOT built here — they're created by the attach ritual (attachStringForSlot) so each one captures
// the puppeteer's held finger arch. Until then `strings` is empty and, with nothing holding it up,
// the puppet rests on the floor (the "detached / waiting" state).
export function addPuppet(
  RAPIER: typeof RAPIER_NS,
  world: RAPIER_NS.World,
  xOffset: number,
  binding: FingerBind[],
): Puppet {
  const parts: Capsule[] = [];
  const limb = (cx: number, cy: number, half: number, rad: number, density: number, color: string) => {
    const body = world.createRigidBody(dynDesc(RAPIER, cx, cy));
    body.enableCcd(true); // string-driven parts move fast; CCD stops them tunneling through the thin wall
    const collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(half, rad).setDensity(density).setCollisionGroups(PUPPET_GROUP),
      body,
    );
    parts.push({ body, half, rad, color, collider, baseDensity: density, neutral: { x: 0, y: 0 }, neutralRot: 0 });
    return body;
  };

  // ---- torso + limbs (shifted by xOffset; spherical anchors are body-local, so unchanged) ----
  const X = xOffset;
  const torsoHalf = 0.5;
  // dropped 10% of the view height below the string-length rest point so the puppet/prompt sit lower
  const torsoCY = CONTROL_BASE_Y - CENTER_STRING_LEN - torsoHalf - WORLD_VIEW_HEIGHT * 0.10; // 3.1
  // Duotone: the puppet body stays NEUTRAL (bone torso + muted-gray limbs) so the STRINGS carry the
  // team colour (rust = left / P1, teal = right / P2, applied in draw.ts). Keeps a clean duotone.
  const BONE = "#d8d4cc";   // torso / head
  const LIMB = "#9a968e";   // arms + legs, muted warm gray
  const torso = limb(X + 0, torsoCY, torsoHalf, 0.25, 1.4, BONE);
  const lArm = limb(X - 0.3, torsoCY - 0.1, 0.4, 0.12, 1.0, LIMB);
  const rArm = limb(X + 0.3, torsoCY - 0.1, 0.4, 0.12, 1.0, LIMB);
  spherical(RAPIER, world, torso, { x: -0.3, y: 0.3 }, lArm, { x: 0, y: 0.4 });
  spherical(RAPIER, world, torso, { x:  0.3, y: 0.3 }, rArm, { x: 0, y: 0.4 });
  const lLeg = limb(X - 0.15, torsoCY - 0.95, 0.45, 0.14, 1.1, LIMB);
  const rLeg = limb(X + 0.15, torsoCY - 0.95, 0.45, 0.14, 1.1, LIMB);
  spherical(RAPIER, world, torso, { x: -0.15, y: -0.5 }, lLeg, { x: 0, y: 0.45 });
  spherical(RAPIER, world, torso, { x:  0.15, y: -0.5 }, rLeg, { x: 0, y: 0.45 });

  // Record each part's offset from the torso center — the NEUTRAL pose. reposePuppet resets to this
  // (instead of carrying over a crumpled floor pose) so strings always attach to a clean hang.
  const tp = torso.translation();
  for (const p of parts) { const c = p.body.translation(); p.neutral = { x: c.x - tp.x, y: c.y - tp.y }; }

  const partByTarget: Record<TargetName, RAPIER_NS.RigidBody> = { torso, lArm, rArm, lLeg, rLeg };

  // 5 kinematic finger controls, parked above their default part. Strings get built onto them later.
  const controls: RAPIER_NS.RigidBody[] = binding.map((f) => {
    const bt = partByTarget[f.target].translation();
    return world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(bt.x + f.bodyAnchor.x, CONTROL_BASE_Y, 0),
    );
  });

  return { controls, parts, torso, partByTarget, strings: [], binding, xOffset, homeTorso: { x: tp.x, y: tp.y }, rootId: "torso", loadout: [] };
}

// ---- data-driven rigs (the character roster) --------------------------------------------------
// A bespoke puppet as plain data: capsule parts (positioned RELATIVE to the root part at 0,0),
// internal spherical joints, and a 5-finger binding onto those part ids. buildRig() below turns one
// into the same `Puppet` the humanoid uses, so the attach ritual / cut / draw all work unchanged.
// See rigs.ts for the ten characters. parts[0] is the ROOT (what homeTorso positions).
// `rot` (optional, radians) is the part's NEUTRAL z-rotation: 0 = upright capsule (drawn along local
// +y), π/2 = horizontal, small values = a canted limb. It's applied at build (initial body rotation)
// AND re-asserted every frame by reposePuppet, so a horizontal beast / coiled serpent / inverted rig
// HOLDS its pose at neutral instead of being forced upright. Joint anchors stay body-local (unrotated).
export interface PartDef { id: string; dx: number; dy: number; half: number; rad: number; density: number; color: string; rot?: number; }
export interface JointDef { a: string; ax: number; ay: number; b: string; bx: number; by: number; }
export interface RigDef { name: string; accent: string; parts: PartDef[]; joints: JointDef[]; binding: FingerBind[]; }

// Build a bespoke rig at world `center` (the root part's center). Same shape as addPuppet's humanoid,
// so everything downstream (reposePuppet, attach ritual, cut, draw) treats it identically.
export function buildRig(RAPIER: typeof RAPIER_NS, world: RAPIER_NS.World, center: Vec2, def: RigDef): Puppet {
  const parts: Capsule[] = [];
  const byId: Record<string, RAPIER_NS.RigidBody> = {};
  for (const pd of def.parts) {
    const rot = pd.rot ?? 0;
    const body = world.createRigidBody(dynDesc(RAPIER, center.x + pd.dx, center.y + pd.dy, rot));
    body.enableCcd(true);
    const collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(pd.half, pd.rad).setDensity(pd.density).setCollisionGroups(PUPPET_GROUP),
      body,
    );
    // dx/dy are already relative to the root, so they ARE the neutral offset reposePuppet resets to;
    // rot is the neutral tilt it holds (upright unless the rig cants/lays this part out).
    parts.push({ body, half: pd.half, rad: pd.rad, color: pd.color, collider, baseDensity: pd.density, neutral: { x: pd.dx, y: pd.dy }, neutralRot: rot });
    byId[pd.id] = body;
  }
  for (const j of def.joints) spherical(RAPIER, world, byId[j.a], { x: j.ax, y: j.ay }, byId[j.b], { x: j.bx, y: j.by });

  const partByTarget = byId as Record<TargetName, RAPIER_NS.RigidBody>;
  const controls: RAPIER_NS.RigidBody[] = def.binding.map((f) => {
    const bt = byId[f.target].translation();
    return world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(bt.x + f.bodyAnchor.x, CONTROL_BASE_Y, 0),
    );
  });

  const root = def.parts[0];
  return {
    controls, parts, torso: byId[root.id], partByTarget, strings: [], binding: def.binding,
    xOffset: center.x, homeTorso: { x: center.x, y: center.y }, rootId: root.id, loadout: [],
  };
}

// Remove a whole puppet from the world (parts + controls). removeRigidBody takes each body's colliders
// + attached joints with it, so this fully frees a deselected/reset puppet. Strings carry no bodies of
// their own now (the goal-drive is a per-frame force), so clearing the array releases them.
export function removePuppet(world: RAPIER_NS.World, p: Puppet): void {
  for (const part of p.parts) world.removeRigidBody(part.body);
  for (const c of p.controls) world.removeRigidBody(c);
  p.strings = [];
}

// Reset the puppet to its NEUTRAL pose — each part at its home offset from the torso, upright, still —
// with the torso placed at `torsoTarget`. Used at attach so the strings always bind to a clean hang
// under the held hand (torso ~CENTER_STRING_LEN below the middle fingertip), NOT to whatever crumpled
// shape it settled into while resting on the floor.
export function reposePuppet(puppet: Puppet, torsoTarget: Vec2): void {
  for (const p of puppet.parts) {
    p.body.setTranslation({ x: torsoTarget.x + p.neutral.x, y: torsoTarget.y + p.neutral.y, z: 0 }, true);
    // Restore this part's NEUTRAL tilt (z-only lock). Most parts are upright (neutralRot 0 => identity);
    // canted limbs / horizontal beasts / coiled serpents hold their designed angle here.
    const hz = p.neutralRot / 2;
    p.body.setRotation({ x: 0, y: 0, z: Math.sin(hz), w: Math.cos(hz) }, true);
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

// Attach ONE finger's string (slot 0..4 = thumb..pinky). The control is teleported to `controlPos` (the
// captured fingertip) and the string's REST LENGTH is captured as the current control→part-anchor chord,
// so it encodes the held arch. No physics chain is built — the coupling is the per-frame capped goal
// force (driveStringGoal). `bind` is the driving hand's binding row for this slot. `RAPIER`/`world` are
// unused now (the string carries no bodies) but kept in the signature so the attach-ritual call sites
// (engine.ts / pilot.ts) stay identical.
export function attachStringForSlot(
  _RAPIER: typeof RAPIER_NS, _world: RAPIER_NS.World,
  puppet: Puppet, slot: number, controlPos: Vec2, bind: FingerBind,
): void {
  const control = puppet.controls[slot];
  control.setTranslation({ x: controlPos.x, y: controlPos.y, z: 0 }, true);
  const part = puppet.partByTarget[bind.target];
  const anchor = anchorWorld(part, bind.bodyAnchor);
  const nominalLen = Math.hypot(anchor.x - controlPos.x, anchor.y - controlPos.y) || 1e-3;
  puppet.strings.push({ name: bind.name, control, body: part, target: bind.target, bodyAnchor: bind.bodyAnchor, nominalLen, slot, cut: false, cutPt: null });
}

// THE LOAD PATH — apply one string's capped, damped spring GOAL pull this frame, dragging its part's
// anchor toward the fingertip (the control). It's a ROPE-spring: zero while slack (anchor within
// nominalLen of the goal, so gravity just hangs the part), then a pull ACCELERATION `k*stretch -
// c*closingVel` toward the goal, HARD-CAPPED at `cap`, turned into a force by ×part.mass. The mass
// scaling is what keeps it rip-proof AND stable across wildly different part masses (see the constants
// above): the impulse the ball joint must resist is bounded to ~mass×cap, proportional to the limb, so
// the joint always holds — the limb lags at the cap and follows, it can't tear off. A string only ever
// PULLS (mag >= 0), never pushes. Applied AT the anchor point so it also orients the limb (a real
// string tugs the tip only in feel — we apply at the COM as a one-shot IMPULSE per step). Applied as an
// impulse (force × dt) NOT addForce: Rapier's addForce persists and re-applies every step, so a
// per-frame addForce accumulates and the puppet runs away. No-op once cut (dropping it IS release).
export function driveStringGoal(s: PuppetString, k: number, c: number, cap: number, dt: number): void {
  if (s.cut) return;
  const goal = s.control.translation();
  const anchor = anchorWorld(s.body, s.bodyAnchor);
  const dx = goal.x - anchor.x, dy = goal.y - anchor.y;
  const dist = Math.hypot(dx, dy) || 1e-6;
  const stretch = dist - s.nominalLen;
  if (stretch <= 0) return; // slack: no pull
  const ux = dx / dist, uy = dy / dist;
  const v = s.body.linvel();
  const closing = v.x * ux + v.y * uy; // >0 = part moving toward the goal (the string relaxing)
  let a = k * stretch - c * closing; // pull ACCELERATION toward the goal (rope: only past nominalLen)
  if (a < 0) a = 0;      // a string only pulls, never pushes
  if (a > cap) a = cap;  // the no-rip cap (acceleration; ×mass·dt below keeps it rip-proof across masses)
  const j = a * s.body.mass() * dt; // impulse = force × dt (a·m·dt)
  s.body.applyImpulse({ x: ux * j, y: uy * j, z: 0 }, true);
}

// Drive EVERY string of a puppet (the shared per-frame call for engine.ts + pilot.ts — keeps the goal
// math in one place). Cut strings are skipped inside driveStringGoal.
export function driveStrings(puppet: Puppet, k: number, c: number, cap: number, dt: number): void {
  for (const s of puppet.strings) driveStringGoal(s, k, c, cap, dt);
}

// CUT a string (by finger slot): stop its goal force so the part it held falls free, and mark WHERE it
// was cut (`at`, world point) so the severed ends can be drawn dangling. The string OBJECT stays (both
// stubs still render). Returns the part it held, or null if the string is missing / already cut.
export function cutString(puppet: Puppet, slot: number, at: Vec2): TargetName | null {
  const s = puppet.strings.find((x) => x.slot === slot);
  if (!s || s.cut) return null;
  s.cut = true;
  s.cutPt = { x: at.x, y: at.y };
  return s.target;
}

// Sever every still-intact string — the full collapse when a puppet is killed, so all strings dangle
// (their parts fall) instead of vanishing. Cuts at each string's current midpoint.
export function cutAllIntact(puppet: Puppet): void {
  for (const s of puppet.strings) if (!s.cut) {
    const top = s.control.translation();
    const anchor = anchorWorld(s.body, s.bodyAnchor);
    s.cut = true;
    s.cutPt = { x: (top.x + anchor.x) / 2, y: (top.y + anchor.y) / 2 };
  }
}

// Cut ALL strings and drop them from the list. With no goal force holding it up the puppet falls to the
// floor — the reset. (Controls + parts remain; the strings carry no bodies to remove.)
export function detachAllStrings(puppet: Puppet): void {
  puppet.strings = [];
}

// Cut ONE string (by finger slot) and drop it from the list. Returns the part it held (so the caller
// can react — e.g. cutting the `torso`/head string is the kill), or null if absent.
export function detachString(puppet: Puppet, slot: number): TargetName | null {
  const idx = puppet.strings.findIndex((s) => s.slot === slot);
  if (idx < 0) return null;
  const s = puppet.strings[idx];
  puppet.strings.splice(idx, 1);
  return s.target;
}

// Zero linear + angular velocity on the PUPPET PARTS without moving them (reposePuppet teleports; this
// doesn't). Used at release to strip any residual part velocity before the goal forces take over, so
// the puppet hands over at rest (the anti-seizure guarantee — no carried energy to spasm).
export function stillParts(puppet: Puppet): void {
  for (const p of puppet.parts) {
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}

// Swing damping on the PUPPET PARTS (the "drag" / float knob) + the post-attach settle ramp lever.
export function setDamping(puppet: Puppet, linear: number, angular: number): void {
  for (const p of puppet.parts) { p.body.setLinearDamping(linear); p.body.setAngularDamping(angular); }
}

// Scale puppet mass at runtime (part density = baseDensity * weight). Heavier parts want a higher force
// cap to hold up (the strings pull harder), so weight and the string cap are tuned together.
// Note: recomputeMassPropertiesFromColliders sums ALL colliders on the body, so a bolted-on weapon's
// mass rides along here for free — only the part's OWN collider density is scaled by weight.
export function setPuppetWeight(puppet: Puppet, weight: number): void {
  for (const p of puppet.parts) {
    p.collider.setDensity(p.baseDensity * weight);
    p.body.recomputeMassPropertiesFromColliders();
  }
}

// ---- weapons (disjoint reach) -----------------------------------------------------------------

// World point at local (0, -dist) along a limb's axis (its free-end / "down" direction). dist = half
// is the bare capsule tip; half + weapon.reach is the blade tip. Matches cut.ts's tipOf exactly, so
// cut detection, mass, and rendering all agree on where the blade is. Shared by cut + draw.
export function limbAxisPoint(part: Capsule, dist: number): Vec2 {
  const p = part.body.translation();
  const q = part.body.rotation();
  const th = 2 * Math.atan2(q.z, q.w); // z-only rotation
  return { x: p.x + dist * Math.sin(th), y: p.y - dist * Math.cos(th) };
}

// A part's LIVE weapon reach (0 if unarmed or disarmed) — the cut sampler adds this to the limb half.
export const liveWeaponReach = (part: Capsule): number =>
  part.weapon && !part.weapon.disarmed ? part.weapon.def.reach : 0;

// Does this puppet carry any live (non-disarmed) weapon? cut.ts uses weapon tips when armed and falls
// back to bare limbs only for a wholly-unarmed puppet (so /characters rigs still work unchanged).
export const isArmed = (puppet: Puppet): boolean =>
  puppet.parts.some((c) => c.weapon && !c.weapon.disarmed);

// Arm a puppet from a loadout: bolt each weapon's capsule collider onto its target limb, extending
// PAST the tip along the limb axis, and stash it on the limb's Capsule. Rebuilds from scratch each
// call (clearing any existing weapon colliders first), so it also RE-ARMS blades a disarm dropped —
// call it at round start. The collider density is the commitment mass; body mass is recomputed to
// include it. The weapon shares PUPPET_GROUP, so the center divider wall still blocks it.
export function armPuppet(RAPIER: typeof RAPIER_NS, world: RAPIER_NS.World, puppet: Puppet, defs: WeaponDef[]): void {
  for (const part of puppet.parts) {
    if (part.weapon) {
      if (!part.weapon.disarmed) world.removeCollider(part.weapon.collider, true);
      part.weapon = undefined;
      part.body.recomputeMassPropertiesFromColliders();
    }
  }
  puppet.loadout = defs;
  for (const def of defs) {
    const body = puppet.partByTarget[def.target];
    if (!body) continue;
    const part = puppet.parts.find((c) => c.body === body);
    if (!part) continue;
    const halfLen = def.reach / 2;
    const collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(halfLen, def.thickness)
        .setDensity(def.density)
        .setTranslation(0, -(part.half + halfLen), 0) // local: centered just past the limb tip
        .setCollisionGroups(PUPPET_GROUP),
      body,
    );
    part.weapon = { def, collider, disarmed: false };
    body.recomputeMassPropertiesFromColliders();
  }
}

// Drop a limb's weapon (remove the collider, mark disarmed) — the reward for cutting a weapon arm's
// string. The limb itself remains (still jointed to the torso) but can no longer cut. Idempotent.
export function disarmWeapon(world: RAPIER_NS.World, part: Capsule): boolean {
  const w = part.weapon;
  if (!w || w.disarmed) return false;
  world.removeCollider(w.collider, true);
  w.disarmed = true;
  part.body.recomputeMassPropertiesFromColliders();
  return true;
}
