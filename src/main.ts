import RAPIER from "@dimforge/rapier3d-compat";
import { OneEuro } from "./oneEuro.ts";
import {
  buildWorld, addPuppet, setDamping, setPuppetWeight,
  FINGERTIPS, bindingForHandedness, PUPPET_X_OFFSET, RIGHT_HAND_BINDING, LEFT_HAND_BINDING,
  DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING, DEFAULT_PUPPET_WEIGHT,
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

// ---- per-hand state. handStates[0] drives the LEFT puppet, [1] the RIGHT puppet (assigned by the
// hand's wrist screen-x each frame). Each hand keeps its own 5 x/y One Euro filters (by finger slot
// thumb..pinky) so its identity — and thus its smoothing — stays tied to its screen side. ----
interface HandState {
  ffx: OneEuro[];                 // 5, by finger slot (thumb..pinky)
  ffy: OneEuro[];
  pos: { x: number; y: number }[]; // 5 filtered world positions by finger slot
  binding: FingerBind[];           // chosen from handedness (no-crossing); maps finger slot -> part
  present: boolean;                // a hand is assigned this frame
  landmarks: Landmark[] | null;    // for the camera overlay
}

const makeHandState = (): HandState => ({
  ffx: FINGERTIPS.map(() => new OneEuro(POS_MIN_CUTOFF, POS_BETA)),
  ffy: FINGERTIPS.map(() => new OneEuro(POS_MIN_CUTOFF, POS_BETA)),
  pos: FINGERTIPS.map(() => ({ x: 0, y: 0 })),
  binding: RIGHT_HAND_BINDING,
  present: false,
  landmarks: null,
});

const handStates: [HandState, HandState] = [makeHandState(), makeHandState()];

let world: RAPIER.World;
let puppets: Puppet[] = [];
let renderer: Renderer;
let hands: Hands;
let lastVideoTime = -1;
let frames = 0;
let fpsT = performance.now();

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
  // Only run detection on a fresh camera frame (§5: decouple detection from physics).
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const res = hands.landmarker.detectForVideo(video, now);

  const lmArr = res.landmarks ?? [];
  const handArr = res.handedness ?? res.handednesses ?? [];
  type Det = { landmarks: Landmark[]; cat: string; wristX: number };
  const dets: Det[] = lmArr.map((lm, i) => ({
    landmarks: lm,
    cat: handArr[i]?.[0]?.categoryName ?? "Right",
    wristX: stageX(lm[0]), // mirrored: +x = screen-right
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

  $("drop").style.visibility = dets.length > 0 ? "hidden" : "visible";
  $("hcount").textContent = String(dets.length);
}

// Drive one puppet's controls from its assigned hand. Each control is driven BY ITS TARGET PART using
// the hand's binding (handedness), so the screen-left fingertip always pulls a screen-left part — no
// crossing. An absent hand leaves the kinematic controls at their last position (the puppet hangs).
function drivePuppet(p: Puppet, h: HandState): void {
  if (!h.present) return;
  const slotByTarget = {} as Record<TargetName, number>;
  h.binding.forEach((f) => { slotByTarget[f.target] = FINGERTIPS.indexOf(f.landmark); });
  for (const s of p.strings) {
    const pos = h.pos[slotByTarget[s.target]];
    s.control.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: 0 });
  }
}

function loop(): void {
  const now = performance.now();
  frames++;
  if (now - fpsT >= 500) { $("fps").textContent = Math.round((frames * 1000) / (now - fpsT)).toString(); frames = 0; fpsT = now; }

  readHands(now);

  // physics steps every frame; each puppet's controls are driven from its assigned hand (or hold).
  world.gravity = { x: 0, y: -gravityY, z: 0 };
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
