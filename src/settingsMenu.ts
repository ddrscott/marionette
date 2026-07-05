// Shared "standard app menu" — a fixed gear button that opens a slide-over settings panel (a
// side panel on desktop, a bottom sheet on narrow / portrait viewports). Mounted on every
// player-facing scene (/game, /characters, /keyboard, /pose) so the camera + other settings can
// be changed ANYWHERE, not just where a per-scene control panel happens to exist.
//
// It reuses the same plumbing the rest of the app already has (DRY): the camera source/quality
// live-switch through Hands.useSource (the same localStorage keys the scenes read on boot), the
// sound toggle drives sound.ts's shared mute bus, and the play-area margin is applied through a
// caller-supplied hook (Stage.playMargin on /game, the Pilot cfg on /characters + /pose). Sections
// appear only when the scene supports them (keyboard has no play-area margin; silent scenes get no
// sound row), so the panel is always relevant while its core (camera + quality) stays consistent.
import {
  QUALITY_TIERS, DEFAULT_QUALITY, isQualityTier, type Hands, type QualityTier,
} from "./hands.ts";
import { getMuted, setMuted, onMuteChange } from "./sound.ts";
import { ICON_SETTINGS, ICON_X, ICON_VOL_ON, ICON_VOL_OFF } from "./icons.ts";

// Same keys the scenes already use, so a pick made here carries over on reload and across scenes.
const LS_DEVICE = "handbattle.cam.deviceId";
const LS_QUALITY = "handbattle.cam.quality";
const LS_MUTED = "handbattle.audio.muted";
const LS_MARGIN = "handbattle.play.margin";

export const DEFAULT_MARGIN = 0.10; // matches engine.ts Stage.playMargin / the scene cfgs
const clampMargin = (m: number): number => Math.min(0.49, Math.max(0, m));

// Saved play-area margin, for scenes to apply on boot (so the menu's value is honored from the start).
export function loadMargin(): number {
  const v = parseFloat(localStorage.getItem(LS_MARGIN) ?? "");
  return Number.isFinite(v) ? clampMargin(v) : DEFAULT_MARGIN;
}
// Saved mute state (global across every scene that produces audio).
export function loadMuted(): boolean { return localStorage.getItem(LS_MUTED) === "1"; }

// Read/write hook for the play-area margin — the scene owns where the value actually lives.
export interface MarginControl { get(): number; set(m: number): void; }

export interface SettingsMenuOpts {
  hands: Hands;              // camera source + quality live-switching
  sound?: boolean;           // show the sound (mute) row — scenes that actually produce audio
  margin?: MarginControl;    // show the play-area margin slider — hand→play-area mapping scenes
  mount?: HTMLElement;       // where the gear + panel attach (default document.body)
}
export interface SettingsMenu { destroy(): void; }

export function createSettingsMenu(opts: SettingsMenuOpts): SettingsMenu {
  const mount = opts.mount ?? document.body;

  const gear = document.createElement("button");
  gear.className = "settings-btn";
  gear.type = "button";
  gear.title = "Settings";
  gear.setAttribute("aria-label", "Open settings");
  gear.setAttribute("aria-expanded", "false");
  gear.innerHTML = ICON_SETTINGS;

  const scrim = document.createElement("div");
  scrim.className = "settings-scrim";

  const panel = document.createElement("aside");
  panel.className = "settings-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Settings");
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML = `
    <div class="settings-head">
      <span class="settings-title">Settings</span>
      <button class="settings-close" type="button" title="Close" aria-label="Close settings">${ICON_X}</button>
    </div>
    <div class="settings-row">
      <label class="lbl-cam">Camera</label>
      <select class="set-cam"></select>
    </div>
    <div class="settings-row">
      <label class="lbl-qual">Quality</label>
      <select class="set-qual"></select>
    </div>
    ${opts.sound ? `
    <div class="settings-row toggle">
      <label class="lbl-mute">Sound</label>
      <button class="settings-switch set-mute" type="button" role="switch" aria-label="Toggle sound"></button>
    </div>` : ""}
    ${opts.margin ? `
    <div class="settings-row">
      <label class="lbl-margin">Play-area margin <span class="val set-margin-val"></span></label>
      <input class="set-margin" type="range" min="0" max="0.49" step="0.01" />
      <div class="settings-hint">inset the camera edge from the play area (bigger = smaller reach box)</div>
    </div>` : ""}
  `;

  mount.append(gear, scrim, panel);

  const q = <T extends HTMLElement>(sel: string): T | null => panel.querySelector<T>(sel);
  const camSel = q<HTMLSelectElement>(".set-cam")!;
  const qualSel = q<HTMLSelectElement>(".set-qual")!;
  const closeBtn = q<HTMLButtonElement>(".settings-close")!;

  // link labels to their controls (a11y) without risking global-id collisions
  camSel.id = "set-cam"; q<HTMLLabelElement>(".lbl-cam")!.htmlFor = "set-cam";
  qualSel.id = "set-qual"; q<HTMLLabelElement>(".lbl-qual")!.htmlFor = "set-qual";

  // --- camera + quality ---
  async function populateCams(): Promise<void> {
    let cams: MediaDeviceInfo[] = [];
    try { cams = await opts.hands.listCameras(); } catch (e) { console.error("[settings] enumerate", e); }
    camSel.replaceChildren();
    cams.forEach((d, i) => {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.label || `Camera ${i + 1}`; // labels are anonymous until permission is granted
      camSel.appendChild(o);
    });
    if (opts.hands.deviceId) camSel.value = opts.hands.deviceId;
  }
  camSel.onchange = async (): Promise<void> => {
    const deviceId = camSel.value;
    localStorage.setItem(LS_DEVICE, deviceId);
    try { await opts.hands.useSource({ deviceId }); } catch (e) { console.error("[settings] camera switch failed", e); }
    if (opts.hands.deviceId) camSel.value = opts.hands.deviceId; // reflect the device actually acquired
  };

  (Object.keys(QUALITY_TIERS) as QualityTier[]).forEach((t) => {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = QUALITY_TIERS[t].label;
    qualSel.appendChild(o);
  });
  qualSel.value = isQualityTier(opts.hands.tier) ? opts.hands.tier : DEFAULT_QUALITY;
  qualSel.onchange = async (): Promise<void> => {
    if (!isQualityTier(qualSel.value)) return;
    localStorage.setItem(LS_QUALITY, qualSel.value);
    try { await opts.hands.useSource({ tier: qualSel.value }); } catch (e) { console.error("[settings] quality switch failed", e); }
  };

  // Hot-plug: refresh the list; if the ACTIVE camera vanished, re-acquire the default so we don't freeze.
  const onDeviceChange = async (): Promise<void> => {
    const cams = await opts.hands.listCameras().catch(() => [] as MediaDeviceInfo[]);
    const active = opts.hands.deviceId;
    if (active && !cams.some((c) => c.deviceId === active)) {
      try { await opts.hands.useSource({ deviceId: null }); localStorage.setItem(LS_DEVICE, opts.hands.deviceId ?? ""); }
      catch (e) { console.error("[settings] re-acquire after unplug failed", e); }
    }
    await populateCams();
  };
  navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);

  // --- sound (optional) ---
  let unsubMute: (() => void) | null = null;
  if (opts.sound) {
    const muteBtn = q<HTMLButtonElement>(".set-mute")!;
    // Apply the saved mute on init — covers scenes (e.g. /keyboard) that don't otherwise set it.
    setMuted(loadMuted());
    const reflectMute = (): void => {
      const m = getMuted();
      muteBtn.innerHTML = m ? ICON_VOL_OFF : ICON_VOL_ON;
      muteBtn.classList.toggle("off", m);
      muteBtn.setAttribute("aria-checked", String(!m));
    };
    reflectMute();
    unsubMute = onMuteChange(reflectMute); // stay in sync with a corner mute button / the M key
    muteBtn.onclick = (): void => {
      const m = !getMuted();
      setMuted(m); // notifies subscribers → reflectMute runs
      localStorage.setItem(LS_MUTED, m ? "1" : "0");
    };
  }

  // --- play-area margin (optional) ---
  if (opts.margin) {
    const marginRange = q<HTMLInputElement>(".set-margin")!;
    const marginVal = q<HTMLSpanElement>(".set-margin-val")!;
    const reflect = (): void => { marginVal.textContent = opts.margin!.get().toFixed(2); };
    marginRange.value = String(opts.margin.get());
    reflect();
    marginRange.oninput = (): void => {
      const m = clampMargin(parseFloat(marginRange.value) || 0);
      opts.margin!.set(m);
      localStorage.setItem(LS_MARGIN, m.toFixed(2));
      reflect();
    };
  }

  // --- open / close ---
  let open = false;
  const setOpen = (v: boolean): void => {
    if (v === open) return;
    open = v;
    scrim.classList.toggle("open", v);
    panel.classList.toggle("open", v);
    panel.setAttribute("aria-hidden", String(!v));
    gear.setAttribute("aria-expanded", String(v));
    if (v) void populateCams(); // re-list every open (device labels appear after permission)
  };
  gear.addEventListener("click", () => setOpen(true));
  closeBtn.addEventListener("click", () => setOpen(false));
  scrim.addEventListener("click", () => setOpen(false));
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape" && open) setOpen(false); };
  addEventListener("keydown", onKey);

  return {
    destroy(): void {
      setOpen(false);
      navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
      removeEventListener("keydown", onKey);
      unsubMute?.();
      gear.remove(); scrim.remove(); panel.remove();
    },
  };
}
