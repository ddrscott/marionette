// Headless soft-string harness (no webcam, no DOM). Reuses the engine's real attach ritual on a real
// Rapier world and proves the four things the soft goal-drive task must satisfy:
//
//   (a) NO RIP (make-or-break) — attach with the fingers in a TIGHT radius, then snap the hand WIDE
//       open, far and fast. Each limb's socket (its internal ball joint to the torso) must stay put:
//       we measure the separation between the torso's socket anchor and the limb's socket anchor.
//       With the force CAP it stays tiny (the limb lags at the cap and follows); with the cap removed
//       (uncapped spring = the old unbounded rigid pull) it blows the socket open — the rip.
//   (b) CUT RELEASE — after cutString on the torso/keystone string, the part must FALL. We compare our
//       code (goal force dropped for the cut string) against a simulated bug (force STILL applied to a
//       "cut" string): with the force still on, the part stays held; dropped, it drops.
//   (c) SEIZURE — post-attach peak + settled part speed over many held poses: bringing a puppet alive
//       must settle cleanly (no spasm). Also reports the torso rest height so we can confirm the puppet
//       HOLDS ITSELF UP at the chosen cap (doesn't sag to the floor).
//
//   npx esbuild tools/soft-string.ts --bundle --format=esm --platform=node --outfile=/tmp/soft.mjs
//   node /tmp/soft.mjs
import RAPIER from "@dimforge/rapier3d-compat";
import {
  buildWorld, addPuppet, setPuppetWeight, setDamping,
  reposePuppet, attachStringForSlot, stillParts, driveStrings, driveStringGoal, cutString, cutAllIntact,
  anchorWorld, RIGHT_HAND_BINDING, DEFAULT_PUPPET_WEIGHT, DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING,
  DEFAULT_STRING_STIFFNESS, DEFAULT_STRING_DAMPING, DEFAULT_STRING_FORCE_CAP,
  CONTROL_BASE_Y, FLOOR_TOP, type Puppet, type Vec2,
} from "../src/puppet.ts";

const GRAVITY = 20;
const DT = 1 / 60;
const stepMs = DT * 1000;
const ATTACH_STRING_MS = 200;
const ATTACH_ORDER = [2, 0, 4, 1, 3];
const SETTLE_MS = 700, SETTLE_LINEAR_DAMPING = 5, SETTLE_ANGULAR_DAMPING = 8;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const K = DEFAULT_STRING_STIFFNESS, C = DEFAULT_STRING_DAMPING, CAP = DEFAULT_STRING_FORCE_CAP;
const N = 60;
const SPASM_THRESHOLD = 3.0;

function mulberry32(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function maxPartSpeed(p: Puppet): number { let m = 0; for (const c of p.parts) { const v = c.body.linvel(); m = Math.max(m, Math.hypot(v.x, v.y)); } return m; }
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

// The humanoid rig's internal ball joints (torso-local anchor ↔ limb-local anchor), from addPuppet. The
// socket separation between these two world points is ~0 while the joint holds, and grows if a limb is
// ripped from its socket. This is the direct "can a limb be pulled off?" metric.
const SOCKETS = [
  { limb: "lArm", ta: { x: -0.30, y: 0.30 }, la: { x: 0, y: 0.40 } },
  { limb: "rArm", ta: { x: 0.30, y: 0.30 }, la: { x: 0, y: 0.40 } },
  { limb: "lLeg", ta: { x: -0.15, y: -0.60 }, la: { x: 0, y: 0.45 } },
  { limb: "rLeg", ta: { x: 0.15, y: -0.60 }, la: { x: 0, y: 0.45 } },
];
function maxSocketSep(p: Puppet): number {
  const torso = p.partByTarget.torso;
  let m = 0;
  for (const s of SOCKETS) {
    const a = anchorWorld(torso, s.ta);
    const b = anchorWorld(p.partByTarget[s.limb], s.la);
    m = Math.max(m, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return m;
}

// Build a settled, attached puppet at a chosen finger `spread` (radius around the head). Returns puppet
// + world + the captured control positions so the caller can drive/cut it. `spread` small = the tight
// held radius the rip repro starts from.
function buildAttached(rng: () => number, spread: number): { world: RAPIER.World; p: Puppet; captured: Vec2[] } {
  const world = buildWorld(RAPIER, GRAVITY);
  const p = addPuppet(RAPIER, world, 3, RIGHT_HAND_BINDING);
  setPuppetWeight(p, DEFAULT_PUPPET_WEIGHT);
  const headX = p.homeTorso.x;
  const jit = () => (rng() - 0.5) * 0.3;
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
    world.step();
    ms += stepMs;
  }
  stillParts(p);
  return { world, p, captured };
}

// Run the post-attach settle ramp (elevated part damping easing back) for `ms`, holding controls fixed
// + applying the capped goal force each step.
function settle(world: RAPIER.World, p: Puppet, captured: Vec2[], runMs: number, onStep?: () => void): void {
  setDamping(p, SETTLE_LINEAR_DAMPING, SETTLE_ANGULAR_DAMPING);
  let ms = 0;
  while (ms < runMs) {
    const tt = ms / SETTLE_MS;
    if (tt >= 1) setDamping(p, DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING);
    else { const k = easeOut(1 - tt); setDamping(p, DEFAULT_LINEAR_DAMPING + (SETTLE_LINEAR_DAMPING - DEFAULT_LINEAR_DAMPING) * k, DEFAULT_ANGULAR_DAMPING + (SETTLE_ANGULAR_DAMPING - DEFAULT_ANGULAR_DAMPING) * k); }
    for (const s of p.strings) s.control.setNextKinematicTranslation({ x: captured[s.slot].x, y: captured[s.slot].y, z: 0 });
    driveStrings(p, K, C, CAP, DT);
    world.step();
    ms += stepMs;
    onStep?.();
  }
}

// (a) NO RIP — attach TIGHT, settle, then snap the hand WIDE open (far) and oscillate it FAST for 1.5s.
// Returns the worst socket separation (the limb↔torso ball joint must never open — a limb can't come
// off) AND the worst limb SPEED (the "flail" metric): with the cap the limb lags gently, uncapped it
// whips. `cap` contrasts the real cap vs an ~uncapped spring (the old unbounded rigid pull).
function runRip(rng: () => number, cap: number): { maxSep: number; maxSpeed: number } {
  const { world, p, captured } = buildAttached(rng, 0.35); // tight held radius
  settle(world, p, captured, 500);
  const headX = p.homeTorso.x;
  // wide-open target per slot (thumb/pinky flung far out + up), the exact "open the hand wide" repro
  const wide: Vec2[] = [
    { x: headX - 5, y: CONTROL_BASE_Y + 0.5 },
    { x: headX - 3, y: CONTROL_BASE_Y + 1.0 },
    { x: headX,     y: CONTROL_BASE_Y + 1.5 },
    { x: headX + 3, y: CONTROL_BASE_Y + 1.0 },
    { x: headX + 5, y: CONTROL_BASE_Y + 0.5 },
  ];
  let ms = 0, maxSep = 0, maxSpeed = 0;
  const RUN = 1500;
  while (ms < RUN) {
    const ph = ms / 1000;
    const osc = 3.0 * Math.sin(ph * 2 * Math.PI * 2.0); // fast far oscillation on top of the wide snap
    for (const s of p.strings) {
      const w = wide[s.slot];
      s.control.setNextKinematicTranslation({ x: w.x + osc, y: w.y, z: 0 });
    }
    driveStrings(p, K, C, cap, DT);
    world.step();
    ms += stepMs;
    maxSep = Math.max(maxSep, maxSocketSep(p));
    maxSpeed = Math.max(maxSpeed, maxPartSpeed(p));
  }
  return { maxSep, maxSpeed };
}

// (b) CUT RELEASE — attach/settle, snapshot torso y, cut the torso (keystone) string, hold controls
// fixed for 1.2s, return the torso's y drop. `dropForce` picks our real code (force dropped for the cut
// string) vs a simulated bug (force kept on the cut string).
function runCut(rng: () => number, dropForce: boolean): number {
  const { world, p, captured } = buildAttached(rng, 1.5);
  settle(world, p, captured, 500);
  const y0 = p.torso.translation().y;
  const torsoStr = p.strings.find((s) => s.target === "torso")!;
  const mid: Vec2 = { x: p.torso.translation().x, y: p.torso.translation().y };
  cutString(p, torsoStr.slot, mid);
  for (let ms = 0; ms < 1200; ms += stepMs) {
    for (const s of p.strings) s.control.setNextKinematicTranslation({ x: captured[s.slot].x, y: captured[s.slot].y, z: 0 });
    if (dropForce) {
      driveStrings(p, K, C, CAP, DT); // real code: cut string is skipped inside driveStringGoal -> part falls
    } else {
      // SIMULATED BUG: keep forcing even the cut string by temporarily un-cutting it for the drive call.
      for (const s of p.strings) {
        if (s.cut) { s.cut = false; driveStringGoal(s, K, C, CAP, DT); s.cut = true; }
        else driveStringGoal(s, K, C, CAP, DT);
      }
    }
    world.step();
  }
  return y0 - p.torso.translation().y;
}

// (b2) FULL KILL — cutAllIntact must drop the whole rig to the floor. The drop is floor-limited (the
// torso only has ~1.7u to fall before it rests), so we assert the torso ENDS resting near the floor.
function runKill(rng: () => number): number {
  const { world, p, captured } = buildAttached(rng, 1.5);
  settle(world, p, captured, 500);
  cutAllIntact(p);
  for (let ms = 0; ms < 2500; ms += stepMs) { driveStrings(p, K, C, CAP, DT); world.step(); }
  return p.torso.translation().y; // final torso height — should be down at the floor rest zone
}

// (c) SEIZURE + HOLD-UP — attach, settle ramp, then hold the controls FIXED for 2.5s and measure part
// motion (peak + final-second settled) and the torso's rest height (must stay well above the floor).
function runSettleMetric(rng: () => number): { peak: number; late: number; torsoY: number } {
  const { world, p, captured } = buildAttached(rng, 1.0 + rng() * 2.0);
  let peak = 0, late = 0;
  const RUN_MS = 2500;
  let ms = 0;
  setDamping(p, SETTLE_LINEAR_DAMPING, SETTLE_ANGULAR_DAMPING);
  while (ms < RUN_MS) {
    const tt = ms / SETTLE_MS;
    if (tt >= 1) setDamping(p, DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING);
    else { const k = easeOut(1 - tt); setDamping(p, DEFAULT_LINEAR_DAMPING + (SETTLE_LINEAR_DAMPING - DEFAULT_LINEAR_DAMPING) * k, DEFAULT_ANGULAR_DAMPING + (SETTLE_ANGULAR_DAMPING - DEFAULT_ANGULAR_DAMPING) * k); }
    for (const s of p.strings) s.control.setNextKinematicTranslation({ x: captured[s.slot].x, y: captured[s.slot].y, z: 0 });
    driveStrings(p, K, C, CAP, DT);
    world.step();
    ms += stepMs;
    const sp = maxPartSpeed(p);
    peak = Math.max(peak, sp);
    if (RUN_MS - ms < 1000) late = Math.max(late, sp);
  }
  return { peak, late, torsoY: p.torso.translation().y };
}

async function main(): Promise<void> {
  await RAPIER.init();
  const seed = 12345;

  console.log(`soft goal-drive strings — k=${K} c=${C} cap=${CAP}, gravity=${GRAVITY}, weight=${DEFAULT_PUPPET_WEIGHT}\n`);

  // (a) NO RIP — a tight→wide-open fast yank: the socket must never open (limb can't come off) and the
  // cap must tame the flail (limb speed) vs the uncapped (old unbounded) pull.
  {
    const capSep: number[] = [], capSpd: number[] = [], uncSpd: number[] = [];
    const rngA = mulberry32(seed), rngB = mulberry32(seed);
    for (let i = 0; i < N; i++) { const a = runRip(rngA, CAP), b = runRip(rngB, 1e9); capSep.push(a.maxSep); capSpd.push(a.maxSpeed); uncSpd.push(b.maxSpeed); }
    const sepW = Math.max(...capSep), csW = Math.max(...capSpd), usW = Math.max(...uncSpd);
    console.log(`(a) NO RIP — tight→wide-open fast yank:`);
    console.log(`    limb↔torso socket separation (capped) worst=${sepW.toFixed(4)} u   -> limbs NEVER come off (welded < 0.05): ${sepW < 0.05 ? "PASS" : "FAIL"}`);
    console.log(`    worst limb speed — CAPPED (cap=${CAP})=${csW.toFixed(1)} u/s   vs UNCAPPED (old rigid)=${usW.toFixed(1)} u/s`);
    console.log(`    the cap tames the flail (capped < half uncapped): ${csW < usW * 0.5 ? "PASS" : "FAIL"}\n`);
  }

  // (c) SEIZURE + HOLD-UP
  {
    const rng = mulberry32(seed);
    const peaks: number[] = [], lates: number[] = [], ys: number[] = [];
    for (let i = 0; i < N; i++) { const r = runSettleMetric(rng); peaks.push(r.peak); lates.push(r.late); ys.push(r.torsoY); }
    peaks.sort((a, b) => a - b);
    const spasms = peaks.filter((x) => x > SPASM_THRESHOLD).length;
    const minY = Math.min(...ys);
    console.log(`(c) SEIZURE — post-attach part motion (held controls):`);
    console.log(`    peak mean=${mean(peaks).toFixed(2)}  worst=${peaks[N - 1].toFixed(2)} u/s  spasms(>${SPASM_THRESHOLD})=${spasms}/${N}  settled(final 1s) mean=${mean(lates).toFixed(3)}  ${spasms === 0 ? "PASS" : "CHECK"}`);
    console.log(`    HOLD-UP — torso rest height: mean=${mean(ys).toFixed(2)}  min=${minY.toFixed(2)} u  (floor top=${FLOOR_TOP})  ${minY > FLOOR_TOP + 1 ? "PASS (holds up)" : "FAIL (sags)"}\n`);
  }

  // (b) CUT RELEASE — our code (force dropped) vs bug (force kept), paired per pose.
  {
    const rngA = mulberry32(seed), rngB = mulberry32(seed);
    const dropReal: number[] = [], dropBug: number[] = [], gap: number[] = [];
    for (let i = 0; i < N; i++) { const s = runCut(rngA, true), b = runCut(rngB, false); dropReal.push(s); dropBug.push(b); gap.push(s - b); }
    console.log(`(b) CUT RELEASE — torso y-drop 1.2s after cutting the keystone (torso) string, paired per pose:`);
    console.log(`    OUR CODE (goal force dropped) : mean=${mean(dropReal).toFixed(2)}  min=${Math.min(...dropReal).toFixed(2)} u   -> part FALLS`);
    console.log(`    BUG (force kept on cut string): mean=${mean(dropBug).toFixed(2)}  max=${Math.max(...dropBug).toFixed(2)} u   -> part stays held`);
    console.log(`    per-pose extra drop from dropping the force = min=${Math.min(...gap).toFixed(2)} u   make-or-break: ${Math.min(...gap) > 0.3 ? "PASS" : "FAIL"}\n`);
  }

  // (b2) FULL KILL
  {
    const rng = mulberry32(seed);
    const ys: number[] = [];
    for (let i = 0; i < N; i++) ys.push(runKill(rng));
    const restZone = FLOOR_TOP + 1.0; // torso half + a little slack above the floor top
    console.log(`(b2) FULL KILL — torso rest height 2.5s after cutAllIntact: mean=${mean(ys).toFixed(2)}  max=${Math.max(...ys).toFixed(2)} u  (floor top=${FLOOR_TOP})   ${Math.max(...ys) < restZone ? "PASS (all grounded)" : "FAIL"}`);
  }
}

main();
