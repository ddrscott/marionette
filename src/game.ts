// /game — the marionette fighter. Built on the SAME engine as the harness (no duplicated sim). This
// file owns the Street-Fighter HUD; all the match logic lives in match.ts and the fight rules in
// cut.ts.
import { Stage, DEFAULT_GRAVITY } from "./engine.ts";
import { Match, MAX_STRINGS, WINS_NEEDED } from "./match.ts";
import { isQualityTier, DEFAULT_QUALITY, type QualityTier } from "./hands.ts";

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
    stage.onFrame = (now) => {
      match.update(stage, now);
      renderHud(match);
    };

    $("boot").remove();
    stage.start();
  } catch (e) {
    $("boot").innerHTML =
      `<pre style="color:#ff4d4d;padding:24px;white-space:pre-wrap">Init failed:\n${e}\n\nServe over http://localhost (not file://) and use Chrome (GPU delegate).</pre>`;
  }
})();
