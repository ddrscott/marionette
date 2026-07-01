// Game rules for /game, layered on the shared engine via stage.onFrame. Two ways a marionette goes
// down:
//   1. Swipe — swing YOUR puppet's limb (a hand or foot) through the OTHER puppet's strings to cut
//      them. A hit SEVERS that string at the swiped hinge (both halves dangle — it doesn't vanish),
//      freeing the part it held. Cutting the head/torso string (or the last intact string) drops the
//      whole puppet. The limb must actually be MOVING (a swing, not resting contact).
//   2. Ground-out — if a running puppet's torso comes to rest on the floor, it loses.
import type { Stage } from "./engine.ts";
import { cutStringAtSeg, cutAllIntact, FLOOR_TOP, type Capsule, type Puppet } from "./puppet.ts";

const CUT_RADIUS = 0.6;       // world units: a limb tip within this of a string segment cuts that string
const CUT_SPEED = 2.5;        // min limb-tip speed (units/s) for a hit to count as a swipe
const CUT_COOLDOWN_MS = 350;  // per attacker, between cuts (no rapid-fire multi-cut)
const GROUND_MARGIN = 0.12;   // torso bottom within this of the floor = grounded

export interface RulesState {
  lastCutAt: [number, number]; // per attacker slot
  dead: [boolean, boolean];    // per puppet: dropped / lost
}
export const makeRulesState = (): RulesState => ({ lastCutAt: [-1e9, -1e9], dead: [false, false] });

// World-space tip of a limb capsule (the free end — the hand/foot — opposite the torso joint).
function tipOf(part: Capsule): { x: number; y: number } {
  const p = part.body.translation();
  const q = part.body.rotation();
  const th = 2 * Math.atan2(q.z, q.w); // z-only rotation
  return { x: p.x + part.half * Math.sin(th), y: p.y - part.half * Math.cos(th) };
}
function speedOf(part: Capsule): number { const v = part.body.linvel(); return Math.hypot(v.x, v.y); }
const intactCount = (p: Puppet): number => p.strings.reduce((n, s) => n + (s.cutJoint === null ? 1 : 0), 0);

function torsoGrounded(puppet: Puppet): boolean {
  const torso = puppet.parts.find((c) => c.body === puppet.torso);
  if (!torso) return false;
  return torso.body.translation().y - torso.half <= FLOOR_TOP + GROUND_MARGIN;
}

function kill(stage: Stage, slot: 0 | 1, cs: RulesState): void {
  cutAllIntact(stage.world, stage.puppets[slot]); // sever any remaining strings -> full dangling collapse
  cs.dead[slot] = true;
}

// Advance the game rules one frame. Mutates the world (cutting strings) and `cs`.
export function updateRules(stage: Stage, cs: RulesState, now: number): void {
  for (let a = 0 as 0 | 1; a <= 1; a = (a + 1) as 0 | 1) {
    const v = (1 - a) as 0 | 1;
    if (cs.dead[v]) continue;

    const vic = stage.puppets[v];

    // (2) ground-out: a running puppet resting its torso on the floor loses.
    if (stage.slotStates[v].phase === "running" && torsoGrounded(vic)) { kill(stage, v, cs); continue; }

    // (1) swipe: attacker alive + running, victim still has an intact string, off cooldown.
    if (cs.dead[a] || stage.slotStates[a].phase !== "running" || intactCount(vic) === 0) continue;
    if (now - cs.lastCutAt[a] < CUT_COOLDOWN_MS) continue;

    const atk = stage.puppets[a];
    const limbs = atk.parts.filter((c) => c.body !== atk.torso); // arms + legs are the weapons
    let done = false;
    for (const limb of limbs) {
      if (speedOf(limb) < CUT_SPEED) continue; // must be swinging
      const tip = tipOf(limb);
      for (const s of vic.strings) {
        if (s.cutJoint !== null) continue; // already severed
        let hitSeg = -1;
        for (let k = 0; k < s.segs.length; k++) {
          const c = s.segs[k].translation();
          if (Math.hypot(tip.x - c.x, tip.y - c.y) < CUT_RADIUS) { hitSeg = k; break; }
        }
        if (hitSeg < 0) continue;
        const target = cutStringAtSeg(stage.world, vic, s.slot, hitSeg);
        cs.lastCutAt[a] = now;
        if (target === "torso" || intactCount(vic) === 0) kill(stage, v, cs); // head cut / last string = drop
        done = true;
        break;
      }
      if (done) break;
    }
  }
}
