// Game rules for /game, layered on the shared engine via stage.onFrame. Two ways a marionette goes
// down:
//   1. Swipe — swing YOUR puppet's WEAPON through the OTHER puppet's strings to cut them. The blade is
//      bolted PAST the limb tip (puppet.ts armPuppet), so it reaches the opponent's strings while your
//      body stays back — offense you can land safely. A hit SEVERS that string at the swiped hinge
//      (both halves dangle — it doesn't vanish), freeing the part it held. Cutting the head/torso
//      string (or the last intact string) drops the whole puppet; cutting a WEAPON ARM's string DISARMS
//      that blade (dropped, can't cut) — the middle rung. The blade must be MOVING (a swing, not
//      resting contact). An UNARMED puppet (e.g. /characters rigs) falls back to bare-limb cutting.
//   2. Ground-out — if a running puppet's torso comes to rest on the floor, it loses.
import type { Stage } from "./engine.ts";
import {
  cutString, cutAllIntact, disarmWeapon, limbAxisPoint, liveWeaponReach, isArmed, anchorWorld,
  FLOOR_TOP, type Capsule, type Puppet,
} from "./puppet.ts";

// How many points to sample along a string (control→limb anchor) when testing a blade against it. The
// soft strings carry no physics segments, so we hit-test the straight goal line the renderer draws.
const CUT_SAMPLES = 24;

const CUT_RADIUS = 0.6;       // world units: a limb tip within this of a string segment cuts that string
const CUT_SPEED = 2.5;        // min limb-tip speed (units/s) for a hit to count as a swipe
const CUT_COOLDOWN_MS = 350;  // per attacker, between cuts (no rapid-fire multi-cut)
const GROUND_MARGIN = 0.12;   // torso bottom within this of the floor = grounded
const CLASH_DIST = 0.55;      // two limbs (tip/center) within this world distance = a collision
const CLASH_SPEED = 2.0;      // combined limb speed for a clash to "ring" (resting adjacency stays quiet)
const CLASH_COOLDOWN_MS = 200; // between clash rings so a sustained overlap doesn't machine-gun

// Optional audio (or other) hooks the game subscribes to. Kept as plain callbacks so cut.ts stays
// engine-only and never imports the audio layer.
export interface CutEvents {
  onSlice?: () => void;  // a string was just severed
  onClash?: () => void;  // the two puppets' limbs just collided
  onDisarm?: () => void; // a weapon arm's string was cut — the blade dropped
}

export interface RulesState {
  lastCutAt: [number, number]; // per attacker slot
  dead: [boolean, boolean];    // per puppet: dropped / lost
  lastClashAt: number;         // shared clash cooldown clock
}
export const makeRulesState = (): RulesState => ({ lastCutAt: [-1e9, -1e9], dead: [false, false], lastClashAt: -1e9 });

// World-space tip of a limb capsule (the free end — the hand/foot — opposite the torso joint).
function tipOf(part: Capsule): { x: number; y: number } {
  const p = part.body.translation();
  const q = part.body.rotation();
  const th = 2 * Math.atan2(q.z, q.w); // z-only rotation
  return { x: p.x + part.half * Math.sin(th), y: p.y - part.half * Math.cos(th) };
}
function speedOf(part: Capsule): number { const v = part.body.linvel(); return Math.hypot(v.x, v.y); }
const intactCount = (p: Puppet): number => p.strings.reduce((n, s) => n + (s.cut ? 0 : 1), 0);

// The cutting point of an attacking limb: the BLADE tip when armed (limb tip + weapon reach), else the
// bare limb tip. So an armed puppet cuts from disjoint reach; an unarmed one cuts as it always did.
const attackPoint = (part: Capsule): { x: number; y: number } => limbAxisPoint(part, part.half + liveWeaponReach(part));

// The limbs that can actually cut: an ARMED puppet cuts ONLY with its live weapons (positioning the
// blade IS the skill, and bare legs don't slice). A puppet with NO live weapon falls back to bare-limb
// cutting — that's both the /characters (unarmed rigs) path AND, intentionally, a FULLY-disarmed
// fighter: it keeps a desperate, short-reach offense so a disarm is a big disadvantage, not an instant
// loss (the poke→disarm→finish ladder would collapse if disarm meant "can never cut again").
const attackersOf = (p: Puppet): Capsule[] =>
  isArmed(p) ? p.parts.filter((c) => c.weapon && !c.weapon.disarmed) : p.parts.filter((c) => c.body !== p.torso);

function torsoGrounded(puppet: Puppet): boolean {
  const torso = puppet.parts.find((c) => c.body === puppet.torso);
  if (!torso) return false;
  return torso.body.translation().y - torso.half <= FLOOR_TOP + GROUND_MARGIN;
}

function kill(stage: Stage, slot: 0 | 1, cs: RulesState): void {
  cutAllIntact(stage.puppets[slot]); // sever any remaining strings -> full dangling collapse
  cs.dead[slot] = true;
}

// The limbs (arms + legs) of a puppet — its weapons, and what can clash with the other puppet.
const limbsOf = (p: Puppet): Capsule[] => p.parts.filter((c) => c.body !== p.torso);

// Detect the two puppets' limbs colliding. We don't read Rapier contact events (the puppets now DO
// collide physically via per-player groups, but the clash *ring* wants to fire on a fast pass even at
// the moment of contact, not only on a resolved penetration) — instead we sample each limb's tip +
// center and ring when any cross-puppet pair is within CLASH_DIST while actually moving. Throttled by
// a shared cooldown so a sustained overlap doesn't machine-gun.
function detectClash(stage: Stage, cs: RulesState, now: number, ev?: CutEvents): void {
  if (!ev?.onClash) return;
  if (now - cs.lastClashAt < CLASH_COOLDOWN_MS) return;
  if (stage.slotStates[0].phase !== "running" || stage.slotStates[1].phase !== "running") return;
  const la = limbsOf(stage.puppets[0]);
  const lb = limbsOf(stage.puppets[1]);
  for (const a of la) {
    const at = tipOf(a), ac = a.body.translation(), as = speedOf(a);
    for (const b of lb) {
      const bt = tipOf(b), bc = b.body.translation();
      const near =
        Math.hypot(at.x - bt.x, at.y - bt.y) < CLASH_DIST ||
        Math.hypot(ac.x - bc.x, ac.y - bc.y) < CLASH_DIST ||
        Math.hypot(at.x - bc.x, at.y - bc.y) < CLASH_DIST ||
        Math.hypot(ac.x - bt.x, ac.y - bt.y) < CLASH_DIST;
      if (near && as + speedOf(b) > CLASH_SPEED) {
        cs.lastClashAt = now;
        ev.onClash();
        return;
      }
    }
  }
}

// Advance the game rules one frame. Mutates the world (cutting strings) and `cs`. `ev` gets optional
// slice/clash callbacks so the game can react (SFX) without cut.ts knowing about audio.
export function updateRules(stage: Stage, cs: RulesState, now: number, ev?: CutEvents): void {
  detectClash(stage, cs, now, ev);
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
    const limbs = attackersOf(atk); // the live weapons (armed), or bare limbs (unarmed fallback)
    let done = false;
    for (const limb of limbs) {
      if (speedOf(limb) < CUT_SPEED) continue; // must be swinging
      const tip = attackPoint(limb); // blade tip (armed) or bare limb tip
      for (const s of vic.strings) {
        if (s.cut) continue; // already severed
        // Sample the straight goal line (fingertip control → limb anchor) — the line the renderer draws —
        // and cut if the blade tip passes within CUT_RADIUS of any point on it.
        const top = s.control.translation();
        const end = anchorWorld(s.body, s.bodyAnchor);
        let hit: { x: number; y: number } | null = null;
        for (let k = 0; k <= CUT_SAMPLES; k++) {
          const t = k / CUT_SAMPLES;
          const px = top.x + (end.x - top.x) * t, py = top.y + (end.y - top.y) * t;
          if (Math.hypot(tip.x - px, tip.y - py) < CUT_RADIUS) { hit = { x: px, y: py }; break; }
        }
        if (!hit) continue;
        const target = cutString(vic, s.slot, hit);
        cs.lastCutAt[a] = now;
        ev?.onSlice?.();
        if (target === "torso" || intactCount(vic) === 0) {
          kill(stage, v, cs); // head cut / last string = drop
        } else if (target) {
          // cutting a weapon arm's string drops its blade (disarm) — an earned edge, not a kill
          const part = vic.parts.find((c) => c.body === vic.partByTarget[target]);
          if (part && disarmWeapon(stage.world, part)) ev?.onDisarm?.();
        }
        done = true;
        break;
      }
      if (done) break;
    }
  }
}
