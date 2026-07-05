// The weapon catalog — disjoint blades bolted onto a puppet's limbs (see puppet.ts armPuppet). Each
// loadout is a deliberately different SPACING game, same control scheme, so we can arm the fighters and
// feel out what works (the point of this pass). Two knobs carry the design:
//   • REACH  — the blade extends past the limb tip, so cutting reach > your own string exposure. That's
//              the "safe offense" the game lacked: threaten their strings while your body stays back.
//   • DENSITY (mass) — the COMMITMENT. A heavy blade can't be instantly recalled; a whiffed swing hangs
//              the arm out for a punish. Light blades are twitchy/safe, heavy blades are all-or-nothing.
// Single-blade loadouts arm the RIGHT arm (the "sword arm") and leave the left hand free (a stance —
// room for a future grab/shove). Dual loadouts arm both arms (more aggressive, more on-theme).
import type { WeaponDef } from "./puppet.ts";

const STEEL = "#c9ccd2"; // blades read as bright steel so the team colour stays on the strings

// Blade on the humanoid's arms. (target "lArm"/"rArm" are the humanoid arm ids; rigs would use theirs.)
const blade = (target: "lArm" | "rArm", reach: number, thickness: number, density: number): WeaponDef =>
  ({ name: "blade", target, reach, thickness, density, color: STEEL });

export interface Loadout { name: string; note: string; weapons: WeaponDef[]; }

// The starting roster of archetypes — cycle through these in /game to compare (see game.ts).
export const LOADOUTS: Loadout[] = [
  {
    name: "SHEARS", note: "dual medium blades — balanced, on-theme (a marionette cutting strings)",
    weapons: [blade("lArm", 1.4, 0.10, 5), blade("rArm", 1.4, 0.10, 5)],
  },
  {
    name: "RAPIER", note: "one long light blade — a zoner: wins at range, folds up close",
    weapons: [blade("rArm", 2.4, 0.07, 3)],
  },
  {
    name: "CLAWS", note: "dual short fast blades — rushdown: must fight inside (high personal risk)",
    weapons: [blade("lArm", 0.8, 0.12, 4), blade("rArm", 0.8, 0.12, 4)],
  },
  {
    name: "CLEAVER", note: "one huge heavy blade — grappler: brutal recovery, whiff = death",
    weapons: [blade("rArm", 2.0, 0.22, 9)],
  },
  {
    name: "WHIP", note: "one very long thin blade — longest reach, hard to aim (chaos)",
    weapons: [blade("rArm", 3.0, 0.06, 2)],
  },
];

export const DEFAULT_LOADOUT = 0; // SHEARS
