import RAPIER from "@dimforge/rapier3d-compat";
import { OneEuro } from "./oneEuro.ts";
import { buildRig, poseControl, setDamping, DEFAULT_LINEAR_DAMPING, CENTER_STRING_LEN, WORLD_VIEW_HEIGHT, type Rig } from "./puppet.ts";
import { initHands, handPose, type Hands, type Landmark } from "./hands.ts";
import { DRIVE, controlDrive, controlCenter, rollAngleOf } from "./control.ts";
import { Renderer, drawHand } from "./draw.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>("cam");
const scene = $<HTMLCanvasElement>("scene");
const camOverlay = $<HTMLCanvasElement>("camOverlay");
const overlayCtx = camOverlay.getContext("2d")!;

// ---- tunables (kept from §2 / spike-1 feel instrumentation) ----
let swingRange = 1.0; // 0..1 = fraction of full-screen reach (both axes)
let gravityY = 9.8;
let tiltRange = 1.0;  // 0..1 = fraction of full rotation range (roll/pitch/yaw)
let damping = DEFAULT_LINEAR_DAMPING; // swing settle rate (applied to linear + angular)
$("range").oninput = (e) => { swingRange = +(e.target as HTMLInputElement).value; $("rv").textContent = swingRange.toFixed(2); };
$("grav").oninput = (e) => { gravityY = +(e.target as HTMLInputElement).value; $("gv").textContent = gravityY.toFixed(1); };
$("tilt").oninput = (e) => { tiltRange = +(e.target as HTMLInputElement).value; $("tv").textContent = tiltRange.toFixed(2); };
$("damp").oninput = (e) => {
  damping = +(e.target as HTMLInputElement).value;
  $("dv").textContent = damping.toFixed(1);
  if (rig) setDamping(rig, damping, damping); // bodies spawn at DEFAULT, so this only runs on change
};
let debug = false; // overlay raw physics line segments + rope length/stretch readout
$("dbg").onchange = (e) => { debug = (e.target as HTMLInputElement).checked; };

// string length as a fraction of the viewport (constant across resizes — see draw.ts).
$("slen").textContent = Math.round((CENTER_STRING_LEN / WORLD_VIEW_HEIGHT) * 100).toString();

// ---- control-rotation limits + mapping (PRD §2: deliberate/slow, modest angles) ----
const DEG = Math.PI / 180;
// Roll is now a DIRECT 1:1 measurement of the bar between two hand landmarks, so it earns a wider
// cap than the old synthesized proxy. Still clamped so a big hand tilt can't over-rotate the cross
// into instability.
const ROLL_MAX = 35 * DEG;  // in-plane lean — measured directly from the 2-point bar angle
const PITCH_MAX = 15 * DEG; // nod (from in-image finger-drop, see hands.ts)
const YAW_MAX = 15 * DEG;   // out-of-plane turn (foreshortens the horizontal bar)
// Pitch from the finger-drop ratio (no depth). Its neutral is grip-dependent, so it's a knob:
// hold a relaxed hand, read the pitch in the r/p/y readout, and set PITCH_NEUTRAL to zero it.
const PITCH_NEUTRAL = 0.0;    // resting finger-drop ratio treated as 0° pitch
const PITCH_DEADZONE = 0.05;  // ignore small finger-drop wobble
const PITCH_GAIN = 0.8;       // drop ratio -> radians, then clamped to PITCH_MAX
// Yaw still rides the z-gradient (index vs pinky depth).
const ZGRAD_DEADZONE = 0.015; // ignore tiny z-jitter
const ZGRAD_GAIN = 2.2;       // z-gradient (~±0.15 usable) -> radians, then clamped to the max
const clamp = (v: number, m: number) => (v > m ? m : v < -m ? -m : v);
const deadzone = (v: number, d: number) => (Math.abs(v) <= d ? 0 : v - Math.sign(v) * d);

// ---- position mapping: direct full-screen reach, scaled by swingRange (0..1) ----
// Horizontal uses the live view width (full detection range -> full screen width). Vertical is
// biased so a centered hand stands the puppet on the floor; raising lifts it off, lowering crumples
// it onto the floor. Motion isn't artificially clamped — the floor is the only constraint.
// Full vertical reach: the cross spans the whole view height. All strings are now non-rigid ropes,
// so dropping the cross low just lets them go slack and the puppet rests/crumples on the floor (no
// burying). Neutral hand -> mid-screen; hand down -> cross to the bottom; hand up -> high dangle.
const VERT_CENTER = WORLD_VIEW_HEIGHT / 2; // 6
const VERT_SPAN = WORLD_VIEW_HEIGHT;       // 12 -> cross y spans [0, 12] at full swing

// ---- control-path smoothing (LATENCY TUNING — named constants so feel can be dialed) ----
// The raw landmark overlay has no perceptible lag, so detection is fast and low-jitter; the delay
// the user felt was OUR conservative One Euro cutoff (which drops most at the slow marionette
// tempo). Now that position + roll are MEASURED (single smoothing stage each, no synthesized-roll
// pass), the control needs far less smoothing — these minCutoffs are raised well above the §2
// position default (1.5) so the cross tracks the hand nearly as immediately as the raw overlay,
// while keeping enough smoothing for no visible jitter. Higher = snappier; lower = steadier.
const POS_MIN_CUTOFF = 5.0;   // position (midpoint) responsiveness (was the 1.5 §2 default)
const POS_BETA = 0.01;        // speed-coefficient (unchanged from §2)
const ROLL_MIN_CUTOFF = 5.0;  // roll responsiveness, matched to position so the bar feels rigid
const ROLL_BETA = 0.01;

// ---- filters + state ----
const fpx = new OneEuro(POS_MIN_CUTOFF, POS_BETA);
const fpy = new OneEuro(POS_MIN_CUTOFF, POS_BETA);
// Roll is smoothed via its sin/cos COMPONENTS (single stage) so One Euro never sees a wrapping
// angle. Pitch stays a clean in-plane signal; yaw rides the noisy z channel and is smoothed hard.
const frollSin = new OneEuro(ROLL_MIN_CUTOFF, ROLL_BETA);
const frollCos = new OneEuro(ROLL_MIN_CUTOFF, ROLL_BETA);
const fpitch = new OneEuro(1.0, 0.006);
const fyaw = new OneEuro(0.6, 0.004);
const target = { x: 0, y: VERT_CENTER };
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

    // ---- DIRECT 2-point drive: position = midpoint, roll = bar angle (both MEASURED) ----
    // Two hand landmarks (default = the furthest-left / -right in stage-x each frame; fixed-mode
    // fallback = index-MCP(5)/pinky-MCP(17)) define the cross's horizontal bar. controlDrive
    // returns them already in stage space (mirrored x, y-up). See control.ts / DRIVE.
    const drive = controlDrive(hand, DRIVE);
    const center = controlCenter(drive.left, drive.right);     // stage-space midpoint (∈ [-0.5,0.5])
    const cx = fpx.filter(center.x, now);                      // single smoothing stage
    const cy = fpy.filter(center.y, now);
    // Direct full-screen reach on both axes, scaled by swingRange (1.0 = full). Full detection
    // range -> full view width; vertical biased to stand the puppet on the floor at a centered hand.
    target.x = cx * renderer.worldWidth * swingRange;
    target.y = VERT_CENTER + cy * VERT_SPAN * swingRange;

    // Roll: angle of the line between the two points. Smooth via sin/cos components (single stage)
    // to dodge atan2 wrap, then recombine. Negate onto Z so the "+" leans the same way the hand
    // does (a +Z rotation tips the bar-top to screen-left; left-end-up tilt wants the other way).
    const rawRoll = rollAngleOf(drive.left, drive.right);      // 0 when the bar is level
    const rs = frollSin.filter(Math.sin(rawRoll), now);
    const rc = frollCos.filter(Math.cos(rawRoll), now);
    const rollAngle = Math.atan2(rs, rc);
    tilt.roll = clamp(-rollAngle, ROLL_MAX) * tiltRange;

    // ---- orientation: hand pose -> control bar pitch / yaw (roll is measured above) ----
    const pose = handPose(hand);
    // Pitch: in-image finger-drop (no depth), de-neutralized, dead-zoned, clamped.
    const pz = deadzone(fpitch.filter(pose.pitch, now) - PITCH_NEUTRAL, PITCH_DEADZONE);
    tilt.pitch = clamp(pz * PITCH_GAIN, PITCH_MAX) * tiltRange;
    // Yaw: heavily-smoothed z-gradient, dead-zoned and clamped to a modest cone.
    const yz = deadzone(fyaw.filter(pose.yaw, now), ZGRAD_DEADZONE);
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
  if (debug) renderer.drawDebug(rig);
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
