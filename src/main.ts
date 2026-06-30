import RAPIER from "@dimforge/rapier3d-compat";
import { OneEuro } from "./oneEuro.ts";
import {
  buildWorld, addPuppet, setDamping, setPuppetWeight, setStringFriction,
  reposePuppet, attachStringForSlot, detachAllStrings,
  FINGERTIPS, bindingForHandedness, PUPPET_X_OFFSET, RIGHT_HAND_BINDING, LEFT_HAND_BINDING,
  DEFAULT_LINEAR_DAMPING, DEFAULT_ANGULAR_DAMPING, DEFAULT_PUPPET_WEIGHT, DEFAULT_STRING_FRICTION,
  CENTER_STRING_LEN, WORLD_VIEW_HEIGHT, FLOOR_TOP, type Puppet, type FingerBind, type TargetName,
} from "./puppet.ts";
import { stageX, stageY } from "./control.ts";
import { initHands, isQualityTier, DEFAULT_QUALITY, type Hands, type Landmark, type QualityTier } from "./hands.ts";
import { Renderer, drawHands } from "./draw.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>("cam");
const scene = $<HTMLCanvasElement>("scene");
const camOverlay = $<HTMLCanvasElement>("camOverlay");
const overlayCtx = camOverlay.getContext("2d")!;
const camSel = $<HTMLSelectElement>("camSel");
const qualSel = $<HTMLSelectElement>("qualSel");

// Camera source + quality picks persist across reloads; the deviceId can vanish (unplugged camera),
// in which case useSource() falls back to the default device gracefully.
const LS_DEVICE = "handbattle.cam.deviceId";
const LS_QUALITY = "handbattle.cam.quality";

// ---- tunables ----
let swingRange = 1.0; // 0..1 = fraction of full-screen reach (scales each fingertip's mapped position)
// Play-area margin: inset the camera->play mapping so the central (1 - 2*playMargin) of the camera
// maps to the FULL canvas (the play-area edge reaches the canvas edge; the outer margin band drives
// the control OFFSCREEN). Composes with swingRange (which scales reach); 0 = no inset = old behavior.
let playMargin = 0.10; // fraction inset per side (0..0.25 via the slider)
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
$("margin").oninput = (e) => {
  // clamp keeps (1 - 2m) > 0 even if the slider bounds ever change (slider max 0.25 already safe)
  playMargin = Math.min(0.49, Math.max(0, +(e.target as HTMLInputElement).value));
  $("mv").textContent = playMargin.toFixed(2);
};
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

// ---- "start the engine" attach ritual, one state machine per puppet slot. A puppet only comes
// alive after its hand holds still over a prompt; the strings then animate on one at a time. Moving
// too soon aborts it; the hand leaving the camera detaches it. The two sides run independently, so
// one raised hand attaches one puppet while the other keeps waiting. ----
const HOLD_MS = 700;          // hold still this long (ms) over the prompt to trigger attachment
const STEADY_MARGIN = 0.5;    // world units a fingertip may wander and still count as "holding still"
const ATTACH_STRING_MS = 200; // each string attaches over 0.2s (per spec)
const ATTACH_MARGIN = 0.8;    // move a fingertip more than this DURING attach -> the attach fails
const GRACE_MS = 500;         // hand absent this long -> detach + back to waiting (rides out brief gaps)
const ATTACH_ORDER = [2, 0, 4, 1, 3]; // slot order strings snap on: torso(head) first, then hands, feet

type Phase = "waiting" | "steadying" | "attaching" | "running";
interface SlotState {
  phase: Phase;
  steadyAnchor: { x: number; y: number }[]; // 5 fingertip positions when the current steady streak began
  steadyT0: number;                          // start of the steady streak
  captured: { x: number; y: number }[];      // 5 fingertip positions captured at attach
  bind: FingerBind[];                        // binding captured at attach (so drive matches the attach)
  attachT0: number;                          // start of the attach animation
  attached: number;                          // strings attached so far this ritual
  lastPresentT: number;                      // last time the hand was present (for the grace/reset)
}
const makeSlotState = (): SlotState => ({
  phase: "waiting",
  steadyAnchor: FINGERTIPS.map(() => ({ x: 0, y: 0 })),
  steadyT0: 0,
  captured: FINGERTIPS.map(() => ({ x: 0, y: 0 })),
  bind: RIGHT_HAND_BINDING,
  attachT0: 0,
  attached: 0,
  lastPresentT: -1e9,
});
const slotStates: [SlotState, SlotState] = [makeSlotState(), makeSlotState()];

const copyPts = (dst: { x: number; y: number }[], src: { x: number; y: number }[]): void => {
  for (let i = 0; i < dst.length; i++) { dst[i].x = src[i].x; dst[i].y = src[i].y; }
};
const maxPtDist = (a: { x: number; y: number }[], b: { x: number; y: number }[]): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y); if (d > m) m = d; }
  return m;
};

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
    // playMargin insets the camera->play mapping: central (1-2m) of camera -> full canvas, margin
    // band -> offscreen. Applied to BOTH axes before One Euro / swingRange / the floor clamp below.
    const fx = h.ffx[j].filter(stageX(lm, playMargin), now); // stage space: mirrored x, y-up
    const fy = h.ffy[j].filter(stageY(lm, playMargin), now);
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

// Advance one puppet's attach state machine and drive it. WAITING/STEADYING show the prompt and
// don't move the puppet (it rests on the floor); ATTACHING pins the controls at the captured pose
// and snaps the strings on; RUNNING drives the (now living) puppet from the live hand.
function updateSlot(slot: 0 | 1, now: number, dt: number): void {
  const h = handStates[slot];
  const st = slotStates[slot];
  const p = puppets[slot];
  if (h.present) st.lastPresentT = now;
  const absent = now - st.lastPresentT > GRACE_MS;

  switch (st.phase) {
    case "waiting":
      reposePuppet(p, p.homeTorso); // hold it at the neutral scene-setup pose, ready to be brought alive
      if (h.present) { copyPts(st.steadyAnchor, h.pos); st.steadyT0 = now; st.phase = "steadying"; }
      break;

    case "steadying":
      reposePuppet(p, p.homeTorso);
      if (absent) { st.phase = "waiting"; break; }
      if (!h.present) break; // brief gap — keep the streak alive
      if (maxPtDist(h.pos, st.steadyAnchor) > STEADY_MARGIN) {
        copyPts(st.steadyAnchor, h.pos); st.steadyT0 = now; // moved — restart the hold
      } else if (now - st.steadyT0 >= HOLD_MS) {
        beginAttach(slot, now);
      }
      break;

    case "attaching":
      if (absent || (h.present && maxPtDist(h.pos, st.captured) > ATTACH_MARGIN)) { resetToWaiting(slot); break; }
      reposePuppet(p, p.homeTorso); // keep the body crisp at neutral while the strings snap on
      // hold the already-attached controls at the captured pose (zero velocity -> no whip)
      for (const s of p.strings) s.control.setNextKinematicTranslation({ x: st.captured[s.slot].x, y: st.captured[s.slot].y, z: 0 });
      // snap on the next string(s) as each 0.2s window elapses (first one at t=0)
      const due = Math.min(ATTACH_ORDER.length, Math.floor((now - st.attachT0) / ATTACH_STRING_MS) + 1);
      while (st.attached < due) {
        const sSlot = ATTACH_ORDER[st.attached];
        attachStringForSlot(RAPIER, world, p, sSlot, st.captured[sSlot], st.bind[sSlot]);
        st.attached++;
      }
      if (st.attached >= ATTACH_ORDER.length && now - st.attachT0 >= ATTACH_ORDER.length * ATTACH_STRING_MS) {
        setStringFriction(p, friction); // apply the live friction slider to the freshly built segments
        h.primed = false;               // running starts the smoothdamp spring AT the captured pose
        st.phase = "running";
      }
      break;

    case "running":
      if (absent) { resetToWaiting(slot); break; }
      if (h.present) { smoothControls(h, dt); drivePuppet(p, h); } // brief gaps just hold (puppet hangs)
      break;
  }
}

// Hold satisfied: capture the held pose and start the string animation with the puppet held at its
// neutral scene-setup pose (the strings bind from the captured fingertips DOWN to the home puppet).
function beginAttach(slot: 0 | 1, now: number): void {
  const h = handStates[slot];
  const st = slotStates[slot];
  copyPts(st.captured, h.pos);
  st.bind = h.binding;
  st.attachT0 = now;
  st.attached = 0;
  reposePuppet(puppets[slot], puppets[slot].homeTorso);
  st.phase = "attaching";
}

// Cut the strings and return to the prompt, snapping the puppet back to its neutral home pose.
function resetToWaiting(slot: 0 | 1): void {
  detachAllStrings(world, puppets[slot]);
  reposePuppet(puppets[slot], puppets[slot].homeTorso);
  slotStates[slot].phase = "waiting";
  slotStates[slot].attached = 0;
}

function loop(): void {
  const now = performance.now();
  frames++;
  if (now - fpsT >= 500) { $("fps").textContent = Math.round((frames * 1000) / (now - fpsT)).toString(); frames = 0; fpsT = now; }

  readHands(now);

  // dt for the control spring (clamped so a long tab-away can't produce one giant smoothdamp step).
  const dt = Math.min(0.05, (now - lastLoopT) / 1000);
  lastLoopT = now;

  // physics steps every frame; each puppet runs its own attach state machine (drives only when RUNNING).
  world.gravity = { x: 0, y: -gravityY, z: 0 };
  updateSlot(0, now, dt);
  updateSlot(1, now, dt);
  world.step();

  renderer.clear();
  for (let s = 0 as 0 | 1; s <= 1; s = (s + 1) as 0 | 1) {
    renderer.drawPuppet(puppets[s]);
    const ph = slotStates[s].phase;
    if (ph === "waiting" || ph === "steadying") {
      const prog = ph === "steadying" ? Math.min(1, (now - slotStates[s].steadyT0) / HOLD_MS) : 0;
      renderer.drawPrompt(puppets[s].xOffset, s, prog, now); // hand outline above the puppet; s mirrors it
      // show the live fingertip points during calibration so the user can line them up with the outline
      if (ph === "steadying" && handStates[s].present) renderer.drawFingerPoints(handStates[s].pos);
    }
  }
  if (debug) renderer.drawDebug(world, puppets.flatMap((p) => p.strings));
  drawHands(overlayCtx, camOverlay.width, camOverlay.height, [handStates[0].landmarks, handStates[1].landmarks]);

  requestAnimationFrame(loop);
}

// Repopulate the camera <select> from the live device list, reflecting the ACTIVE device. Labels
// are empty/anonymous until the first successful getUserMedia, so this is called again post-permission.
async function refreshCameraList(): Promise<MediaDeviceInfo[]> {
  const cams = await hands.listCameras();
  camSel.replaceChildren();
  cams.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Camera ${i + 1}`; // fall back to "Camera N" pre-permission
    camSel.appendChild(opt);
  });
  if (hands.deviceId) camSel.value = hands.deviceId;
  return cams;
}

// Wire the two sidebar dropdowns: switch source/quality live (re-acquire the stream, no reload, no
// worker restart) and persist each pick to localStorage. Also refresh on hot-plug.
function wireCameraPickers(): void {
  camSel.onchange = async () => {
    const deviceId = camSel.value;
    localStorage.setItem(LS_DEVICE, deviceId);
    try { await hands.useSource({ deviceId }); } catch (e) { console.error("[cam] source switch failed", e); }
    await refreshCameraList();
  };
  qualSel.onchange = async () => {
    if (!isQualityTier(qualSel.value)) return;
    const tier = qualSel.value;
    localStorage.setItem(LS_QUALITY, tier);
    try { await hands.useSource({ tier }); } catch (e) { console.error("[cam] quality switch failed", e); }
  };
  // Hot-plug: refresh the dropdown; only re-acquire if the ACTIVE device vanished (else leave the
  // live stream alone). enumerateDevices fires this on plug/unplug.
  navigator.mediaDevices.addEventListener("devicechange", async () => {
    const active = hands.deviceId;
    const cams = await refreshCameraList();
    if (active && !cams.some((c) => c.deviceId === active)) {
      try { await hands.useSource({ deviceId: null }); } catch (e) { console.error("[cam] re-acquire after unplug failed", e); }
      await refreshCameraList();
    }
  });
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

    // Re-apply the saved camera source + quality on boot (falls back gracefully if the saved device
    // is gone). Then populate the dropdowns — labels are only available AFTER this first permission
    // grant — and wire live switching + persistence.
    const savedQuality = localStorage.getItem(LS_QUALITY);
    const tier: QualityTier = isQualityTier(savedQuality) ? savedQuality : DEFAULT_QUALITY;
    hands = await initHands(video, { deviceId: localStorage.getItem(LS_DEVICE), tier });
    qualSel.value = hands.tier;
    await refreshCameraList();
    wireCameraPickers();

    sizeOverlay();
    addEventListener("resize", onResize);
    $("boot").remove();
    requestAnimationFrame(loop);
  } catch (e) {
    $("boot").innerHTML =
      `<pre style="color:#ff4d4d;padding:24px;white-space:pre-wrap">Init failed:\n${e}\n\nServe over http://localhost (not file://) and use Chrome (GPU delegate).</pre>`;
  }
})();
