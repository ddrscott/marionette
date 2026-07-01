// The character roster — ten bespoke marionette rigs as plain data (see design/puppet-roster.md).
// Every rig is driven by the SAME five finger-strings (slots 0..4 = thumb,index,middle,ring,pinky),
// with the MIDDLE finger (slot 2) carrying the keystone/root string — it MUST target the rig's main
// mass so Pilot.beginAttach can centre that part under the middle fingertip. Parts are capsules
// positioned RELATIVE to the root part (parts[0]) at (0,0); +y is up, +x is screen-right. A part may
// carry an optional `rot` (radians, z-tilt) so a rig can lie HORIZONTAL, COIL, or hang INVERTED —
// reposePuppet re-asserts that neutral tilt each frame (see puppet.ts PartDef.rot).
//
// SILHOUETTE VARIETY (the point of this roster — no two read as the same biped):
//   1 JACKHAMMER  asymmetric one-giant-arm bruiser (off-centre mass)
//   2 IRON FIST   tiny torso, extremely long spindly reach
//   3 NIGHTSHADE  legless S-coiled serpent (5 strings along its length)
//   4 FURNACE     huge titan — massive body dwarfing tiny thick limbs
//   5 INVERSA     inverted: heavy kicking legs held UP, thin arms plant DOWN
//   6 THE MOUNTAIN wide low horizontal tank on many stubby legs
//   7 THE WIDOW   legless drifting orb, 5 strings fanned around the rim
//   8 THE JOEY    tiny fast gremlin (whole rig scaled small)
//   9 THE URSINE  horizontal quadruped beast (body lies flat, head out front)
//  10 THE REAPER  many-legged insect — small thorax + six spindly legs
//
// STRINGS DECOUPLE FROM LIMBS: a legless orb / serpent still gets its five cuttable strings by
// binding multiple slots to different anchors along the SAME body (buildRig already supports this).
import { FINGERTIPS, type RigDef, type FingerBind } from "./puppet.ts";

// One binding row: finger `slot` (0..4) drives part `target` at its body-local anchor (ax,ay).
const fb = (slot: number, target: string, ax: number, ay: number): FingerBind =>
  ({ name: `${slot + 1}`, landmark: FINGERTIPS[slot], target, bodyAnchor: { x: ax, y: ay } });

// Muted, on-theme accents (duotone-ish: bone bodies, a signature accent per fighter so the roster
// reads as ten distinct characters without going rainbow — "this is not for kids").
const BONE = "#d8d4cc";
const GRAY = "#9a968e";
const RUST = "#b5674a";
const TEAL = "#4fb0aa";
const SLATE = "#6b7280";
const OLIVE = "#8a8560";
const PLUM = "#8a6b78";
const STEEL = "#7f8c99";
const SAND = "#b7a37e";
const MOSS = "#6f8a6a";

const HALF_PI = Math.PI / 2;

export const RIGS: RigDef[] = [
  // 1. JACKHAMMER — asymmetric one-giant-arm bruiser: a small torso with a huge wrecking-ball arm off
  // to one side; the other arm a stub, stubby legs. Mass lives out on the fist -> lopsided silhouette.
  {
    name: "JACKHAMMER", accent: RUST,
    parts: [
      { id: "torso", dx: 0, dy: 0, half: 0.40, rad: 0.28, density: 1.8, color: BONE },
      { id: "bigUpper", dx: 0.72, dy: 0.18, half: 0.42, rad: 0.22, density: 2.2, color: RUST, rot: -0.5 },
      { id: "bigFist", dx: 1.20, dy: -0.30, half: 0.26, rad: 0.44, density: 3.4, color: RUST },
      { id: "lArm", dx: -0.50, dy: 0.05, half: 0.32, rad: 0.10, density: 1.0, color: GRAY, rot: 0.3 },
      { id: "lLeg", dx: -0.26, dy: -0.85, half: 0.36, rad: 0.16, density: 1.6, color: GRAY },
      { id: "rLeg", dx: 0.26, dy: -0.85, half: 0.36, rad: 0.16, density: 1.6, color: GRAY },
    ],
    joints: [
      { a: "torso", ax: 0.28, ay: 0.2, b: "bigUpper", bx: 0, by: 0.42 },
      { a: "bigUpper", ax: 0, ay: -0.42, b: "bigFist", bx: 0, by: 0.26 },
      { a: "torso", ax: -0.28, ay: 0.15, b: "lArm", bx: 0, by: 0.32 },
      { a: "torso", ax: -0.2, ay: -0.35, b: "lLeg", bx: 0, by: 0.36 },
      { a: "torso", ax: 0.2, ay: -0.35, b: "rLeg", bx: 0, by: 0.36 },
    ],
    binding: [fb(0, "lArm", 0, -0.32), fb(1, "lLeg", 0, -0.36), fb(2, "torso", 0, 0.4), fb(3, "rLeg", 0, -0.36), fb(4, "bigFist", 0, 0)],
  },

  // 2. IRON FIST — spindly long-reach zoner: a tiny torso with extremely long, thin arms and legs.
  // Reads as all-limbs, minimal body — the opposite of a bulky biped.
  {
    name: "IRON FIST", accent: TEAL,
    parts: [
      { id: "torso", dx: 0, dy: 0, half: 0.30, rad: 0.15, density: 1.2, color: BONE },
      { id: "lArm", dx: -0.50, dy: 0.0, half: 0.85, rad: 0.07, density: 0.8, color: GRAY, rot: 0.35 },
      { id: "rArm", dx: 0.50, dy: 0.0, half: 0.85, rad: 0.07, density: 0.8, color: GRAY, rot: -0.35 },
      { id: "lLeg", dx: -0.22, dy: -1.05, half: 0.85, rad: 0.08, density: 0.9, color: GRAY },
      { id: "rLeg", dx: 0.22, dy: -1.05, half: 0.85, rad: 0.08, density: 0.9, color: GRAY },
    ],
    joints: [
      { a: "torso", ax: -0.22, ay: 0.2, b: "lArm", bx: 0, by: 0.85 },
      { a: "torso", ax: 0.22, ay: 0.2, b: "rArm", bx: 0, by: 0.85 },
      { a: "torso", ax: -0.18, ay: -0.28, b: "lLeg", bx: 0, by: 0.85 },
      { a: "torso", ax: 0.18, ay: -0.28, b: "rLeg", bx: 0, by: 0.85 },
    ],
    binding: [fb(0, "lArm", 0, -0.85), fb(1, "lLeg", 0, -0.85), fb(2, "torso", 0, 0.3), fb(3, "rLeg", 0, -0.85), fb(4, "rArm", 0, -0.85)],
  },

  // 3. NIGHTSHADE — legless S-coiled serpent: a chain of capsules curling head-over-tail, each link
  // canted to the local tangent. No limbs; its FIVE strings space out ALONG the body (head..tail).
  {
    name: "NIGHTSHADE", accent: PLUM,
    parts: [
      { id: "core", dx: 0, dy: 0, half: 0.32, rad: 0.20, density: 1.4, color: PLUM, rot: -0.15 },
      { id: "neck", dx: -0.12, dy: 0.55, half: 0.30, rad: 0.15, density: 1.1, color: PLUM, rot: 0.45 },
      { id: "head", dx: 0.02, dy: 1.05, half: 0.24, rad: 0.19, density: 1.0, color: BONE, rot: 0.05 },
      { id: "body1", dx: 0.22, dy: -0.50, half: 0.30, rad: 0.16, density: 1.2, color: PLUM, rot: -0.55 },
      { id: "body2", dx: 0.10, dy: -1.05, half: 0.30, rad: 0.13, density: 1.0, color: PLUM, rot: 0.40 },
      { id: "tail", dx: -0.22, dy: -1.45, half: 0.28, rad: 0.09, density: 0.8, color: PLUM, rot: 0.90 },
    ],
    joints: [
      { a: "core", ax: 0, ay: 0.32, b: "neck", bx: 0, by: -0.30 },
      { a: "neck", ax: 0, ay: 0.30, b: "head", bx: 0, by: -0.24 },
      { a: "core", ax: 0, ay: -0.32, b: "body1", bx: 0, by: 0.30 },
      { a: "body1", ax: 0, ay: -0.30, b: "body2", bx: 0, by: 0.30 },
      { a: "body2", ax: 0, ay: -0.30, b: "tail", bx: 0, by: 0.28 },
    ],
    binding: [fb(0, "head", 0, 0.2), fb(1, "neck", 0, 0), fb(2, "core", 0, 0.2), fb(3, "body2", 0, 0), fb(4, "tail", 0, -0.1)],
  },

  // 4. FURNACE — huge titan: a massive dense torso that dwarfs the stage, a tiny head, and short thick
  // limbs. Reads as slow, heavy, and BIG next to the gremlin.
  {
    name: "FURNACE", accent: STEEL,
    parts: [
      { id: "torso", dx: 0, dy: 0, half: 0.85, rad: 0.62, density: 3.2, color: STEEL },
      { id: "head", dx: 0, dy: 1.20, half: 0.18, rad: 0.22, density: 1.0, color: BONE },
      { id: "lArm", dx: -0.92, dy: 0.35, half: 0.35, rad: 0.20, density: 2.6, color: SLATE, rot: 0.2 },
      { id: "rArm", dx: 0.92, dy: 0.35, half: 0.35, rad: 0.20, density: 2.6, color: SLATE, rot: -0.2 },
      { id: "lLeg", dx: -0.42, dy: -1.15, half: 0.40, rad: 0.26, density: 2.8, color: SLATE },
      { id: "rLeg", dx: 0.42, dy: -1.15, half: 0.40, rad: 0.26, density: 2.8, color: SLATE },
    ],
    joints: [
      { a: "torso", ax: 0, ay: 0.8, b: "head", bx: 0, by: -0.18 },
      { a: "torso", ax: -0.6, ay: 0.4, b: "lArm", bx: 0, by: 0.35 },
      { a: "torso", ax: 0.6, ay: 0.4, b: "rArm", bx: 0, by: 0.35 },
      { a: "torso", ax: -0.4, ay: -0.75, b: "lLeg", bx: 0, by: 0.40 },
      { a: "torso", ax: 0.4, ay: -0.75, b: "rLeg", bx: 0, by: 0.40 },
    ],
    binding: [fb(0, "lArm", 0, -0.35), fb(1, "lLeg", 0, -0.40), fb(2, "torso", 0, 0.7), fb(3, "rLeg", 0, -0.40), fb(4, "rArm", 0, -0.35)],
  },

  // 5. INVERSA — inverted acrobat: the HEAVY kicking legs are held UP overhead, thin light arms plant
  // DOWN toward the floor. Upside-down mass distribution — reads unmistakably wrong-way-up.
  {
    name: "INVERSA", accent: SAND,
    parts: [
      { id: "hips", dx: 0, dy: 0, half: 0.40, rad: 0.24, density: 1.2, color: BONE },
      { id: "legUpL", dx: -0.30, dy: 0.72, half: 0.60, rad: 0.22, density: 2.4, color: SAND, rot: -0.25 },
      { id: "legUpR", dx: 0.30, dy: 0.72, half: 0.60, rad: 0.22, density: 2.4, color: SAND, rot: 0.25 },
      { id: "armDnL", dx: -0.32, dy: -0.72, half: 0.50, rad: 0.09, density: 0.7, color: GRAY, rot: 0.2 },
      { id: "armDnR", dx: 0.32, dy: -0.72, half: 0.50, rad: 0.09, density: 0.7, color: GRAY, rot: -0.2 },
    ],
    joints: [
      { a: "hips", ax: -0.25, ay: 0.35, b: "legUpL", bx: 0, by: -0.60 },
      { a: "hips", ax: 0.25, ay: 0.35, b: "legUpR", bx: 0, by: -0.60 },
      { a: "hips", ax: -0.25, ay: -0.35, b: "armDnL", bx: 0, by: 0.50 },
      { a: "hips", ax: 0.25, ay: -0.35, b: "armDnR", bx: 0, by: 0.50 },
    ],
    binding: [fb(0, "armDnL", 0, -0.50), fb(1, "legUpL", 0, 0.60), fb(2, "hips", 0, 0.4), fb(3, "legUpR", 0, 0.60), fb(4, "armDnR", 0, -0.50)],
  },

  // 6. THE MOUNTAIN — wide low tank: a broad HORIZONTAL slab of a body riding on four stubby legs, a
  // small head poking off the front. Centre of mass near the floor; the widest silhouette.
  {
    name: "THE MOUNTAIN", accent: OLIVE,
    parts: [
      { id: "belly", dx: 0, dy: 0, half: 1.10, rad: 0.50, density: 2.2, color: BONE, rot: HALF_PI },
      { id: "head", dx: -1.30, dy: 0.10, half: 0.18, rad: 0.22, density: 1.2, color: OLIVE },
      { id: "leg1", dx: -0.70, dy: -0.58, half: 0.30, rad: 0.16, density: 2.4, color: OLIVE },
      { id: "leg2", dx: -0.25, dy: -0.62, half: 0.32, rad: 0.16, density: 2.4, color: OLIVE },
      { id: "leg3", dx: 0.25, dy: -0.62, half: 0.32, rad: 0.16, density: 2.4, color: OLIVE },
      { id: "leg4", dx: 0.70, dy: -0.58, half: 0.30, rad: 0.16, density: 2.4, color: OLIVE },
    ],
    joints: [
      { a: "belly", ax: 0.15, ay: 1.05, b: "head", bx: 0, by: 0.18 },
      { a: "belly", ax: -0.35, ay: 0.70, b: "leg1", bx: 0, by: 0.30 },
      { a: "belly", ax: -0.40, ay: 0.25, b: "leg2", bx: 0, by: 0.32 },
      { a: "belly", ax: -0.40, ay: -0.25, b: "leg3", bx: 0, by: 0.32 },
      { a: "belly", ax: -0.35, ay: -0.70, b: "leg4", bx: 0, by: 0.30 },
    ],
    binding: [fb(0, "leg1", 0, -0.30), fb(1, "leg2", 0, -0.32), fb(2, "belly", 0.5, 0), fb(3, "leg3", 0, -0.32), fb(4, "leg4", 0, -0.30)],
  },

  // 7. THE WIDOW — legless drifting orb: a big round low-density body (it floats, not falls) ringed by
  // a fan of light veil-spokes and a hem. NO legs — its five strings fan out around the rim.
  {
    name: "THE WIDOW", accent: PLUM,
    parts: [
      { id: "orb", dx: 0, dy: 0, half: 0.15, rad: 0.62, density: 0.8, color: BONE },
      { id: "spokeTL", dx: -0.50, dy: 0.45, half: 0.30, rad: 0.08, density: 0.5, color: PLUM, rot: 0.9 },
      { id: "spokeTR", dx: 0.50, dy: 0.45, half: 0.30, rad: 0.08, density: 0.5, color: PLUM, rot: -0.9 },
      { id: "spokeBL", dx: -0.55, dy: -0.35, half: 0.35, rad: 0.08, density: 0.5, color: PLUM, rot: 0.4 },
      { id: "spokeBR", dx: 0.55, dy: -0.35, half: 0.35, rad: 0.08, density: 0.5, color: PLUM, rot: -0.4 },
      { id: "hem", dx: 0, dy: -0.72, half: 0.42, rad: 0.10, density: 0.4, color: PLUM },
    ],
    joints: [
      { a: "orb", ax: -0.35, ay: 0.32, b: "spokeTL", bx: 0, by: 0.30 },
      { a: "orb", ax: 0.35, ay: 0.32, b: "spokeTR", bx: 0, by: 0.30 },
      { a: "orb", ax: -0.38, ay: -0.20, b: "spokeBL", bx: 0, by: 0.35 },
      { a: "orb", ax: 0.38, ay: -0.20, b: "spokeBR", bx: 0, by: 0.35 },
      { a: "orb", ax: 0, ay: -0.15, b: "hem", bx: 0, by: 0.42 },
    ],
    binding: [fb(0, "spokeTL", 0, -0.30), fb(1, "spokeBL", 0, -0.35), fb(2, "orb", 0, 0.15), fb(3, "spokeBR", 0, -0.35), fb(4, "spokeTR", 0, -0.30)],
  },

  // 8. THE JOEY — tiny fast gremlin: the whole rig is scaled small with stubby limbs, so it reads as
  // light and quick — the size foil to the FURNACE titan.
  {
    name: "THE JOEY", accent: SAND,
    parts: [
      { id: "torso", dx: 0, dy: 0, half: 0.28, rad: 0.22, density: 1.0, color: SAND },
      { id: "head", dx: 0.05, dy: 0.50, half: 0.14, rad: 0.16, density: 0.9, color: BONE },
      { id: "armL", dx: -0.32, dy: 0.12, half: 0.22, rad: 0.10, density: 0.8, color: SAND, rot: 0.5 },
      { id: "armR", dx: 0.32, dy: 0.12, half: 0.22, rad: 0.10, density: 0.8, color: SAND, rot: -0.5 },
      { id: "legL", dx: -0.18, dy: -0.50, half: 0.28, rad: 0.12, density: 1.1, color: SAND, rot: 0.15 },
      { id: "legR", dx: 0.18, dy: -0.50, half: 0.28, rad: 0.12, density: 1.1, color: SAND, rot: -0.15 },
    ],
    joints: [
      { a: "torso", ax: 0, ay: 0.28, b: "head", bx: 0, by: -0.14 },
      { a: "torso", ax: -0.20, ay: 0.15, b: "armL", bx: 0, by: 0.22 },
      { a: "torso", ax: 0.20, ay: 0.15, b: "armR", bx: 0, by: 0.22 },
      { a: "torso", ax: -0.14, ay: -0.28, b: "legL", bx: 0, by: 0.28 },
      { a: "torso", ax: 0.14, ay: -0.28, b: "legR", bx: 0, by: 0.28 },
    ],
    binding: [fb(0, "armL", 0, -0.22), fb(1, "legL", 0, -0.28), fb(2, "torso", 0, 0.28), fb(3, "legR", 0, -0.28), fb(4, "armR", 0, -0.22)],
  },

  // 9. THE URSINE — horizontal quadruped beast: the body lies FLAT (rot = π/2), a big head out front on
  // the left, four short legs hanging down. No upright torso — a low, wide, on-all-fours silhouette.
  {
    name: "THE URSINE", accent: MOSS,
    parts: [
      { id: "body", dx: 0, dy: 0, half: 0.85, rad: 0.40, density: 2.4, color: MOSS, rot: HALF_PI },
      { id: "head", dx: -1.12, dy: 0.15, half: 0.28, rad: 0.30, density: 1.4, color: BONE },
      { id: "legFL", dx: -0.55, dy: -0.60, half: 0.38, rad: 0.15, density: 2.0, color: MOSS },
      { id: "legFR", dx: -0.20, dy: -0.62, half: 0.38, rad: 0.15, density: 2.0, color: MOSS },
      { id: "legHL", dx: 0.35, dy: -0.62, half: 0.38, rad: 0.15, density: 2.0, color: MOSS },
      { id: "legHR", dx: 0.70, dy: -0.60, half: 0.38, rad: 0.15, density: 2.0, color: MOSS },
    ],
    joints: [
      { a: "body", ax: 0.15, ay: 0.80, b: "head", bx: 0, by: 0.28 },
      { a: "body", ax: -0.40, ay: 0.55, b: "legFL", bx: 0, by: 0.38 },
      { a: "body", ax: -0.42, ay: 0.20, b: "legFR", bx: 0, by: 0.38 },
      { a: "body", ax: -0.42, ay: -0.35, b: "legHL", bx: 0, by: 0.38 },
      { a: "body", ax: -0.40, ay: -0.70, b: "legHR", bx: 0, by: 0.38 },
    ],
    binding: [fb(0, "head", 0, 0), fb(1, "legFL", 0, -0.38), fb(2, "body", 0, 0), fb(3, "legHL", 0, -0.38), fb(4, "legHR", 0, -0.38)],
  },

  // 10. THE REAPER — many-legged insect: a small central thorax with a little head and SIX long spindly
  // legs radiating out and down (three per side). Reads as a spider/mantis, not a biped.
  {
    name: "THE REAPER", accent: MOSS,
    parts: [
      { id: "thorax", dx: 0, dy: 0, half: 0.35, rad: 0.18, density: 1.1, color: MOSS },
      { id: "head", dx: 0, dy: 0.50, half: 0.16, rad: 0.13, density: 0.9, color: BONE },
      { id: "legL1", dx: -0.35, dy: -0.10, half: 0.60, rad: 0.05, density: 0.7, color: MOSS, rot: 0.9 },
      { id: "legL2", dx: -0.30, dy: -0.30, half: 0.65, rad: 0.05, density: 0.7, color: MOSS, rot: 0.5 },
      { id: "legL3", dx: -0.20, dy: -0.50, half: 0.60, rad: 0.05, density: 0.7, color: MOSS, rot: 0.2 },
      { id: "legR1", dx: 0.35, dy: -0.10, half: 0.60, rad: 0.05, density: 0.7, color: MOSS, rot: -0.9 },
      { id: "legR2", dx: 0.30, dy: -0.30, half: 0.65, rad: 0.05, density: 0.7, color: MOSS, rot: -0.5 },
      { id: "legR3", dx: 0.20, dy: -0.50, half: 0.60, rad: 0.05, density: 0.7, color: MOSS, rot: -0.2 },
    ],
    joints: [
      { a: "thorax", ax: 0, ay: 0.35, b: "head", bx: 0, by: -0.16 },
      { a: "thorax", ax: -0.14, ay: 0.05, b: "legL1", bx: 0, by: 0.60 },
      { a: "thorax", ax: -0.14, ay: -0.10, b: "legL2", bx: 0, by: 0.65 },
      { a: "thorax", ax: -0.12, ay: -0.20, b: "legL3", bx: 0, by: 0.60 },
      { a: "thorax", ax: 0.14, ay: 0.05, b: "legR1", bx: 0, by: 0.60 },
      { a: "thorax", ax: 0.14, ay: -0.10, b: "legR2", bx: 0, by: 0.65 },
      { a: "thorax", ax: 0.12, ay: -0.20, b: "legR3", bx: 0, by: 0.60 },
    ],
    binding: [fb(0, "legL1", 0, -0.60), fb(1, "legL3", 0, -0.60), fb(2, "thorax", 0, 0.35), fb(3, "legR3", 0, -0.60), fb(4, "legR1", 0, -0.60)],
  },
];
