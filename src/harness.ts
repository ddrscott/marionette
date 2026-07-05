// /harness — the developer sandbox. Builds a Stage and wires every tunable to a live slider, the
// camera/quality pickers, and the fps / hand-count / tracking HUD. All the simulation lives in
// engine.ts; this file is just the dev UI around it.
import { Stage, DEFAULT_GRAVITY } from "./engine.ts";
import { CENTER_STRING_LEN, WORLD_VIEW_HEIGHT, type WeaponDef } from "./puppet.ts";
import { isQualityTier, DEFAULT_QUALITY, type Hands, type QualityTier } from "./hands.ts";
import { makeCamDraggable } from "./dragCam.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>("cam");
const scene = $<HTMLCanvasElement>("scene");
const camOverlay = $<HTMLCanvasElement>("camOverlay");
const camSel = $<HTMLSelectElement>("camSel");
const qualSel = $<HTMLSelectElement>("qualSel");

const LS_DEVICE = "handbattle.cam.deviceId";
const LS_QUALITY = "handbattle.cam.quality";

function wireSliders(stage: Stage): void {
  $("range").oninput = (e) => { stage.swingRange = +(e.target as HTMLInputElement).value; $("rv").textContent = stage.swingRange.toFixed(2); };
  $("margin").oninput = (e) => {
    stage.playMargin = Math.min(0.49, Math.max(0, +(e.target as HTMLInputElement).value));
    $("mv").textContent = stage.playMargin.toFixed(2);
  };
  $("grav").oninput = (e) => { stage.gravityY = +(e.target as HTMLInputElement).value; $("gv").textContent = stage.gravityY.toFixed(1); };
  $("damp").oninput = (e) => { stage.setDrag(+(e.target as HTMLInputElement).value); $("dv").textContent = stage.dragVal.toFixed(1); };
  $("weight").oninput = (e) => { stage.setWeight(+(e.target as HTMLInputElement).value); $("wv").textContent = stage.weightVal.toFixed(1); };
  $("stiff").oninput = (e) => { stage.stringStiffness = +(e.target as HTMLInputElement).value; $("stv").textContent = stage.stringStiffness.toFixed(0); };
  $("sdamp").oninput = (e) => { stage.stringDamping = +(e.target as HTMLInputElement).value; $("sdv").textContent = stage.stringDamping.toFixed(0); };
  $("scap").oninput = (e) => { stage.stringForceCap = +(e.target as HTMLInputElement).value; $("scv").textContent = stage.stringForceCap.toFixed(0); };
  $("smooth").oninput = (e) => { stage.smoothTime = +(e.target as HTMLInputElement).value; $("sv").textContent = stage.smoothTime.toFixed(2); };
  $("debugChk").onchange = (e) => { stage.debug = (e.target as HTMLInputElement).checked; };
  $("slen").textContent = Math.round((CENTER_STRING_LEN / WORLD_VIEW_HEIGHT) * 100).toString();
}

// Live weapon tuning: arm both puppets with dual arm-blades and re-arm on any change so reach + mass
// can be dialled against two live puppets. Unchecking "weapons" strips them (bare-limb cutting).
const BLADE_COLOR = "#c9ccd2";
const BLADE_THICKNESS = 0.10;
function wireWeapons(stage: Stage): void {
  const apply = (): void => {
    const armed = ($("armChk") as HTMLInputElement).checked;
    const reach = +($("wreach") as HTMLInputElement).value;
    const density = +($("wmass") as HTMLInputElement).value;
    const defs: WeaponDef[] = armed
      ? (["lArm", "rArm"] as const).map((target) => ({ name: "blade", target, reach, thickness: BLADE_THICKNESS, density, color: BLADE_COLOR }))
      : [];
    stage.arm(0, defs);
    stage.arm(1, defs);
  };
  ($("armChk")).onchange = apply;
  $("wreach").oninput = (e) => { $("wrv").textContent = (+(e.target as HTMLInputElement).value).toFixed(1); apply(); };
  $("wmass").oninput = (e) => { $("wmv").textContent = (+(e.target as HTMLInputElement).value).toFixed(1); apply(); };
  apply(); // arm on load
}

// Repopulate the camera <select> from the live device list, reflecting the ACTIVE device.
async function refreshCameraList(hands: Hands): Promise<MediaDeviceInfo[]> {
  const cams = await hands.listCameras();
  camSel.replaceChildren();
  cams.forEach((d, i) => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Camera ${i + 1}`;
    camSel.appendChild(opt);
  });
  if (hands.deviceId) camSel.value = hands.deviceId;
  return cams;
}

function wireCameraPickers(hands: Hands): void {
  camSel.onchange = async () => {
    const deviceId = camSel.value;
    localStorage.setItem(LS_DEVICE, deviceId);
    try { await hands.useSource({ deviceId }); } catch (e) { console.error("[cam] source switch failed", e); }
    await refreshCameraList(hands);
  };
  qualSel.onchange = async () => {
    if (!isQualityTier(qualSel.value)) return;
    localStorage.setItem(LS_QUALITY, qualSel.value);
    try { await hands.useSource({ tier: qualSel.value }); } catch (e) { console.error("[cam] quality switch failed", e); }
  };
  navigator.mediaDevices.addEventListener("devicechange", async () => {
    const active = hands.deviceId;
    const cams = await refreshCameraList(hands);
    if (active && !cams.some((c) => c.deviceId === active)) {
      try { await hands.useSource({ deviceId: null }); } catch (e) { console.error("[cam] re-acquire after unplug failed", e); }
      await refreshCameraList(hands);
    }
  });
}

(async function main() {
  try {
    const savedQuality = localStorage.getItem(LS_QUALITY);
    const tier: QualityTier = isQualityTier(savedQuality) ? savedQuality : DEFAULT_QUALITY;
    const stage = await Stage.create({
      scene, video, camOverlay,
      gravityY: DEFAULT_GRAVITY,
      camera: { deviceId: localStorage.getItem(LS_DEVICE), tier },
    });

    wireSliders(stage);
    wireWeapons(stage);
    qualSel.value = stage.hands.tier;
    await refreshCameraList(stage.hands);
    wireCameraPickers(stage.hands);

    // HUD — the engine exposes fps / handCount; we render them here so the engine stays DOM-free.
    stage.onFrame = () => {
      $("fps").textContent = String(Math.round(stage.fps));
      $("hcount").textContent = String(stage.handCount);
      $("drop").style.visibility = stage.handCount > 0 ? "hidden" : "visible";
    };

    makeCamDraggable($("camBox"), $("stage")); // drag the self-view anywhere; clamped + persisted
    $("boot").remove();
    stage.start();
  } catch (e) {
    $("boot").innerHTML =
      `<pre style="color:var(--danger);padding:24px;white-space:pre-wrap">Init failed:\n${e}\n\nServe over http://localhost (not file://) and use Chrome (GPU delegate).</pre>`;
  }
})();
