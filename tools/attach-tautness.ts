// Headless attach-TAUTNESS harness (no webcam, no DOM). Reuses the engine's attach ritual on a real
// Rapier world and measures, after the puppet settles, each string's TAUTNESS:
//
//     taut = dist(control, partAnchorWorld) / nominalLen
//
// A rigid chain hangs near-straight when this ratio ~1 (chord ~ its length) and SAGS when the ratio
// falls well below 1 (the endpoints drew closer than the chain is long, so it drapes). That would be
// the dead-zone slack a puppeteer has to take up before the puppet responds. We also reuse the seizure
// harness's peak/settled part-speed check so a tautness reading can't hide a stability regression.
//
// FINDING (attach-slack-taut.md investigation): with the current build (STRING_SLACK = 1.0, chain
// length = the captured chord) the strings ALREADY settle near-taut — even when the control is eased
// from a wide held pose into a bunched "relaxed" pose after attach (the mechanism the brief blamed for
// the slack). The straight-line chord tracks the chain length (ratio ~1.000). So there is no baked-in
// physics slack for a reference-pose capture normalization to remove; adding one only injected extra
// post-release energy (higher peak + settled part speeds) with no tautness gain. Kept as a regression
// guard proving the strings hang taut, and to re-run against any future string-model change.
//
//   npx esbuild tools/attach-tautness.ts --bundle --format=esm --platform=node --outfile=/tmp/t.mjs
//   node /tmp/t.mjs
import RAPIER from "@dimforge/rapier3d-compat";
import {
  buildWorld, addPuppet, setPuppetWeight, setDamping, setStringFriction,
  reposePuppet, attachStringForSlot, stillStrings, stillParts,
  RIGHT_HAND_BINDING, DEFAULT_PUPPET_WEIGHT, DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING,
  DEFAULT_STRING_FRICTION, CONTROL_BASE_Y, type Puppet, type Vec2, type PuppetString,
} from "../src/puppet.ts";

const GRAVITY = 20;
const DT = 1 / 60;
const stepMs = DT * 1000;
const ATTACH_STRING_MS = 200;
const ATTACH_ORDER = [2, 0, 4, 1, 3];
const SETTLE_MS = 700, SETTLE_LINEAR_DAMPING = 5, SETTLE_ANGULAR_DAMPING = 8, SETTLE_FRICTION = 40;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

const N = 60;
const SPASM_THRESHOLD = 3.0;

function mulberry32(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function maxPartSpeed(p: Puppet): number {
  let m = 0; for (const c of p.parts) { const v = c.body.linvel(); m = Math.max(m, Math.hypot(v.x, v.y)); } return m;
}

// World point of a string's body-side anchor (rotate the body-local anchor by the part's z-rotation).
function anchorWorld(s: PuppetString): Vec2 {
  const t = s.body.translation();
  const q = s.body.rotation();
  const ang = 2 * Math.atan2(q.z, q.w);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  return { x: t.x + s.bodyAnchor.x * ca - s.bodyAnchor.y * sa, y: t.y + s.bodyAnchor.x * sa + s.bodyAnchor.y * ca };
}

function tautness(s: PuppetString): number {
  const c = s.control.translation();
  const a = anchorWorld(s);
  return Math.hypot(a.x - c.x, a.y - c.y) / s.nominalLen;
}

// One attach + settle run; returns per-slot tautness (post-settle) and the peak part speed.
function runOnce(rng: () => number): { taut: Record<number, number>; peak: number; late: number } {
  const world = buildWorld(RAPIER, GRAVITY);
  const p = addPuppet(RAPIER, world, 3, RIGHT_HAND_BINDING);
  setPuppetWeight(p, DEFAULT_PUPPET_WEIGHT);

  // Simulated RELAXED / FORESHORTENED capture: middle finger over the torso, the other fingertips
  // bunched near the palm center (small spread) and low — the pose the brief calls out as the one that
  // bakes in dead-zone slack.
  const headX = p.homeTorso.x;
  const spread = 1.0 + rng() * 2.0;   // held-pose fingertip spread (matches the seizure harness)
  const jit = () => (rng() - 0.5) * 0.6;
  const captured: Vec2[] = [
    { x: headX - spread + jit(),       y: CONTROL_BASE_Y - 1.8 + jit() },
    { x: headX - spread * 0.5 + jit(), y: CONTROL_BASE_Y - 1.2 + jit() },
    { x: headX + jit() * 0.5,          y: CONTROL_BASE_Y - 0.4 + jit() },
    { x: headX + spread * 0.5 + jit(), y: CONTROL_BASE_Y - 1.2 + jit() },
    { x: headX + spread + jit(),       y: CONTROL_BASE_Y - 1.8 + jit() },
  ];
  const attachTorso: Vec2 = { x: captured[2].x, y: p.homeTorso.y };
  // The RUNNING drive pose: after attach the puppeteer relaxes the deliberate hold into a comfortable
  // neutral. We model that as the captured cluster CONTRACTED toward the middle finger (fingers bunch
  // back toward the palm centre) — the "span drops below the built length" the brief describes. The
  // string was frozen to `captured`; the control is then driven to `relaxed`, and any slack shows up.
  const RELAX = 0.55; // 0 = drive at the exact held pose, 1 = fully collapsed onto the middle finger
  const relaxed: Vec2[] = captured.map((c) => ({
    x: captured[2].x + (c.x - captured[2].x) * (1 - RELAX),
    y: captured[2].y + (c.y - captured[2].y) * (1 - RELAX),
  }));

  const attachDur = ATTACH_ORDER.length * ATTACH_STRING_MS;
  let attached = 0, ms = 0;
  while (attached < ATTACH_ORDER.length || ms < attachDur) {
    reposePuppet(p, attachTorso);
    for (const s of p.strings) s.control.setNextKinematicTranslation({ x: captured[s.slot].x, y: captured[s.slot].y, z: 0 });
    const due = Math.min(ATTACH_ORDER.length, Math.floor(ms / ATTACH_STRING_MS) + 1);
    while (attached < due) { const sSlot = ATTACH_ORDER[attached]; attachStringForSlot(RAPIER, world, p, sSlot, captured[sSlot], p.binding[sSlot]); attached++; }
    stillStrings(p);
    world.step();
    ms += stepMs;
  }

  stillParts(p); stillStrings(p);
  setDamping(p, SETTLE_LINEAR_DAMPING, SETTLE_ANGULAR_DAMPING);
  setStringFriction(p, SETTLE_FRICTION);
  const settleT0 = ms;

  const RUN_MS = 2500, end = ms + RUN_MS;
  let peak = 0, late = 0;
  while (ms < end) {
    const tt = (ms - settleT0) / SETTLE_MS;
    if (tt >= 1) { setDamping(p, DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING); setStringFriction(p, DEFAULT_STRING_FRICTION); }
    else { const k = easeOut(1 - tt); setDamping(p, DEFAULT_LINEAR_DAMPING + (SETTLE_LINEAR_DAMPING - DEFAULT_LINEAR_DAMPING) * k, DEFAULT_ANGULAR_DAMPING + (SETTLE_ANGULAR_DAMPING - DEFAULT_ANGULAR_DAMPING) * k); setStringFriction(p, DEFAULT_STRING_FRICTION + (SETTLE_FRICTION - DEFAULT_STRING_FRICTION) * k); }
    // Drive from the held pose EASING into the RELAXED pose over ~1s (a human relaxing the deliberate
    // hold — not a teleport), which is where the dead-zone slack shows up in the real app.
    const rr = Math.min(1, (ms - settleT0) / 1000);
    for (const s of p.strings) {
      const j = s.slot;
      s.control.setNextKinematicTranslation({
        x: captured[j].x + (relaxed[j].x - captured[j].x) * rr,
        y: captured[j].y + (relaxed[j].y - captured[j].y) * rr,
        z: 0,
      });
    }
    world.step();
    ms += stepMs;
    const sp = maxPartSpeed(p);
    peak = Math.max(peak, sp);
    if (end - ms < 1000) late = Math.max(late, sp);
  }
  const taut: Record<number, number> = {};
  for (const s of p.strings) taut[s.slot] = tautness(s);
  return { taut, peak, late };
}

async function main(): Promise<void> {
  await RAPIER.init();
  const rng = mulberry32(12345);
  const bySlot: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [] };
  const peaks: number[] = [];
  const lates: number[] = [];
  const allTaut: number[] = [];
  for (let i = 0; i < N; i++) {
    const r = runOnce(rng);
    for (const k of Object.keys(r.taut)) { bySlot[+k].push(r.taut[+k]); allTaut.push(r.taut[+k]); }
    peaks.push(r.peak);
    lates.push(r.late);
  }
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const min = (a: number[]) => a.reduce((m, x) => Math.min(m, x), Infinity);
  const label = ["0 thumb→arm", "1 index→leg", "2 middle→head", "3 ring→leg", "4 pinky→arm"];
  console.log(`current build (STRING_SLACK-taut chains) over ${N} held→relaxed capture poses:`);
  console.log(`  post-settle tautness = dist(control, partAnchor) / nominalLen   (1.0 = straight/taut, <<1 = sag)`);
  for (let slot = 0; slot < 5; slot++) {
    console.log(`    slot ${slot} ${label[slot].padEnd(15)} mean=${mean(bySlot[slot]).toFixed(3)}  min=${min(bySlot[slot]).toFixed(3)}`);
  }
  console.log(`  ALL strings  mean=${mean(allTaut).toFixed(3)}  min=${min(allTaut).toFixed(3)}`);
  const spasms = peaks.filter((x) => x > SPASM_THRESHOLD).length;
  peaks.sort((a, b) => a - b);
  console.log(`  peak part speed  mean=${mean(peaks).toFixed(2)}  worst=${peaks[N - 1].toFixed(2)} u/s   spasms(>${SPASM_THRESHOLD})=${spasms}/${N}`);
  console.log(`  settled (final 1s)  mean=${mean(lates).toFixed(3)}  worst=${Math.max(...lates).toFixed(3)} u/s`);
}

main();
