// /game — the marionette fighter. Built on the SAME engine as the harness (no duplicated sim). This
// file owns the Street-Fighter HUD; all the match logic lives in match.ts and the fight rules in
// cut.ts.
import { Stage, DEFAULT_GRAVITY } from "./engine.ts";
import { Match, MAX_STRINGS, WINS_NEEDED, type GamePhase } from "./match.ts";
import { isQualityTier, DEFAULT_QUALITY, type QualityTier } from "./hands.ts";
import { unlock, audioReady, getMuted, setMuted, sfx } from "./sound.ts";
import { music } from "./music.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>("cam");
const scene = $<HTMLCanvasElement>("scene");
const camOverlay = $<HTMLCanvasElement>("camOverlay");

// Reuse the harness's saved camera pick (same localStorage keys) so the chosen device carries over.
const LS_DEVICE = "handbattle.cam.deviceId";
const LS_QUALITY = "handbattle.cam.quality";

// Render `wins` (0..WINS_NEEDED) as filled pips into a container.
function renderPips(id: string, wins: number): void {
  const el = $(id);
  if (el.childElementCount !== WINS_NEEDED) {
    el.replaceChildren();
    for (let i = 0; i < WINS_NEEDED; i++) el.appendChild(document.createElement("span"));
  }
  Array.from(el.children).forEach((c, i) => { (c as HTMLElement).className = i < wins ? "pip on" : "pip"; });
}

let lastAnnounce = "";
function renderHud(m: Match): void {
  const timer = $("timer");
  timer.textContent = String(Math.ceil(m.timeLeft));
  timer.classList.toggle("low", m.phase === "fight" && m.timeLeft <= 10); // red pulse in the final seconds
  $("p0fill").style.width = `${(m.power[0] / MAX_STRINGS) * 100}%`;
  $("p1fill").style.width = `${(m.power[1] / MAX_STRINGS) * 100}%`;
  renderPips("p0pips", m.wins[0]);
  renderPips("p1pips", m.wins[1]);
  // re-trigger the slam-in animation each time the headline text changes
  if (m.announce !== lastAnnounce) {
    lastAnnounce = m.announce;
    const annc = $("annc");
    annc.textContent = m.announce;
    annc.classList.remove("pop");
    if (m.announce) { void annc.offsetWidth; annc.classList.add("pop"); }
  }
  $("annsub").textContent = m.sub;
}

// --- audio (game-only): procedural WebAudio SFX + adaptive music, all off the render-critical path ---
const LS_MUTED = "handbattle.audio.muted";
const ICON_ON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
const ICON_OFF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg>';

// Kick the correct music track for the current phase (called on unlock + on every phase change).
function syncMusic(phase: GamePhase): void {
  if (phase === "fight") music.startCombat();
  else music.startMenu();
}

// Wires the SFX/music hooks and returns a cheap per-frame poll to run after match.update().
function setupAudio(stage: Stage, match: Match): () => void {
  const muteBtn = document.getElementById("muteBtn") as HTMLButtonElement | null;
  const hint = document.getElementById("soundHint");

  const reflectMute = (): void => {
    const m = getMuted();
    if (muteBtn) { muteBtn.innerHTML = m ? ICON_OFF : ICON_ON; muteBtn.classList.toggle("off", m); }
  };
  setMuted(localStorage.getItem(LS_MUTED) === "1");
  reflectMute();
  const toggleMute = (): void => { const m = !getMuted(); setMuted(m); localStorage.setItem(LS_MUTED, m ? "1" : "0"); reflectMute(); };

  // Unlock on the first real user gesture (WebAudio autoplay policy; a webcam frame is NOT a gesture).
  const doUnlock = (): void => {
    unlock();
    if (audioReady()) {
      hint?.remove();
      syncMusic(match.phase);
      removeEventListener("pointerdown", doUnlock); // pointer/click only unlock; keydown stays (M toggle)
      removeEventListener("click", doUnlock);
    }
  };
  addEventListener("pointerdown", doUnlock);
  addEventListener("click", doUnlock);
  // Permanent keyboard handler: any key unlocks; once unlocked, M toggles mute.
  addEventListener("keydown", (e) => {
    if (!audioReady()) { doUnlock(); return; }
    if (e.key === "m" || e.key === "M") toggleMute();
  });
  muteBtn?.addEventListener("click", (e) => { e.stopPropagation(); if (!audioReady()) { doUnlock(); return; } toggleMute(); });

  // Rising pluck as each string snaps on during the attach ritual.
  stage.onAttach = (_slot, i) => sfx.attach(i);
  // Slice (string cut) + clash (limbs collide) fire from inside the cut rules.
  match.cutEvents = { onSlice: () => sfx.slice(), onClash: () => sfx.clash() };

  // Poll match deltas each frame (cheap): phase stingers, music track, low-time beeps, fight heat.
  let lastPhase: GamePhase | null = null;
  let lastBeepSec = -1;
  return (): void => {
    if (!audioReady()) return;
    const phase = match.phase;
    if (phase !== lastPhase) {
      if (phase === "roundStart") sfx.round();
      else if (phase === "fight") sfx.fight();
      else if (phase === "roundEnd") { if (match.announce.startsWith("K.O")) sfx.ko(); else if (match.announce.startsWith("TIME")) sfx.time(); }
      else if (phase === "matchEnd") sfx.win();
      syncMusic(phase);
      lastPhase = phase;
    }
    if (phase === "fight") {
      const total = match.power[0] + match.power[1]; // 0..2*MAX_STRINGS
      const timePress = match.timeLeft <= 15 ? (15 - match.timeLeft) / 15 * 0.5 : 0;
      music.setIntensity(Math.min(1, (2 * MAX_STRINGS - total) / (2 * MAX_STRINGS) + timePress));
      const sec = Math.ceil(match.timeLeft);
      if (match.timeLeft <= 10 && match.timeLeft > 0 && sec !== lastBeepSec) { lastBeepSec = sec; sfx.beep(match.timeLeft <= 3); }
    } else {
      lastBeepSec = -1;
    }
  };
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
    stage.clampHalf = true; // neither player's fingertips may cross the center line

    const match = new Match();
    const audioTick = setupAudio(stage, match);
    stage.onFrame = (now) => {
      match.update(stage, now);
      renderHud(match);
      audioTick();
    };

    $("boot").remove();
    stage.start();
  } catch (e) {
    $("boot").innerHTML =
      `<pre style="color:var(--danger);padding:24px;white-space:pre-wrap">Init failed:\n${e}\n\nServe over http://localhost (not file://) and use Chrome (GPU delegate).</pre>`;
  }
})();
