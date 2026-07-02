// Headless rope-joint harness (no webcam, no DOM). Reuses the engine's real attach ritual on a real
// Rapier world and proves the three things the rope-joint task must satisfy:
//
//   (a) STRETCH — under a fast horizontal swing (load), the taut string's chord / nominalLen stays
//       near 1 WITH the rope joint (hard length cap) but overshoots (rubberbands) WITHOUT it.
//   (b) CUT RELEASE (make-or-break) — after cutStringAtSeg on the torso/keystone string, the part
//       must FALL. We compare our code (chain hinge removed AND rope joint severed) against a
//       simulated bug (chain hinge removed, rope joint LEFT ON): with the rope still on, the part
//       stays held; with it severed, the part drops. Also verifies cutAllIntact drops the whole rig.
//   (c) SEIZURE — post-attach peak + settled part speed, same metric as attach-stability.ts, so the
//       rope joint can't have re-introduced the spasm.
//
//   npx esbuild tools/rope-joint.ts --bundle --format=esm --platform=node --outfile=/tmp/rope.mjs
//   node /tmp/rope.mjs
import RAPIER from "@dimforge/rapier3d-compat";
import {
  buildWorld, addPuppet, setPuppetWeight, setDamping, setStringFriction,
  reposePuppet, attachStringForSlot, stillStrings, stillParts,
  cutStringAtSeg, cutAllIntact,
  RIGHT_HAND_BINDING, DEFAULT_PUPPET_WEIGHT, DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING,
  DEFAULT_STRING_FRICTION, CONTROL_BASE_Y, type Puppet, type Vec2, type PuppetString,
} from "../src/puppet.ts";

const GRAVITY = 20;
const DT = 1 / 60;
const stepMs = DT * 1000;
const ATTACH_STRING_MS = 200;
const ATTACH_ORDER = [2, 0, 4, 1, 3];
const SEG_COUNT = 20;
const SETTLE_MS = 700, SETTLE_LINEAR_DAMPING = 5, SETTLE_ANGULAR_DAMPING = 8, SETTLE_FRICTION = 40;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const N = 60;
const SPASM_THRESHOLD = 3.0;

function mulberry32(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function maxPartSpeed(p: Puppet): number { let m = 0; for (const c of p.parts) { const v = c.body.linvel(); m = Math.max(m, Math.hypot(v.x, v.y)); } return m; }
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

function anchorWorld(s: PuppetString): Vec2 {
  const t = s.body.translation();
  const q = s.body.rotation();
  const ang = 2 * Math.atan2(q.z, q.w);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  return { x: t.x + s.bodyAnchor.x * ca - s.bodyAnchor.y * sa, y: t.y + s.bodyAnchor.x * sa + s.bodyAnchor.y * ca };
}
function chordRatio(s: PuppetString): number {
  const c = s.control.translation();
  const a = anchorWorld(s);
  return Math.hypot(a.x - c.x, a.y - c.y) / s.nominalLen;
}
// Strip every rope joint (the NO-ROPE baseline): reproduces the pre-task build (chain only).
function stripRopes(world: RAPIER.World, p: Puppet): void {
  for (const s of p.strings) if (s.ropeJoint) { world.removeImpulseJoint(s.ropeJoint, true); s.ropeJoint = null; }
}

// Build a settled, attached puppet with a fixed (deterministic) held pose. Returns puppet + world +
// the captured control positions so the caller can drive/cut it.
function buildAttached(rng: () => number): { world: RAPIER.World; p: Puppet; captured: Vec2[] } {
  const world = buildWorld(RAPIER, GRAVITY);
  const p = addPuppet(RAPIER, world, 3, RIGHT_HAND_BINDING);
  setPuppetWeight(p, DEFAULT_PUPPET_WEIGHT);
  const headX = p.homeTorso.x;
  const spread = 1.0 + rng() * 2.0;
  const jit = () => (rng() - 0.5);
  const captured: Vec2[] = [
    { x: headX - spread + jit(),       y: CONTROL_BASE_Y - 1.5 + jit() },
    { x: headX - spread * 0.5 + jit(), y: CONTROL_BASE_Y - 0.5 + jit() },
    { x: headX + jit() * 0.6,          y: CONTROL_BASE_Y + jit() * 0.5 },
    { x: headX + spread * 0.5 + jit(), y: CONTROL_BASE_Y - 0.5 + jit() },
    { x: headX + spread + jit(),       y: CONTROL_BASE_Y - 1.5 + jit() },
  ];
  const attachTorso: Vec2 = { x: captured[2].x, y: p.homeTorso.y };
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
  return { world, p, captured };
}

// (c) SEIZURE regression — the CANONICAL held-controls check (identical to attach-stability.ts): attach,
// zero-at-release, settle ramp, then hold the controls FIXED for 2.5s and measure part motion. This is
// the protected anti-seizure metric. rope=false strips the rope joints (the pre-task baseline).
function runSettle(rng: () => number, rope: boolean, iters?: number): { peak: number; late: number } {
  const { world, p, captured } = buildAttached(rng);
  if (!rope) stripRopes(world, p);
  if (iters !== undefined) world.integrationParameters.numSolverIterations = iters;
  setDamping(p, SETTLE_LINEAR_DAMPING, SETTLE_ANGULAR_DAMPING);
  setStringFriction(p, SETTLE_FRICTION);
  let ms = 0, peak = 0, late = 0;
  const RUN_MS = 2500;
  while (ms < RUN_MS) {
    const tt = ms / SETTLE_MS;
    if (tt >= 1) { setDamping(p, DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING); setStringFriction(p, DEFAULT_STRING_FRICTION); }
    else { const k = easeOut(1 - tt); setDamping(p, DEFAULT_LINEAR_DAMPING + (SETTLE_LINEAR_DAMPING - DEFAULT_LINEAR_DAMPING) * k, DEFAULT_ANGULAR_DAMPING + (SETTLE_ANGULAR_DAMPING - DEFAULT_ANGULAR_DAMPING) * k); setStringFriction(p, DEFAULT_STRING_FRICTION + (SETTLE_FRICTION - DEFAULT_STRING_FRICTION) * k); }
    for (const s of p.strings) s.control.setNextKinematicTranslation({ x: captured[s.slot].x, y: captured[s.slot].y, z: 0 });
    world.step();
    ms += stepMs;
    const sp = maxPartSpeed(p);
    peak = Math.max(peak, sp);
    if (RUN_MS - ms < 1000) late = Math.max(late, sp);
  }
  return { peak, late };
}

// (a) STRETCH — attach, settle, then a fast horizontal swing that loads the strings; measure the worst
// chord/nominalLen of any string during the swing. `iters` overrides the world's solver iteration count
// so we can show the rope joint caps stretch even when the chain solver is starved (the tuning lever).
function runLoad(rng: () => number, rope: boolean, iters: number): { maxRatio: number } {
  const { world, p, captured } = buildAttached(rng);
  if (!rope) stripRopes(world, p);
  world.integrationParameters.numSolverIterations = iters;
  setStringFriction(p, DEFAULT_STRING_FRICTION);
  setDamping(p, DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING);
  let ms = 0, maxRatio = 0;
  const SETTLE_HOLD = 500, SWING = 2000, end = SETTLE_HOLD + SWING;
  while (ms < end) {
    let swingDx = 0;
    if (ms > SETTLE_HOLD) { const ph = (ms - SETTLE_HOLD) / 1000; swingDx = 2.5 * Math.sin(ph * 2 * Math.PI * 1.6); }
    for (const s of p.strings) s.control.setNextKinematicTranslation({ x: captured[s.slot].x + swingDx, y: captured[s.slot].y, z: 0 });
    world.step();
    ms += stepMs;
    if (ms > SETTLE_HOLD + 150) for (const s of p.strings) maxRatio = Math.max(maxRatio, chordRatio(s));
  }
  return { maxRatio };
}

// (b) CUT RELEASE — attach/settle, snapshot torso y, cut the torso (keystone) string, hold controls
// fixed for 1.2s, return the torso's y drop. `severRope` picks our code path vs the simulated bug.
function runCut(rng: () => number, severRope: boolean): { drop: number; y0: number; y1: number } {
  const { world, p, captured } = buildAttached(rng);
  setDamping(p, DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING);
  setStringFriction(p, DEFAULT_STRING_FRICTION);
  // brief settle so it's hanging steadily before the cut
  for (let ms = 0; ms < 500; ms += stepMs) {
    for (const s of p.strings) s.control.setNextKinematicTranslation({ x: captured[s.slot].x, y: captured[s.slot].y, z: 0 });
    world.step();
  }
  const y0 = p.torso.translation().y;
  const torsoStr = p.strings.find((s) => s.target === "torso")!;
  if (severRope) {
    cutStringAtSeg(world, p, torsoStr.slot, SEG_COUNT >> 1); // our real code: hinge + rope both removed
  } else {
    // SIMULATED BUG: cut the chain hinge but LEAVE the rope joint — proves the sever is load-bearing.
    world.removeImpulseJoint(torsoStr.joints[SEG_COUNT >> 1], true);
    torsoStr.cutJoint = SEG_COUNT >> 1;
  }
  for (let ms = 0; ms < 1200; ms += stepMs) {
    for (const s of p.strings) s.control.setNextKinematicTranslation({ x: captured[s.slot].x, y: captured[s.slot].y, z: 0 });
    world.step();
  }
  const y1 = p.torso.translation().y;
  return { drop: y0 - y1, y0, y1 };
}

// (b2) FULL KILL — cutAllIntact must drop the whole rig toward the floor.
function runKill(rng: () => number): number {
  const { world, p, captured } = buildAttached(rng);
  setDamping(p, DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING);
  setStringFriction(p, DEFAULT_STRING_FRICTION);
  for (let ms = 0; ms < 500; ms += stepMs) { for (const s of p.strings) s.control.setNextKinematicTranslation({ x: captured[s.slot].x, y: captured[s.slot].y, z: 0 }); world.step(); }
  const y0 = p.torso.translation().y;
  cutAllIntact(world, p);
  for (let ms = 0; ms < 1500; ms += stepMs) { for (const s of p.strings) s.control.setNextKinematicTranslation({ x: captured[s.slot].x, y: captured[s.slot].y, z: 0 }); world.step(); }
  return y0 - p.torso.translation().y;
}

async function main(): Promise<void> {
  await RAPIER.init();
  const seed = 12345;

  // (a) STRETCH — WITH vs WITHOUT the rope joint at several solver-iteration counts (the tuning lever).
  console.log(`(a) STRETCH — worst chord/nominalLen of any string during a fast ±2.5u swing (1.0 = hard cap, >1 = rubberband):`);
  for (const iters of [48, 16, 8]) {
    const withR: number[] = [], noR: number[] = [];
    const rngA = mulberry32(seed), rngB = mulberry32(seed);
    for (let i = 0; i < N; i++) { withR.push(runLoad(rngA, true, iters).maxRatio); noR.push(runLoad(rngB, false, iters).maxRatio); }
    console.log(`    solverIters=${String(iters).padStart(2)}   ROPE worst=${Math.max(...withR).toFixed(3)}   NO-ROPE worst=${Math.max(...noR).toFixed(3)}`);
  }

  // (c) SEIZURE regression — canonical held-controls metric, ROPE vs NO-ROPE over the same poses.
  console.log(`(c) SEIZURE — canonical held-controls post-attach part motion:`);
  for (const rope of [true, false]) {
    const rng = mulberry32(seed);
    const peaks: number[] = [], lates: number[] = [];
    for (let i = 0; i < N; i++) { const r = runSettle(rng, rope); peaks.push(r.peak); lates.push(r.late); }
    peaks.sort((a, b) => a - b);
    const spasms = peaks.filter((x) => x > SPASM_THRESHOLD).length;
    console.log(`    [${rope ? "ROPE   " : "NO-ROPE"}] peak mean=${mean(peaks).toFixed(2)}  worst=${peaks[N - 1].toFixed(2)} u/s  spasms(>${SPASM_THRESHOLD})=${spasms}/${N}  settled(final 1s) mean=${mean(lates).toFixed(3)}`);
  }
  // Seizure at lowered solver iterations (ROPE), to judge whether SOLVER_ITERATIONS can safely come down.
  console.log(`(c') SEIZURE at lowered solver iterations (ROPE, default 48):`);
  for (const iters of [24, 16, 8]) {
    const rng = mulberry32(seed);
    const peaks: number[] = [], lates: number[] = [];
    for (let i = 0; i < N; i++) { const r = runSettle(rng, true, iters); peaks.push(r.peak); lates.push(r.late); }
    peaks.sort((a, b) => a - b);
    const spasms = peaks.filter((x) => x > SPASM_THRESHOLD).length;
    console.log(`    iters=${String(iters).padStart(2)}  peak mean=${mean(peaks).toFixed(2)}  worst=${peaks[N - 1].toFixed(2)} u/s  spasms(>${SPASM_THRESHOLD})=${spasms}/${N}  settled(final 1s) mean=${mean(lates).toFixed(3)}`);
  }

  // (b) CUT RELEASE — paired per-pose: our code (sever) vs simulated bug (rope left on) on the SAME pose.
  {
    const rngA = mulberry32(seed), rngB = mulberry32(seed);
    const dropSever: number[] = [], dropBug: number[] = [], gap: number[] = [];
    for (let i = 0; i < N; i++) {
      const s = runCut(rngA, true).drop, b = runCut(rngB, false).drop;
      dropSever.push(s); dropBug.push(b); gap.push(s - b);
    }
    console.log(`(b) CUT RELEASE — torso y-drop 1.2s after cutting the keystone (torso) string, paired per pose:`);
    console.log(`    OUR CODE (hinge + rope severed) : mean=${mean(dropSever).toFixed(2)}  min=${Math.min(...dropSever).toFixed(2)} u   -> part FALLS`);
    console.log(`    BUG (rope left on)             : mean=${mean(dropBug).toFixed(2)}  max=${Math.max(...dropBug).toFixed(2)} u   -> part stays held`);
    console.log(`    per-pose extra drop from severing = mean=${mean(gap).toFixed(2)}  min=${Math.min(...gap).toFixed(2)} u   make-or-break: ${Math.min(...gap) > 0.3 ? "PASS" : "FAIL"}`);
  }

  // (b2) FULL KILL
  {
    const rng = mulberry32(seed);
    const drops: number[] = [];
    for (let i = 0; i < N; i++) drops.push(runKill(rng));
    console.log(`(b2) FULL KILL — torso y-drop 1.5s after cutAllIntact: mean=${mean(drops).toFixed(2)}  min=${Math.min(...drops).toFixed(2)} u   ${Math.min(...drops) > 1 ? "PASS" : "FAIL"}`);
  }
}

main();
