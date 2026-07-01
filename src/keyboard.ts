// /keyboard — an isolated test bench for the hand-driven initials picker (finger-gun) so it can be
// tuned without playing a whole match to trigger a record break. Just hand detection + the picker;
// no physics/puppets. Keyboard also works.
import { initHands, isQualityTier, DEFAULT_QUALITY, type QualityTier } from "./hands.ts";
import { drawHands, TEAM_TEAL } from "./draw.ts";
import { HandInitials } from "./initials.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>("cam");
const camOverlay = $<HTMLCanvasElement>("camOverlay");
const overlayCtx = camOverlay.getContext("2d")!;
const display = $("kbInitials");
const result = $("kbResult");

const LS_DEVICE = "handbattle.cam.deviceId";
const LS_QUALITY = "handbattle.cam.quality";

function sizeOverlay(): void { camOverlay.width = camOverlay.clientWidth; camOverlay.height = camOverlay.clientHeight; }

(async function main() {
  try {
    const savedQuality = localStorage.getItem(LS_QUALITY);
    const tier: QualityTier = isQualityTier(savedQuality) ? savedQuality : DEFAULT_QUALITY;
    const hands = await initHands(video, { deviceId: localStorage.getItem(LS_DEVICE), tier });

    const picker = new HandInitials($("initGrid"), $("initCursor"), (initials) => { result.textContent = `ENTERED  ${initials}`; });

    addEventListener("keydown", (e) => {
      if (e.key === "Backspace") { picker.pushChar("DEL"); e.preventDefault(); return; }
      if (e.key === "Enter") { if (picker.buf) { result.textContent = `ENTERED  ${picker.buf.padEnd(3, "A")}`; picker.reset(); } return; }
      if (/^[a-z]$/i.test(e.key)) picker.pushChar(e.key.toUpperCase());
    });

    sizeOverlay();
    addEventListener("resize", sizeOverlay);
    $("boot").remove();

    const loop = (): void => {
      const now = performance.now();
      hands.pump(now);
      const d = hands.latest[0]; // first detected hand drives the cursor
      const lm = d ? d.landmarks : null;
      picker.update(lm, now);
      display.textContent = picker.buf.padEnd(3, "_").split("").join(" ");
      drawHands(overlayCtx, camOverlay.width, camOverlay.height, [lm], [TEAM_TEAL]);
      requestAnimationFrame(loop);
    };
    loop();
  } catch (e) {
    $("boot").innerHTML =
      `<pre style="color:var(--danger);padding:24px;white-space:pre-wrap">Init failed:\n${e}\n\nServe over http://localhost and use Chrome.</pre>`;
  }
})();
