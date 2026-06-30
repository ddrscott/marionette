import RAPIER from "@dimforge/rapier3d-compat";
import { OneEuro } from "./oneEuro.ts";
import { buildRig, CENTER_STRING_LEN, PERCH_BASE_Y, WORLD_VIEW_HEIGHT, type Rig } from "./puppet.ts";
import { initHands, type Hands, type Landmark } from "./hands.ts";
import { Renderer, drawHand } from "./draw.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>("cam");
const scene = $<HTMLCanvasElement>("scene");
const camOverlay = $<HTMLCanvasElement>("camOverlay");
const overlayCtx = camOverlay.getContext("2d")!;

// ---- tunables (kept from §2 / spike-1 feel instrumentation) ----
let swingRange = 1.6;
let gravityY = 9.8;
$("range").oninput = (e) => { swingRange = +(e.target as HTMLInputElement).value; $("rv").textContent = swingRange.toFixed(1); };
$("grav").oninput = (e) => { gravityY = +(e.target as HTMLInputElement).value; $("gv").textContent = gravityY.toFixed(1); };

// string length as a fraction of the viewport (constant across resizes — see draw.ts).
$("slen").textContent = Math.round((CENTER_STRING_LEN / WORLD_VIEW_HEIGHT) * 100).toString();

// ---- filters + state ----
const fpx = new OneEuro();
const fpy = new OneEuro();
const target = { x: 0, y: PERCH_BASE_Y };
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
    const lm = hand[9]; // palm center = control point
    const px = fpx.filter(lm.x, now);
    const py = fpy.filter(lm.y, now);
    target.x = (0.5 - px) * 2 * swingRange;        // mirror X, scale to swing range
    target.y = PERCH_BASE_Y + (0.5 - py) * 1.5;    // hand up/down -> perch up/down (small range)
  } else {
    latestLandmarks = null;
    $("drop").style.visibility = "visible";
  }
}

function loop(): void {
  const now = performance.now();
  frames++;
  if (now - fpsT >= 500) { $("fps").textContent = Math.round((frames * 1000) / (now - fpsT)).toString(); frames = 0; fpsT = now; }

  readHand(now);

  // physics steps every frame; perch is driven by the last known smoothed target.
  rig.world.gravity = { x: 0, y: -gravityY, z: 0 };
  rig.perch.setNextKinematicTranslation({ x: target.x, y: target.y, z: 0 });
  rig.world.step();

  renderer.draw(rig);
  drawHand(overlayCtx, camOverlay.width, camOverlay.height, latestLandmarks);

  requestAnimationFrame(loop);
}

(async function main() {
  try {
    await RAPIER.init();
    rig = buildRig(RAPIER, gravityY);
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
