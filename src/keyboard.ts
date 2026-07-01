// /keyboard — test bed for the shared hand keyboard component (src/handkeyboard.ts). Just hand
// detection + the keyboard; no physics/game. Use it to tune the hand cursor; other screens mount the
// same component. Physical keyboard works too.
import { initHands, isQualityTier, DEFAULT_QUALITY, type QualityTier } from "./hands.ts";
import type { WorkerHand } from "./hands.ts";
import { drawHands, TEAM_TEAL } from "./draw.ts";
import { HandKeyboard, SYMBOL_CHARS } from "./handkeyboard.ts";
import { makeCamDraggable } from "./dragCam.ts";
import { unlock, setMuted } from "./sound.ts";
// DIAGNOSTIC overlay only — reuse the detector's OWN math so the numbers can't drift from what fires a
// press. Remove these imports + the updateDebug block below to delete the overlay.
import { fingerThumbRatios, PINCH_THRESHOLD, pinchedFinger, isPinch } from "./gesture.ts";
import { palmCentroid, mapCursor, CLICK_MIN_CONFIDENCE, DEFAULT_CURSOR_MARGIN } from "./handCursor.ts";

const LS_MUTED = "handbattle.audio.muted";

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

    // WebAudio autoplay policy: a webcam-driven pinch is NOT a gesture, so the key click can't play
    // until a real user gesture unlocks the shared context. Honor the saved global mute (no mute button
    // here), then unlock on the first pointer or key — after that, hand-press clicks sound too.
    setMuted(localStorage.getItem(LS_MUTED) === "1");
    const doUnlock = (): void => { unlock(); removeEventListener("pointerdown", doUnlock); };
    addEventListener("pointerdown", doUnlock);

    addEventListener("keydown", (e) => {
      unlock(); // a physical key IS a gesture — unlock so this and later hand presses can click
      if (e.key === "Backspace") { kb.pushChar("DEL"); e.preventDefault(); return; }
      if (e.key === "Enter") { kb.pushChar("OK"); return; }
      if (e.key === " ") { kb.pushChar(" "); e.preventDefault(); return; } // spacebar → space (don't scroll)
      if (/^[a-z]$/i.test(e.key)) { kb.pushChar(e.key.toUpperCase()); return; }
      // digits + the curated symbols type on any layer (physical input bypasses the on-screen layer)
      if (e.key.length === 1 && (/[0-9]/.test(e.key) || SYMBOL_CHARS.includes(e.key))) kb.pushChar(e.key);
    });

    sizeOverlay();
    addEventListener("resize", sizeOverlay);
    new ResizeObserver(sizeOverlay).observe(camOverlay); // fit on mount without a manual resize
    makeCamDraggable($("camBox"), $("kbstage")); // drag the self-view anywhere; clamped + persisted

    // ---- DIAGNOSTIC pinch/confidence overlay ----------------------------------------------------
    // Read-only HUD to diagnose the reported left-edge gesture dropoff: it shows the SAME per-finger
    // thumb ratios (via gesture.ts fingerThumbRatios) and confidence gate (CLICK_MIN_CONFIDENCE) that
    // actually decide a press, plus the hand's frame position — so you can watch the numbers degrade as
    // the hand nears an edge. Toggled with a checkbox (NOT a key — keydown routes a–z into the buffer).
    // Everything overlay-related is confined to updateDebug + the #dbg markup/CSS; delete to remove.
    const LS_DBG = "handbattle.kb.debug";
    const dbg = $("dbg");
    const dbgBody = $<HTMLPreElement>("dbgBody");
    const dbgToggle = $<HTMLInputElement>("dbgToggle");
    const FINGERS: Record<number, { name: string; role: string }> = {
      8: { name: "index ", role: "press" }, 12: { name: "middle", role: "press" },
      16: { name: "ring  ", role: "  -  " }, 20: { name: "pinky ", role: "delete" },
    };
    dbgToggle.checked = localStorage.getItem(LS_DBG) !== "0";
    const applyDbg = (): void => { dbg.classList.toggle("off", !dbgToggle.checked); };
    dbgToggle.addEventListener("change", () => { localStorage.setItem(LS_DBG, dbgToggle.checked ? "1" : "0"); applyDbg(); });
    applyDbg();

    const f3 = (n: number): string => n.toFixed(3);
    const updateDebug = (d: WorkerHand | null): void => {
      if (!dbgToggle.checked) return; // hidden — skip the DOM work
      if (!d) { dbgBody.innerHTML = `<span class="bad">no hand</span>`; return; }
      // WorkerHand always carries world, but stay defensive: fall back to image landmarks + flag it.
      const usingWorld = Array.isArray(d.world) && d.world.length >= 21;
      const w = usingWorld ? d.world : d.landmarks;
      const lines: string[] = [];
      lines.push(`hand   <span class="ok">yes</span>  ${d.handedness}`);
      // Confidence vs the click gate (CLICK_MIN_CONFIDENCE) — the prime edge-dropoff suspect.
      const passC = d.score >= CLICK_MIN_CONFIDENCE;
      lines.push(`score  ${f3(d.score)}  <span class="${passC ? "ok" : "bad"}">${passC ? "PASS" : "FAIL"}</span>  gate ${f3(CLICK_MIN_CONFIDENCE)}`);
      // Per-finger normalized thumb ratios — the EXACT values the pinch detector thresholds.
      const ratios = fingerThumbRatios(w);
      lines.push(`ratios (thr ${PINCH_THRESHOLD})${usingWorld ? "" : ` <span class="bad">[image fallback]</span>`}`);
      for (const { tip, ratio } of ratios) {
        const meta = FINGERS[tip];
        const hit = ratio < PINCH_THRESHOLD;
        lines.push(` ${meta.name} <span class="${hit ? "hot" : "mut"}">${f3(ratio)}</span>${hit ? " *" : "  "} <span class="mut">${meta.role}</span>`);
      }
      // Resolved gesture — reuse the detector's own resolvers (closest-under-threshold + press check).
      const pf = pinchedFinger(w);
      const gesture = pf === -1 ? `<span class="mut">none</span>`
        : isPinch(w) ? `<span class="hot">press (${FINGERS[pf].name.trim()})</span>`
        : pf === 20 ? `<span class="hot">delete (pinky)</span>`
        : `<span class="mut">${FINGERS[pf].name.trim()} (ignored)</span>`;
      lines.push(`gesture ${gesture}`);
      // Frame position: raw palm centroid (image coords) + the mirrored/margin-mapped cursor. An EDGE
      // flag on the raw x lets you correlate "near the left edge" with score/ratio degradation.
      const raw = palmCentroid(d.landmarks);
      const cur = mapCursor(d.landmarks, DEFAULT_CURSOR_MARGIN);
      const edge = raw.x < 0.12 ? ` <span class="bad">[img-L edge]</span>` : raw.x > 0.88 ? ` <span class="bad">[img-R edge]</span>` : "";
      lines.push(`img x${f3(raw.x)} y${f3(raw.y)}${edge}`);
      lines.push(`cur x${f3(cur.x)} y${f3(cur.y)}`);
      dbgBody.innerHTML = lines.join("\n");
    };
    // ---------------------------------------------------------------------------------------------

    $("boot").remove();

    const loop = (): void => {
      const now = performance.now();
      hands.pump(now);
      const d = hands.latest[0] ?? null; // first detected hand drives the cursor (carries world + score)
      kb.update(d, now); // `d` carries world landmarks + score for the 3D confidence-gated pinch
      updateDebug(d);    // DIAGNOSTIC read-only overlay — mirrors the exact ratios/gate the press uses
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
