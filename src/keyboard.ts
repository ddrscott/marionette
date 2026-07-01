// /keyboard — test bed for the shared hand keyboard component (src/handkeyboard.ts). Just hand
// detection + the keyboard; no physics/game. Use it to tune the hand cursor; other screens mount the
// same component. Physical keyboard works too.
import { initHands, isQualityTier, DEFAULT_QUALITY, type QualityTier } from "./hands.ts";
import { drawHands, TEAM_TEAL } from "./draw.ts";
import { HandKeyboard } from "./handkeyboard.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>("cam");
const camOverlay = $<HTMLCanvasElement>("camOverlay");
const overlayCtx = camOverlay.getContext("2d")!;
const display = $("kbDisplay");
const result = $("kbResult");

const LS_DEVICE = "handbattle.cam.deviceId";
const LS_QUALITY = "handbattle.cam.quality";

function sizeOverlay(): void { camOverlay.width = camOverlay.clientWidth; camOverlay.height = camOverlay.clientHeight; }

(async function main() {
  try {
    const savedQuality = localStorage.getItem(LS_QUALITY);
    const tier: QualityTier = isQualityTier(savedQuality) ? savedQuality : DEFAULT_QUALITY;
    const hands = await initHands(video, { deviceId: localStorage.getItem(LS_DEVICE), tier });

    // Generic mount — no maxLen; OK just echoes what was submitted. Any screen can mount it like this.
    // Test bed uses the finger-to-thumb PINCH click (the game keeps fist-to-press).
    const kb = new HandKeyboard($("kbstage"), $("kbGrid"), $("kbCursor"), { click: "pinch", onSubmit: (t) => { result.textContent = `SUBMITTED  ${t || "(empty)"}`; } });

    addEventListener("keydown", (e) => {
      if (e.key === "Backspace") { kb.pushChar("DEL"); e.preventDefault(); return; }
      if (e.key === "Enter") { kb.pushChar("OK"); return; }
      if (/^[a-z]$/i.test(e.key)) kb.pushChar(e.key.toUpperCase());
    });

    sizeOverlay();
    addEventListener("resize", sizeOverlay);
    new ResizeObserver(sizeOverlay).observe(camOverlay); // fit on mount without a manual resize
    $("boot").remove();

    const loop = (): void => {
      const now = performance.now();
      hands.pump(now);
      const d = hands.latest[0] ?? null; // first detected hand drives the cursor (carries world + score)
      kb.update(d, now); // `d` carries world landmarks + score for the 3D confidence-gated pinch
      display.textContent = kb.buf || " ";
      drawHands(overlayCtx, camOverlay.width, camOverlay.height, [d ? d.landmarks : null], [TEAM_TEAL]);
      requestAnimationFrame(loop);
    };
    loop();
  } catch (e) {
    $("boot").innerHTML =
      `<pre style="color:var(--danger);padding:24px;white-space:pre-wrap">Init failed:\n${e}\n\nServe over http://localhost and use Chrome.</pre>`;
  }
})();
