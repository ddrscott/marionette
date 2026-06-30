import RAPIER from "@dimforge/rapier3d-compat";
import { OneEuro } from "./oneEuro.ts";
import { buildRig, poseControl, CENTER_STRING_LEN, CONTROL_BASE_Y, WORLD_VIEW_HEIGHT, type Rig } from "./puppet.ts";
import { initHands, handPose, type Hands, type Landmark } from "./hands.ts";
import { Renderer, drawHand } from "./draw.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>("cam");
const scene = $<HTMLCanvasElement>("scene");
const camOverlay = $<HTMLCanvasElement>("camOverlay");
const overlayCtx = camOverlay.getContext("2d")!;

// ---- tunables (kept from §2 / spike-1 feel instrumentation) ----
let swingRange = 1.6;
let gravityY = 9.8;
let tiltRange = 1.0; // master multiplier on roll/pitch/yaw (0 = no tilt, control only translates)
$("range").oninput = (e) => { swingRange = +(e.target as HTMLInputElement).value; $("rv").textContent = swingRange.toFixed(1); };
$("grav").oninput = (e) => { gravityY = +(e.target as HTMLInputElement).value; $("gv").textContent = gravityY.toFixed(1); };
$("tilt").oninput = (e) => { tiltRange = +(e.target as HTMLInputElement).value; $("tv").textContent = tiltRange.toFixed(1); };

// string length as a fraction of the viewport (constant across resizes — see draw.ts).
$("slen").textContent = Math.round((CENTER_STRING_LEN / WORLD_VIEW_HEIGHT) * 100).toString();

// ---- control-rotation limits + mapping (PRD §2: deliberate/slow, modest angles) ----
const DEG = Math.PI / 180;
const ROLL_MAX = 25 * DEG;  // in-plane lean — fully visible, so it gets the widest range
const PITCH_MAX = 15 * DEG; // out-of-plane nod (foreshortens the cross-bar vertically)
const YAW_MAX = 15 * DEG;   // out-of-plane turn (foreshortens the horizontal bar)
const ZGRAD_DEADZONE = 0.015; // ignore tiny z-jitter around a flat palm
const ZGRAD_GAIN = 2.2;       // z-gradient (~±0.15 usable) -> radians, then clamped to the max
const clamp = (v: number, m: number) => (v > m ? m : v < -m ? -m : v);
const deadzone = (v: number, d: number) => (Math.abs(v) <= d ? 0 : v - Math.sign(v) * d);

// ---- filters + state ----
const fpx = new OneEuro();
const fpy = new OneEuro();
// New rotation signals get their OWN smoothing — the §2 position defaults (1.5 / 0.01) are
// deliberately NOT reused. Roll is a clean in-plane signal (light smoothing); pitch/yaw ride the
// noisy z channel and are smoothed hard (low cutoff).
const frollX = new OneEuro(1.2, 0.008);
const frollY = new OneEuro(1.2, 0.008);
const fpitch = new OneEuro(0.6, 0.004);
const fyaw = new OneEuro(0.6, 0.004);
const target = { x: 0, y: CONTROL_BASE_Y };
const tilt = { roll: 0, pitch: 0, yaw: 0 }; // smoothed control euler angles (radians)
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
    target.y = CONTROL_BASE_Y + (0.5 - py) * 1.5;  // hand up/down -> control up/down (small range)

    // ---- orientation: hand pose -> control bar roll / pitch / yaw ----
    const pose = handPose(hand);
    // Roll: smooth the in-plane vector COMPONENTS (not the angle) to dodge atan2 wrap, then
    // take the angle off vertical. -roll on Z so the "+" leans the same way the fingers do
    // (a +Z rotation tips the cross-bar top to screen-left; fingers leaning right want the right).
    const rx = frollX.filter(pose.rollX, now);
    const ry = frollY.filter(pose.rollY, now);
    const rollAngle = Math.atan2(rx, ry); // 0 when the hand points straight up
    tilt.roll = clamp(-rollAngle, ROLL_MAX) * tiltRange;
    // Pitch / yaw: heavily-smoothed z-gradients, dead-zoned and clamped to modest cones.
    const pz = deadzone(fpitch.filter(pose.pitch, now), ZGRAD_DEADZONE);
    const yz = deadzone(fyaw.filter(pose.yaw, now), ZGRAD_DEADZONE);
    tilt.pitch = clamp(pz * ZGRAD_GAIN, PITCH_MAX) * tiltRange;
    tilt.yaw = clamp(yz * ZGRAD_GAIN, YAW_MAX) * tiltRange;

    $("tilts").textContent =
      `${Math.round(tilt.roll / DEG)}° / ${Math.round(tilt.pitch / DEG)}° / ${Math.round(tilt.yaw / DEG)}°`;
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

  // physics steps every frame; the control bar is driven by the last known smoothed target.
  rig.world.gravity = { x: 0, y: -gravityY, z: 0 };
  rig.control.setNextKinematicTranslation({ x: target.x, y: target.y, z: 0 });
  // Roll/pitch/yaw the control: the body itself only rolls in-plane (Z); pitch & yaw foreshorten
  // the string anchors via orthographic projection, so the Z-locked puppet still responds through
  // the strings without any dynamic body leaving z=0 (see poseControl).
  poseControl(rig, tilt.roll, tilt.pitch, tilt.yaw);
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
