import RAPIER from "@dimforge/rapier3d-compat";
import { OneEuro } from "./oneEuro.ts";
import {
  buildRig, setDamping, setPuppetWeight, FINGERS,
  DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING, DEFAULT_PUPPET_WEIGHT,
  CENTER_STRING_LEN, WORLD_VIEW_HEIGHT, type Rig,
} from "./puppet.ts";
import { stageX, stageY } from "./control.ts";
import { initHands, type Hands, type Landmark } from "./hands.ts";
import { Renderer, drawHand } from "./draw.ts";

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
  if (rig) setDamping(rig, drag, DEFAULT_ANGULAR_DAMPING); // only LINEAR tracks the slider
};
$("weight").oninput = (e) => {
  weight = +(e.target as HTMLInputElement).value;
  $("wv").textContent = weight.toFixed(1);
  if (rig) setPuppetWeight(rig, weight);
};
// overlay raw physics line segments + per-chain stretch readout. NOTE: the checkbox id must NOT be
// "dbg" — that collides with the MediaPipe wasm glue's global `dbg` and crashes init.
let debug = true;
$("debugChk").onchange = (e) => { debug = (e.target as HTMLInputElement).checked; };

$("slen").textContent = Math.round((CENTER_STRING_LEN / WORLD_VIEW_HEIGHT) * 100).toString();

// ---- finger -> world mapping. Each fingertip maps directly to a control-point position: full
// detection range -> full view (both axes), scaled by swingRange. Spreading the hand spreads the
// control points (and the puppet's limbs); moving the hand moves them all together. ----
const VERT_CENTER = WORLD_VIEW_HEIGHT / 2; // 6
const VERT_SPAN = WORLD_VIEW_HEIGHT;       // 12 -> a fingertip's y spans the whole view height

const POS_MIN_CUTOFF = 5.0; // snappy: detection is low-jitter, so little smoothing is needed
const POS_BETA = 0.01;

// ---- filters + state (one x/y filter and one target per finger) ----
const ffx = FINGERS.map(() => new OneEuro(POS_MIN_CUTOFF, POS_BETA));
const ffy = FINGERS.map(() => new OneEuro(POS_MIN_CUTOFF, POS_BETA));
const fingerTargets = FINGERS.map(() => ({ x: 0, y: 0 }));
let latestLandmarks: Landmark[] | null = null;

let rig: Rig;
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

function readHand(now: number): void {
  // Only run detection on a fresh camera frame (§5: decouple detection from physics).
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const res = hands.landmarker.detectForVideo(video, now);
  const hand = res.landmarks?.[0];
  if (hand) {
    latestLandmarks = hand;
    $("drop").style.visibility = "hidden";
    // map each finger's fingertip landmark to its control-point world position.
    FINGERS.forEach((f, i) => {
      const lm = hand[f.landmark];
      const fx = ffx[i].filter(stageX(lm), now); // stage space: mirrored x, y-up; ∈ [-0.5, 0.5]
      const fy = ffy[i].filter(stageY(lm), now);
      fingerTargets[i].x = fx * renderer.worldWidth * swingRange;
      fingerTargets[i].y = VERT_CENTER + fy * VERT_SPAN * swingRange;
    });
  } else {
    latestLandmarks = null;
    $("drop").style.visibility = "visible"; // hand lost: controls hold their last target
  }
}

function loop(): void {
  const now = performance.now();
  frames++;
  if (now - fpsT >= 500) { $("fps").textContent = Math.round((frames * 1000) / (now - fpsT)).toString(); frames = 0; fpsT = now; }

  readHand(now);

  // physics steps every frame; each finger control point is driven to its last known smoothed target.
  rig.world.gravity = { x: 0, y: -gravityY, z: 0 };
  for (let i = 0; i < rig.controls.length; i++) {
    rig.controls[i].setNextKinematicTranslation({ x: fingerTargets[i].x, y: fingerTargets[i].y, z: 0 });
  }
  rig.world.step();

  renderer.draw(rig);
  if (debug) renderer.drawDebug(rig);
  drawHand(overlayCtx, camOverlay.width, camOverlay.height, latestLandmarks);

  requestAnimationFrame(loop);
}

(async function main() {
  try {
    await RAPIER.init();
    rig = buildRig(RAPIER, gravityY);
    setPuppetWeight(rig, weight);
    // seed each finger target from its control's spawn position so they hold until the hand appears.
    rig.controls.forEach((c, i) => { const t = c.translation(); fingerTargets[i].x = t.x; fingerTargets[i].y = t.y; });
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
