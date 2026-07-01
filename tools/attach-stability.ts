// Headless attach-stability harness (no webcam, no DOM). Reproduces the engine's attach ritual on a
// real Rapier world and measures post-attach part motion, to prove the "seizure" fix keeps the freed
// puppet's motion bounded and decaying instead of spiking.
//
//   npx esbuild tools/attach-stability.ts --bundle --format=esm --platform=node --outfile=/tmp/h.mjs
//   node /tmp/h.mjs          # WITH the fix (calm segs during attach + zero-at-release + settle ramp)
//   node /tmp/h.mjs --nofix  # OLD behavior (only setStringFriction at release) for comparison
//
// It sweeps many RANDOMIZED captured poses (the real capture is noisy hand-tracking, and the seizure
// is highly pose-sensitive — ~95% spasm, ~5% clean). We report the peak part speed distribution and
// count how many poses "spasm" (peak part speed over a threshold). The on-screen FEEL still needs a
// Chrome check; this only proves the physics is bounded and decays.
import RAPIER from "@dimforge/rapier3d-compat";
import {
  buildWorld, addPuppet, setPuppetWeight, setDamping, setStringFriction,
  reposePuppet, attachStringForSlot, stillStrings, stillParts,
  RIGHT_HAND_BINDING, DEFAULT_PUPPET_WEIGHT, DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING,
  DEFAULT_STRING_FRICTION, CONTROL_BASE_Y, type Puppet, type Vec2,
} from "../src/puppet.ts";

const GRAVITY = 20;
const DT = 1 / 60;
const stepMs = DT * 1000;
const ATTACH_STRING_MS = 200;
const ATTACH_ORDER = [2, 0, 4, 1, 3];
const SETTLE_MS = 700, SETTLE_LINEAR_DAMPING = 5, SETTLE_ANGULAR_DAMPING = 8, SETTLE_FRICTION = 40;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

const FIX = !process.argv.includes("--nofix");
const N = 60;                 // number of randomized poses to sweep
const SPASM_THRESHOLD = 3.0;  // peak part speed (u/s) above which we call an attach a "spasm"

// deterministic PRNG so the two modes see the SAME pose set
function mulberry32(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function maxPartSpeed(p: Puppet): number {
  let m = 0; for (const c of p.parts) { const v = c.body.linvel(); m = Math.max(m, Math.hypot(v.x, v.y)); } return m;
}

// One attach + settle run on a fresh world; returns the peak part speed after release.
function runOnce(rng: () => number): { peak: number; late: number } {
  const world = buildWorld(RAPIER, GRAVITY);
  const p = addPuppet(RAPIER, world, 3, RIGHT_HAND_BINDING);
  setPuppetWeight(p, DEFAULT_PUPPET_WEIGHT);

  // Random held-hand arch: middle finger over the torso, others fanned with per-finger jitter — the
  // kind of asymmetric, noisy pose the tracker actually captures.
  const headX = p.homeTorso.x;
  const spread = 1.0 + rng() * 2.0;   // how wide the hand is held
  const jit = () => (rng() - 0.5);
  const captured: Vec2[] = [
    { x: headX - spread + jit(),     y: CONTROL_BASE_Y - 1.5 + jit() },
    { x: headX - spread * 0.5 + jit(), y: CONTROL_BASE_Y - 0.5 + jit() },
    { x: headX + jit() * 0.6,        y: CONTROL_BASE_Y + jit() * 0.5 },
    { x: headX + spread * 0.5 + jit(), y: CONTROL_BASE_Y - 0.5 + jit() },
    { x: headX + spread + jit(),     y: CONTROL_BASE_Y - 1.5 + jit() },
  ];
  const attachTorso: Vec2 = { x: captured[2].x, y: p.homeTorso.y };

  // ---- ATTACH: build 5 strings, one every 200ms, parts pinned each frame ----
  const attachDur = ATTACH_ORDER.length * ATTACH_STRING_MS;
  let attached = 0, ms = 0;
  while (attached < ATTACH_ORDER.length || ms < attachDur) {
    reposePuppet(p, attachTorso);
    for (const s of p.strings) s.control.setNextKinematicTranslation({ x: captured[s.slot].x, y: captured[s.slot].y, z: 0 });
    const due = Math.min(ATTACH_ORDER.length, Math.floor(ms / ATTACH_STRING_MS) + 1);
    while (attached < due) { const sSlot = ATTACH_ORDER[attached]; attachStringForSlot(RAPIER, world, p, sSlot, captured[sSlot], p.binding[sSlot]); attached++; }
    if (FIX) stillStrings(p);          // fix: calm chains during attach
    world.step();
    ms += stepMs;
  }

  // ---- RELEASE ----
  if (FIX) {
    stillParts(p); stillStrings(p);
    setDamping(p, SETTLE_LINEAR_DAMPING, SETTLE_ANGULAR_DAMPING);
    setStringFriction(p, SETTLE_FRICTION);
  } else {
    setStringFriction(p, DEFAULT_STRING_FRICTION); // old behavior
  }
  const settleT0 = ms;

  // ---- RUNNING window: hold controls fixed, measure part motion for 2.5s ----
  const RUN_MS = 2500, end = ms + RUN_MS;
  let peak = 0, late = 0;
  while (ms < end) {
    if (FIX) {
      const tt = (ms - settleT0) / SETTLE_MS;
      if (tt >= 1) { setDamping(p, DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING); setStringFriction(p, DEFAULT_STRING_FRICTION); }
      else { const k = easeOut(1 - tt); setDamping(p, DEFAULT_LINEAR_DAMPING + (SETTLE_LINEAR_DAMPING - DEFAULT_LINEAR_DAMPING) * k, DEFAULT_ANGULAR_DAMPING + (SETTLE_ANGULAR_DAMPING - DEFAULT_ANGULAR_DAMPING) * k); setStringFriction(p, DEFAULT_STRING_FRICTION + (SETTLE_FRICTION - DEFAULT_STRING_FRICTION) * k); }
    }
    for (const s of p.strings) s.control.setNextKinematicTranslation({ x: captured[s.slot].x, y: captured[s.slot].y, z: 0 });
    world.step();
    ms += stepMs;
    const sp = maxPartSpeed(p);
    peak = Math.max(peak, sp);
    if (end - ms < 1000) late = Math.max(late, sp);
  }
  return { peak, late };
}

async function main(): Promise<void> {
  await RAPIER.init();
  const rng = mulberry32(12345); // same seed both modes -> identical pose set
  const peaks: number[] = [], lates: number[] = [];
  for (let i = 0; i < N; i++) { const r = runOnce(rng); peaks.push(r.peak); lates.push(r.late); }
  peaks.sort((a, b) => a - b); lates.sort((a, b) => a - b);
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const spasms = peaks.filter((x) => x > SPASM_THRESHOLD).length;
  const mode = FIX ? "WITH FIX" : "NO FIX  ";
  console.log(`${mode} over ${N} random poses:`);
  console.log(`  peak part speed  mean=${mean(peaks).toFixed(2)}  median=${peaks[N >> 1].toFixed(2)}  worst=${peaks[N - 1].toFixed(2)} u/s`);
  console.log(`  settled (final 1s) mean=${mean(lates).toFixed(3)}  worst=${lates[N - 1].toFixed(3)} u/s`);
  console.log(`  spasms (peak > ${SPASM_THRESHOLD} u/s): ${spasms}/${N}  (${(100 * spasms / N).toFixed(0)}%)`);
}

main();
