// The character roster — ten bespoke marionette rigs as plain data (see design/puppet-roster.md).
// Every rig is driven by the SAME five finger-strings (slots 0..4 = thumb,index,middle,ring,pinky),
// with the MIDDLE finger (slot 2) carrying the keystone/root string on most of them. Parts are
// capsules positioned RELATIVE to the root part (parts[0]) at (0,0); +y is up, +x is screen-right.
// buildRig() in puppet.ts turns one of these into a live Puppet.
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

export const RIGS: RigDef[] = [
  // 1. JACKHAMMER — pro-wrestling grappler: barrel torso + wrecking-ball fists, stubby legs.
  {
    name: "JACKHAMMER", accent: RUST,
    parts: [
      { id: "torso", dx: 0, dy: 0, half: 0.55, rad: 0.40, density: 2.2, color: BONE },
      { id: "lArm", dx: -0.75, dy: 0.15, half: 0.35, rad: 0.24, density: 2.4, color: RUST },
      { id: "rArm", dx: 0.75, dy: 0.15, half: 0.35, rad: 0.24, density: 2.4, color: RUST },
      { id: "lLeg", dx: -0.30, dy: -0.95, half: 0.35, rad: 0.20, density: 1.6, color: GRAY },
      { id: "rLeg", dx: 0.30, dy: -0.95, half: 0.35, rad: 0.20, density: 1.6, color: GRAY },
    ],
    joints: [
      { a: "torso", ax: -0.45, ay: 0.35, b: "lArm", bx: 0, by: 0.35 },
      { a: "torso", ax: 0.45, ay: 0.35, b: "rArm", bx: 0, by: 0.35 },
      { a: "torso", ax: -0.25, ay: -0.5, b: "lLeg", bx: 0, by: 0.35 },
      { a: "torso", ax: 0.25, ay: -0.5, b: "rLeg", bx: 0, by: 0.35 },
    ],
    binding: [fb(0, "lArm", 0, -0.35), fb(1, "lLeg", 0, -0.35), fb(2, "torso", 0, 0.5), fb(3, "rLeg", 0, -0.35), fb(4, "rArm", 0, -0.35)],
  },

  // 2. IRON FIST — karate zoner: lean, longest limbs (this IS the classic humanoid, stretched).
  {
    name: "IRON FIST", accent: TEAL,
    parts: [
      { id: "torso", dx: 0, dy: 0, half: 0.6, rad: 0.22, density: 1.4, color: BONE },
      { id: "lArm", dx: -0.35, dy: 0.1, half: 0.55, rad: 0.10, density: 1.0, color: GRAY },
      { id: "rArm", dx: 0.35, dy: 0.1, half: 0.55, rad: 0.10, density: 1.0, color: GRAY },
      { id: "lLeg", dx: -0.18, dy: -1.05, half: 0.6, rad: 0.12, density: 1.1, color: GRAY },
      { id: "rLeg", dx: 0.18, dy: -1.05, half: 0.6, rad: 0.12, density: 1.1, color: GRAY },
    ],
    joints: [
      { a: "torso", ax: -0.3, ay: 0.35, b: "lArm", bx: 0, by: 0.5 },
      { a: "torso", ax: 0.3, ay: 0.35, b: "rArm", bx: 0, by: 0.5 },
      { a: "torso", ax: -0.18, ay: -0.55, b: "lLeg", bx: 0, by: 0.55 },
      { a: "torso", ax: 0.18, ay: -0.55, b: "rLeg", bx: 0, by: 0.55 },
    ],
    binding: [fb(0, "lArm", 0, -0.5), fb(1, "lLeg", 0, -0.55), fb(2, "torso", 0, 0.55), fb(3, "rLeg", 0, -0.55), fb(4, "rArm", 0, -0.5)],
  },

  // 3. NIGHTSHADE — ninja technical: one arm + a long trailing WHIP SCARF (4-link chain) on the left.
  {
    name: "NIGHTSHADE", accent: PLUM,
    parts: [
      { id: "torso", dx: 0, dy: 0, half: 0.5, rad: 0.16, density: 1.2, color: BONE },
      { id: "arm", dx: 0.33, dy: 0.1, half: 0.5, rad: 0.10, density: 1.0, color: GRAY },
      { id: "scarf0", dx: -0.30, dy: 0.05, half: 0.22, rad: 0.07, density: 0.5, color: PLUM },
      { id: "scarf1", dx: -0.55, dy: -0.25, half: 0.22, rad: 0.06, density: 0.5, color: PLUM },
      { id: "scarf2", dx: -0.80, dy: -0.60, half: 0.22, rad: 0.06, density: 0.5, color: PLUM },
      { id: "scarf3", dx: -1.05, dy: -0.95, half: 0.22, rad: 0.05, density: 0.4, color: PLUM },
      { id: "lLeg", dx: -0.15, dy: -1.0, half: 0.55, rad: 0.11, density: 1.1, color: GRAY },
      { id: "rLeg", dx: 0.15, dy: -1.0, half: 0.55, rad: 0.11, density: 1.1, color: GRAY },
    ],
    joints: [
      { a: "torso", ax: 0.28, ay: 0.3, b: "arm", bx: 0, by: 0.5 },
      { a: "torso", ax: -0.22, ay: 0.25, b: "scarf0", bx: 0, by: 0.22 },
      { a: "scarf0", ax: 0, ay: -0.22, b: "scarf1", bx: 0, by: 0.22 },
      { a: "scarf1", ax: 0, ay: -0.22, b: "scarf2", bx: 0, by: 0.22 },
      { a: "scarf2", ax: 0, ay: -0.22, b: "scarf3", bx: 0, by: 0.22 },
      { a: "torso", ax: -0.15, ay: -0.5, b: "lLeg", bx: 0, by: 0.55 },
      { a: "torso", ax: 0.15, ay: -0.5, b: "rLeg", bx: 0, by: 0.55 },
    ],
    binding: [fb(0, "scarf3", 0, -0.2), fb(1, "lLeg", 0, -0.55), fb(2, "torso", 0, 0.5), fb(3, "rLeg", 0, -0.55), fb(4, "arm", 0, -0.5)],
  },

  // 4. FURNACE — mech tank: heavy plate torso, telescoping TWO-SEGMENT arms, blocky legs.
  {
    name: "FURNACE", accent: STEEL,
    parts: [
      { id: "torso", dx: 0, dy: 0, half: 0.6, rad: 0.42, density: 3.0, color: STEEL },
      { id: "lUpper", dx: -0.6, dy: 0.25, half: 0.3, rad: 0.16, density: 2.5, color: SLATE },
      { id: "lFore", dx: -0.95, dy: -0.15, half: 0.32, rad: 0.14, density: 2.5, color: SLATE },
      { id: "rUpper", dx: 0.6, dy: 0.25, half: 0.3, rad: 0.16, density: 2.5, color: SLATE },
      { id: "rFore", dx: 0.95, dy: -0.15, half: 0.32, rad: 0.14, density: 2.5, color: SLATE },
      { id: "lLeg", dx: -0.3, dy: -1.0, half: 0.45, rad: 0.2, density: 2.2, color: SLATE },
      { id: "rLeg", dx: 0.3, dy: -1.0, half: 0.45, rad: 0.2, density: 2.2, color: SLATE },
    ],
    joints: [
      { a: "torso", ax: -0.5, ay: 0.4, b: "lUpper", bx: 0, by: 0.3 },
      { a: "lUpper", ax: 0, ay: -0.3, b: "lFore", bx: 0, by: 0.32 },
      { a: "torso", ax: 0.5, ay: 0.4, b: "rUpper", bx: 0, by: 0.3 },
      { a: "rUpper", ax: 0, ay: -0.3, b: "rFore", bx: 0, by: 0.32 },
      { a: "torso", ax: -0.28, ay: -0.55, b: "lLeg", bx: 0, by: 0.45 },
      { a: "torso", ax: 0.28, ay: -0.55, b: "rLeg", bx: 0, by: 0.45 },
    ],
    binding: [fb(0, "lFore", 0, -0.32), fb(1, "lLeg", 0, -0.45), fb(2, "torso", 0, 0.5), fb(3, "rLeg", 0, -0.45), fb(4, "rFore", 0, -0.32)],
  },

  // 5. INVERSA — capoeira technical: light arms, HEAVY kicking legs (the weapons are the feet).
  {
    name: "INVERSA", accent: SAND,
    parts: [
      { id: "torso", dx: 0, dy: 0, half: 0.45, rad: 0.22, density: 1.2, color: BONE },
      { id: "lArm", dx: -0.35, dy: 0.15, half: 0.45, rad: 0.09, density: 0.7, color: GRAY },
      { id: "rArm", dx: 0.35, dy: 0.15, half: 0.45, rad: 0.09, density: 0.7, color: GRAY },
      { id: "lLeg", dx: -0.25, dy: -0.9, half: 0.6, rad: 0.2, density: 2.4, color: SAND },
      { id: "rLeg", dx: 0.25, dy: -0.9, half: 0.6, rad: 0.2, density: 2.4, color: SAND },
    ],
    joints: [
      { a: "torso", ax: -0.3, ay: 0.3, b: "lArm", bx: 0, by: 0.45 },
      { a: "torso", ax: 0.3, ay: 0.3, b: "rArm", bx: 0, by: 0.45 },
      { a: "torso", ax: -0.22, ay: -0.45, b: "lLeg", bx: 0, by: 0.55 },
      { a: "torso", ax: 0.22, ay: -0.45, b: "rLeg", bx: 0, by: 0.55 },
    ],
    binding: [fb(0, "lArm", 0, -0.45), fb(1, "lLeg", 0, -0.55), fb(2, "torso", 0, 0.45), fb(3, "rLeg", 0, -0.55), fb(4, "rArm", 0, -0.45)],
  },

  // 6. THE MOUNTAIN — sumo tank: enormous low belly, tiny thick limbs, center of mass near the floor.
  {
    name: "THE MOUNTAIN", accent: OLIVE,
    parts: [
      { id: "torso", dx: 0, dy: 0, half: 0.5, rad: 0.72, density: 2.0, color: BONE },
      { id: "lArm", dx: -0.9, dy: 0.1, half: 0.3, rad: 0.2, density: 1.6, color: OLIVE },
      { id: "rArm", dx: 0.9, dy: 0.1, half: 0.3, rad: 0.2, density: 1.6, color: OLIVE },
      { id: "lLeg", dx: -0.42, dy: -0.8, half: 0.28, rad: 0.26, density: 2.6, color: OLIVE },
      { id: "rLeg", dx: 0.42, dy: -0.8, half: 0.28, rad: 0.26, density: 2.6, color: OLIVE },
    ],
    joints: [
      { a: "torso", ax: -0.65, ay: 0.2, b: "lArm", bx: 0, by: 0.3 },
      { a: "torso", ax: 0.65, ay: 0.2, b: "rArm", bx: 0, by: 0.3 },
      { a: "torso", ax: -0.4, ay: -0.6, b: "lLeg", bx: 0, by: 0.28 },
      { a: "torso", ax: 0.4, ay: -0.6, b: "rLeg", bx: 0, by: 0.28 },
    ],
    binding: [fb(0, "lArm", 0, -0.3), fb(1, "lLeg", 0, -0.28), fb(2, "torso", 0, 0.7), fb(3, "rLeg", 0, -0.28), fb(4, "rArm", 0, -0.3)],
  },

  // 7. THE WIDOW — mystic zoner: light floaty body, a fanned ROBE SKIRT (hem strands) instead of legs.
  {
    name: "THE WIDOW", accent: PLUM,
    parts: [
      { id: "torso", dx: 0, dy: 0, half: 0.5, rad: 0.18, density: 0.9, color: BONE },
      { id: "lArm", dx: -0.4, dy: 0.1, half: 0.5, rad: 0.08, density: 0.6, color: PLUM },
      { id: "rArm", dx: 0.4, dy: 0.1, half: 0.5, rad: 0.08, density: 0.6, color: PLUM },
      { id: "hemL", dx: -0.35, dy: -0.85, half: 0.55, rad: 0.1, density: 0.5, color: PLUM },
      { id: "hemR", dx: 0.35, dy: -0.85, half: 0.55, rad: 0.1, density: 0.5, color: PLUM },
    ],
    joints: [
      { a: "torso", ax: -0.32, ay: 0.3, b: "lArm", bx: 0, by: 0.5 },
      { a: "torso", ax: 0.32, ay: 0.3, b: "rArm", bx: 0, by: 0.5 },
      { a: "torso", ax: -0.25, ay: -0.45, b: "hemL", bx: 0, by: 0.5 },
      { a: "torso", ax: 0.25, ay: -0.45, b: "hemR", bx: 0, by: 0.5 },
    ],
    binding: [fb(0, "lArm", 0, -0.5), fb(1, "hemL", 0, -0.5), fb(2, "torso", 0, 0.5), fb(3, "hemR", 0, -0.5), fb(4, "rArm", 0, -0.5)],
  },

  // 8. THE JOEY — boxing kangaroo (animal): big hind legs + a heavy TAIL tripod, tiny glove arms.
  {
    name: "THE JOEY", accent: SAND,
    parts: [
      { id: "torso", dx: 0, dy: 0, half: 0.5, rad: 0.3, density: 1.4, color: SAND },
      { id: "hindL", dx: -0.3, dy: -0.85, half: 0.6, rad: 0.24, density: 2.2, color: SAND },
      { id: "hindR", dx: 0.3, dy: -0.85, half: 0.6, rad: 0.24, density: 2.2, color: SAND },
      { id: "tail0", dx: 0, dy: -0.7, half: 0.3, rad: 0.15, density: 1.6, color: SAND },
      { id: "tail1", dx: 0, dy: -1.3, half: 0.32, rad: 0.13, density: 1.6, color: SAND },
      { id: "gloveL", dx: -0.28, dy: 0.35, half: 0.18, rad: 0.15, density: 1.0, color: RUST },
      { id: "gloveR", dx: 0.28, dy: 0.35, half: 0.18, rad: 0.15, density: 1.0, color: RUST },
    ],
    joints: [
      { a: "torso", ax: -0.28, ay: -0.45, b: "hindL", bx: 0, by: 0.55 },
      { a: "torso", ax: 0.28, ay: -0.45, b: "hindR", bx: 0, by: 0.55 },
      { a: "torso", ax: 0, ay: -0.45, b: "tail0", bx: 0, by: 0.3 },
      { a: "tail0", ax: 0, ay: -0.3, b: "tail1", bx: 0, by: 0.32 },
      { a: "torso", ax: -0.25, ay: 0.4, b: "gloveL", bx: 0, by: 0.18 },
      { a: "torso", ax: 0.25, ay: 0.4, b: "gloveR", bx: 0, by: 0.18 },
    ],
    binding: [fb(0, "tail1", 0, -0.32), fb(1, "hindL", 0, -0.55), fb(2, "torso", 0, 0.5), fb(3, "hindR", 0, -0.55), fb(4, "gloveR", 0, -0.18)],
  },

  // 9. THE URSINE — bear (animal): big round body + head, four stubby paws. Keystone = the HEAD.
  {
    name: "THE URSINE", accent: MOSS,
    parts: [
      { id: "torso", dx: 0, dy: 0, half: 0.55, rad: 0.45, density: 2.4, color: MOSS },
      { id: "head", dx: 0, dy: 0.9, half: 0.28, rad: 0.32, density: 1.4, color: BONE },
      { id: "frontL", dx: -0.5, dy: 0.05, half: 0.3, rad: 0.16, density: 1.6, color: MOSS },
      { id: "frontR", dx: 0.5, dy: 0.05, half: 0.3, rad: 0.16, density: 1.6, color: MOSS },
      { id: "hindL", dx: -0.35, dy: -0.9, half: 0.35, rad: 0.2, density: 2.0, color: MOSS },
      { id: "hindR", dx: 0.35, dy: -0.9, half: 0.35, rad: 0.2, density: 2.0, color: MOSS },
    ],
    joints: [
      { a: "torso", ax: 0, ay: 0.5, b: "head", bx: 0, by: -0.28 },
      { a: "torso", ax: -0.4, ay: 0.35, b: "frontL", bx: 0, by: 0.3 },
      { a: "torso", ax: 0.4, ay: 0.35, b: "frontR", bx: 0, by: 0.3 },
      { a: "torso", ax: -0.35, ay: -0.5, b: "hindL", bx: 0, by: 0.35 },
      { a: "torso", ax: 0.35, ay: -0.5, b: "hindR", bx: 0, by: 0.35 },
    ],
    binding: [fb(0, "frontL", 0, -0.3), fb(1, "hindL", 0, -0.35), fb(2, "head", 0, 0.28), fb(3, "hindR", 0, -0.35), fb(4, "frontR", 0, -0.3)],
  },

  // 10. THE REAPER — praying mantis (animal): tall thorax, two bent SCYTHE arms (bladed cutters), head.
  {
    name: "THE REAPER", accent: MOSS,
    parts: [
      { id: "thorax", dx: 0, dy: 0, half: 0.6, rad: 0.16, density: 1.1, color: MOSS },
      { id: "head", dx: 0, dy: 0.78, half: 0.2, rad: 0.15, density: 0.8, color: BONE },
      { id: "lUpper", dx: -0.4, dy: 0.35, half: 0.3, rad: 0.08, density: 0.9, color: MOSS },
      { id: "lBlade", dx: -0.72, dy: 0.55, half: 0.32, rad: 0.07, density: 0.9, color: SAND },
      { id: "rUpper", dx: 0.4, dy: 0.35, half: 0.3, rad: 0.08, density: 0.9, color: MOSS },
      { id: "rBlade", dx: 0.72, dy: 0.55, half: 0.32, rad: 0.07, density: 0.9, color: SAND },
      { id: "lLeg", dx: -0.25, dy: -0.9, half: 0.55, rad: 0.07, density: 0.9, color: MOSS },
      { id: "rLeg", dx: 0.25, dy: -0.9, half: 0.55, rad: 0.07, density: 0.9, color: MOSS },
    ],
    joints: [
      { a: "thorax", ax: 0, ay: 0.55, b: "head", bx: 0, by: -0.2 },
      { a: "thorax", ax: -0.15, ay: 0.45, b: "lUpper", bx: 0, by: 0.3 },
      { a: "lUpper", ax: 0, ay: -0.3, b: "lBlade", bx: 0, by: 0.32 },
      { a: "thorax", ax: 0.15, ay: 0.45, b: "rUpper", bx: 0, by: 0.3 },
      { a: "rUpper", ax: 0, ay: -0.3, b: "rBlade", bx: 0, by: 0.32 },
      { a: "thorax", ax: -0.12, ay: -0.5, b: "lLeg", bx: 0, by: 0.55 },
      { a: "thorax", ax: 0.12, ay: -0.5, b: "rLeg", bx: 0, by: 0.55 },
    ],
    binding: [fb(0, "lBlade", 0, -0.32), fb(1, "lLeg", 0, -0.55), fb(2, "thorax", 0, 0.6), fb(3, "rLeg", 0, -0.55), fb(4, "rBlade", 0, -0.32)],
  },
];
