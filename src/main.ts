import RAPIER from "@dimforge/rapier3d-compat";
import { OneEuro } from "./oneEuro.ts";
import {
  buildWorld, addPuppet, setDamping, setPuppetWeight, setStringFriction,
  FINGERTIPS, bindingForHandedness, PUPPET_X_OFFSET, RIGHT_HAND_BINDING, LEFT_HAND_BINDING,
  DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING, DEFAULT_PUPPET_WEIGHT, DEFAULT_STRING_FRICTION,
  CENTER_STRING_LEN, WORLD_VIEW_HEIGHT, FLOOR_TOP, type Puppet, type FingerBind, type TargetName,
} from "./puppet.ts";
import { stageX, stageY } from "./control.ts";
import { initHands, type Hands, type Landmark } from "./hands.ts";
import { Renderer, drawHands } from "./draw.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>("cam");
const scene = $<HTMLCanvasElement>("scene");
const camOverlay = $<HTMLCanvasElement>("camOverlay");
const overlayCtx = camOverlay.getContext("2d")!;

// ---- tunables ----
let swingRange = 1.0; // 0..1 = fraction of full-screen reach (scales each fingertip's mapped position)
let gravityY = 9.8;
let drag = DEFAULT_LINEAR_DAMPING;  // LINEAR damping = air-resistance/float knob (angular stays fixed)
let weight = DEFAULT_PUPPET_WEIGHT; // puppet mass multiplier
let friction = DEFAULT_STRING_FRICTION; // per-segment damping = string "joint friction" (settles floppy chains)
// Control smoothing: detection arrives off-thread at its own (sub-60) rate, so each fingertip
// TARGET updates in bursts. We chase that target with a critically-damped spring EVERY render
// frame (see smoothDamp) so the kinematic control GLIDES instead of teleporting on each new
// detection — a teleport injects a huge one-step velocity into the joint and whips the puppet.
// Higher = smoother but laggier; 0 = snap (old behavior).
let smoothTime = 0.01; // seconds, roughly "time to reach the target" (tuned: kills the whip, stays tight)
$("range").oninput = (e) => { swingRange = +(e.target as HTMLInputElement).value; $("rv").textContent = swingRange.toFixed(2); };
$("grav").oninput = (e) => { gravityY = +(e.target as HTMLInputElement).value; $("gv").textContent = gravityY.toFixed(1); };
$("damp").oninput = (e) => {
  drag = +(e.target as HTMLInputElement).value;
  $("dv").textContent = drag.toFixed(1);
  for (const p of puppets) setDamping(p, drag, DEFAULT_ANGULAR_DAMPING); // only LINEAR tracks the slider
};
$("weight").oninput = (e) => {
  weight = +(e.target as HTMLInputElement).value;
  $("wv").textContent = weight.toFixed(1);
  for (const p of puppets) setPuppetWeight(p, weight);
};
$("fric").oninput = (e) => {
  friction = +(e.target as HTMLInputElement).value;
  $("fv").textContent = friction.toFixed(1);
  for (const p of puppets) setStringFriction(p, friction); // calm the chains without floating the fall
};
$("smooth").oninput = (e) => {
  smoothTime = +(e.target as HTMLInputElement).value;
  $("sv").textContent = smoothTime.toFixed(2);
};
// overlay raw physics line segments + per-chain stretch readout. NOTE: the checkbox id must NOT be
// "dbg" — that collides with the MediaPipe wasm glue's global `dbg` and crashes init.
let debug = false; // off by default — the physics overlay is a dev tool and costs render time
$("debugChk").onchange = (e) => { debug = (e.target as HTMLInputElement).checked; };

$("slen").textContent = Math.round((CENTER_STRING_LEN / WORLD_VIEW_HEIGHT) * 100).toString();

// ---- finger -> world mapping. Each fingertip maps directly to a control-point position: full
// detection range -> full view (both axes), scaled by swingRange. Spreading the hand spreads the
// control points (and the puppet's limbs); moving the hand moves them all together. ----
const VERT_CENTER = WORLD_VIEW_HEIGHT / 2; // 6
const VERT_SPAN = WORLD_VIEW_HEIGHT;       // 12 -> a fingertip's y spans the whole view height

const POS_MIN_CUTOFF = 5.0; // snappy: detection is low-jitter, so little smoothing is needed
const POS_BETA = 0.01;

// Critically-damped smoothing toward a target (Unity's Mathf.SmoothDamp). Returns the new
// [position, velocity]. Unlike a lerp it carries a velocity state, so motion is C1-continuous:
// when the target jumps, position eases over ~smoothTime AND there's no acceleration step — which
// is exactly what keeps the kinematic joint from yanking the puppet on each fresh detection.
function smoothDamp(cur: number, target: number, vel: number, smoothTime: number, dt: number): [number, number] {
  const st = Math.max(1e-4, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (vel + omega * change) * dt;
  const newVel = (vel - omega * temp) * exp;
  return [target + (change + temp) * exp, newVel];
}

// ---- per-hand state. handStates[0] drives the LEFT puppet, [1] the RIGHT puppet (assigned by the
// hand's wrist screen-x each frame). Each hand keeps its own 5 x/y One Euro filters (by finger slot
// thumb..pinky) so its identity — and thus its smoothing — stays tied to its screen side. ----
interface HandState {
  ffx: OneEuro[];                 // 5, by finger slot (thumb..pinky)
  ffy: OneEuro[];
  pos: { x: number; y: number }[]; // 5 filtered world positions by finger slot (the TARGET, at detection rate)
  ctrl: { x: number; y: number }[]; // 5 SMOOTHED control positions (chase pos every render frame)
  cvx: number[];                   // 5 smoothdamp x velocities (spring state)
  cvy: number[];                   // 5 smoothdamp y velocities
  primed: boolean;                 // ctrl has been snapped to pos since this hand was (re)acquired
  binding: FingerBind[];           // chosen from handedness (no-crossing); maps finger slot -> part
  present: boolean;                // a hand is assigned this frame
  landmarks: Landmark[] | null;    // for the camera overlay
}

const makeHandState = (): HandState => ({
  ffx: FINGERTIPS.map(() => new OneEuro(POS_MIN_CUTOFF, POS_BETA)),
  ffy: FINGERTIPS.map(() => new OneEuro(POS_MIN_CUTOFF, POS_BETA)),
  pos: FINGERTIPS.map(() => ({ x: 0, y: 0 })),
  ctrl: FINGERTIPS.map(() => ({ x: 0, y: 0 })),
  cvx: FINGERTIPS.map(() => 0),
  cvy: FINGERTIPS.map(() => 0),
  primed: false,
  binding: RIGHT_HAND_BINDING,
  present: false,
  landmarks: null,
});

const handStates: [HandState, HandState] = [makeHandState(), makeHandState()];

let world: RAPIER.World;
let puppets: Puppet[] = [];
let renderer: Renderer;
let hands: Hands;
let lastSeq = -1; // last worker-result id we processed (detection is async, at camera rate)
let frames = 0;
let fpsT = performance.now();
let lastLoopT = performance.now(); // for the per-frame smoothing dt

function sizeOverlay(): void {
  camOverlay.width = camOverlay.clientWidth;
  camOverlay.height = camOverlay.clientHeight;
}

function onResize(): void {
  renderer.resize();
  sizeOverlay();
}

// Read each finger slot's smoothed fingertip world position for a hand.
function readFingerPositions(h: HandState, landmarks: Landmark[], now: number): void {
  for (let j = 0; j < FINGERTIPS.length; j++) {
    const lm = landmarks[FINGERTIPS[j]];
    const fx = h.ffx[j].filter(stageX(lm), now); // stage space: mirrored x, y-up; ∈ [-0.5, 0.5]
    const fy = h.ffy[j].filter(stageY(lm), now);
    h.pos[j].x = fx * renderer.worldWidth * swingRange;
    // clamp bottom only: control point rests at the floor surface instead of sinking below it
    // (top/left/right remain free — Y above the view and X past the edges are allowed)
    h.pos[j].y = Math.max(FLOOR_TOP, VERT_CENTER + fy * VERT_SPAN * swingRange);
  }
}

// Detect both hands and assign them to the two puppets by wrist screen-x (further screen-left -> left
// puppet). Picks each hand's no-crossing binding from its handedness. Handles 0 / 1 / 2 hands.
function readHands(now: number): void {
  // Detection runs in a Web Worker (§5): pump a fresh camera frame to it (gated + one in
  // flight), then consume its LATEST result. We re-assign only when a NEW result has arrived
  // (seq changed); otherwise the puppets hold their last-known hands — the decoupled loop.
  hands.pump(now);
  if (hands.seq === lastSeq) return;
  lastSeq = hands.seq;

  type Det = { landmarks: Landmark[]; cat: string; wristX: number };
  const dets: Det[] = hands.latest.map((d) => ({
    landmarks: d.landmarks,
    cat: d.handedness,    // categoryName from the worker ("Left"/"Right", unmirrored)
    wristX: stageX(d.landmarks[0]), // mirrored: +x = screen-right
  }));

  handStates[0].present = false; handStates[0].landmarks = null;
  handStates[1].present = false; handStates[1].landmarks = null;

  const assign = (slot: 0 | 1, d: Det) => {
    const h = handStates[slot];
    h.present = true;
    h.landmarks = d.landmarks;
    h.binding = bindingForHandedness(d.cat);
    readFingerPositions(h, d.landmarks, now);
  };

  if (dets.length === 1) {
    // one hand: drive the puppet on its side (left half -> left puppet); the other just hangs.
    assign(dets[0].wristX < 0 ? 0 : 1, dets[0]);
  } else if (dets.length >= 2) {
    // two hands: the further-screen-left wrist drives the left puppet.
    dets.sort((a, b) => a.wristX - b.wristX);
    assign(0, dets[0]);
    assign(1, dets[1]);
  }

  // A hand that ended up absent this cycle loses its prime, so when it's re-acquired the spring
  // SNAPS to the new position instead of sweeping the puppet across the screen from the old one.
  if (!handStates[0].present) handStates[0].primed = false;
  if (!handStates[1].present) handStates[1].primed = false;

  $("drop").style.visibility = dets.length > 0 ? "hidden" : "visible";
  $("hcount").textContent = String(dets.length);
}

// Glide each control toward its (burst-updated) target every render frame. On the first frame
// after (re)acquiring a hand we snap (no spring) so the control starts AT the hand instead of
// flying in from a stale position; after that it's a critically-damped chase.
function smoothControls(h: HandState, dt: number): void {
  for (let j = 0; j < FINGERTIPS.length; j++) {
    if (!h.primed) {
      h.ctrl[j].x = h.pos[j].x; h.ctrl[j].y = h.pos[j].y;
      h.cvx[j] = 0; h.cvy[j] = 0;
    } else {
      [h.ctrl[j].x, h.cvx[j]] = smoothDamp(h.ctrl[j].x, h.pos[j].x, h.cvx[j], smoothTime, dt);
      [h.ctrl[j].y, h.cvy[j]] = smoothDamp(h.ctrl[j].y, h.pos[j].y, h.cvy[j], smoothTime, dt);
    }
  }
  h.primed = true;
}

// Drive one puppet's controls from its assigned hand. Each control is driven BY ITS TARGET PART using
// the hand's binding (handedness), so the screen-left fingertip always pulls a screen-left part — no
// crossing. An absent hand leaves the kinematic controls at their last position (the puppet hangs).
function drivePuppet(p: Puppet, h: HandState): void {
  if (!h.present) return;
  const slotByTarget = {} as Record<TargetName, number>;
  h.binding.forEach((f) => { slotByTarget[f.target] = FINGERTIPS.indexOf(f.landmark); });
  for (const s of p.strings) {
    const pos = h.ctrl[slotByTarget[s.target]]; // the SMOOTHED control position, not the raw target
    s.control.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: 0 });
  }
}

function loop(): void {
  const now = performance.now();
  frames++;
  if (now - fpsT >= 500) { $("fps").textContent = Math.round((frames * 1000) / (now - fpsT)).toString(); frames = 0; fpsT = now; }

  readHands(now);

  // dt for the control spring (clamped so a long tab-away can't produce one giant smoothdamp step).
  const dt = Math.min(0.05, (now - lastLoopT) / 1000);
  lastLoopT = now;

  // physics steps every frame; each puppet's controls are driven from its assigned hand (or hold).
  world.gravity = { x: 0, y: -gravityY, z: 0 };
  if (handStates[0].present) smoothControls(handStates[0], dt); // glide controls toward targets at render rate
  if (handStates[1].present) smoothControls(handStates[1], dt);
  drivePuppet(puppets[0], handStates[0]);
  drivePuppet(puppets[1], handStates[1]);
  world.step();

  renderer.clear();
  for (const p of puppets) renderer.drawPuppet(p);
  if (debug) renderer.drawDebug(world, puppets.flatMap((p) => p.strings));
  drawHands(overlayCtx, camOverlay.width, camOverlay.height, [handStates[0].landmarks, handStates[1].landmarks]);

  requestAnimationFrame(loop);
}

(async function main() {
  try {
    await RAPIER.init();
    world = buildWorld(RAPIER, gravityY);
    // Two puppets side by side in one world. Both are built with their side's no-crossing binding;
    // at runtime each is driven by whichever hand lands on its side (binding picked per handedness).
    puppets = [
      addPuppet(RAPIER, world, -PUPPET_X_OFFSET, LEFT_HAND_BINDING),
      addPuppet(RAPIER, world, +PUPPET_X_OFFSET, RIGHT_HAND_BINDING),
    ];
    for (const p of puppets) setPuppetWeight(p, weight);
    renderer = new Renderer(scene);
    hands = await initHands(video);
    sizeOverlay();
    addEventListener("resize", onResize);
    $("boot").remove();
    requestAnimationFrame(loop);
  } catch (e) {
    $("boot").innerHTML =
      `<pre style="color:#ff4d4d;padding:24px;white-space:pre-wrap">Init failed:\n${e}\n\nServe over http://localhost (not file://) and use Chrome (GPU delegate).</pre>`;
  }
})();
