// /keyboard — "Air Keyboard for Germaphobes": a timed typing mini-game on the shared hand keyboard
// (src/handkeyboard.ts). Type the on-screen phrase in the air; the timer starts the moment a hand is
// detected and stops when the buffer matches exactly. Shows WPM + time + a persisted best. Physical
// keyboard + mouse/tap work too. Also the tuning bed for the hand cursor (debug overlay below).
import { initHands, isQualityTier, DEFAULT_QUALITY, type QualityTier } from "./hands.ts";
import type { WorkerHand, Landmark } from "./hands.ts";
import { drawHands, TEAM_TEAL } from "./draw.ts";
import { HandKeyboard, SYMBOL_CHARS } from "./handkeyboard.ts";
import { makeCamDraggable } from "./dragCam.ts";
import { ICON_FS_MAX, ICON_FS_MIN } from "./icons.ts";
import { unlock, setMuted, audioReady, getMuted, sfx } from "./sound.ts";
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

    // Mount the shared keyboard with the finger-to-thumb PINCH click. OK (or Enter / the Next button)
    // starts a fresh phrase once a round is done.
    const kb = new HandKeyboard($("kbstage"), $("kbGrid"), $("kbCursor"), {
      click: "pinch",
      onSubmit: () => { if (phase === "done") newRound(); },
      onClear: () => restartRound(), // CLEAR key → redo the SAME phrase from scratch (timer resets)
    });

    // ---- "Air Keyboard for Germaphobes" typing mini-game ----------------------------------------
    // Timer starts the instant a hand is detected and stops when the typed buffer EXACTLY matches the
    // prompt. Rotating on-theme phrases (letters + spaces only, so no layer switching needed); shows
    // WPM + time + a persisted best time.
    const PHRASES = [
      "AIR KEYBOARD FOR GERMAPHOBES",
      "NOBODY ELSE TOUCHED THIS ONE",
      "WASH YOUR HANDS FIRST",
      "NO GERMS ON MY KEYBOARD",
      "PLEASE DO NOT TOUCH ANYTHING",
      "SANITIZE BEFORE YOU TYPE",
      "KEEP YOUR HANDS TO YOURSELF",
      "TYPING WITHOUT ALL THE TOUCHING",
    ];
    const LS_BEST = "handbattle.kb.bestMs";
    const kbPrompt = $("kbPrompt");
    const kbTimer = $("kbTimer");
    const kbHint = $("kbHint");
    const kbNext = $<HTMLButtonElement>("kbNext");
    let phase: "ready" | "running" | "done" = "ready";
    let prompt = "";
    let startMs = 0;
    let bestMs = Number(localStorage.getItem(LS_BEST)) || 0; // 0 = no record yet

    // Draw the prompt with the correctly-typed prefix in accent, the next expected char underlined (red
    // if a wrong char is sitting there), and the rest dim. Prompt text is a fixed constant (A–Z + space),
    // so it's safe to drop into innerHTML.
    const renderPrompt = (): void => {
      const typed = kb.buf.toUpperCase();
      let i = 0;
      while (i < typed.length && i < prompt.length && typed[i] === prompt[i]) i++;
      const cur = prompt.charAt(i);
      const wrong = typed.length > i; // a char is typed at the cursor that doesn't match
      kbPrompt.innerHTML =
        `<span class="p-done">${prompt.slice(0, i)}</span>` +
        `<span class="p-cur${wrong ? " p-err" : ""}">${cur === " " ? "&nbsp;" : cur || ""}</span>` +
        `<span class="p-rest">${prompt.slice(i + 1)}</span>`;
    };

    const newRound = (): void => {
      let p = prompt;
      while (p === prompt && PHRASES.length > 1) p = PHRASES[Math.floor(Math.random() * PHRASES.length)];
      prompt = p || PHRASES[0];
      kb.reset();                 // clears the buffer + returns to the letters layer
      phase = "ready";
      startMs = 0;
      kbTimer.textContent = "0.0s";
      result.textContent = "";
      kbNext.hidden = true;
      kbHint.textContent = "raise your hand to start";
      display.textContent = " ";
      renderPrompt();
    };

    // CLEAR — restart the CURRENT phrase (a clean redo), distinct from newRound() which picks a new one.
    // The buffer is already emptied by pushChar before onClear fires; we keep `prompt`, drop back to the
    // `ready` phase so the clock re-arms (gameUpdate restarts it the moment a hand is present), and reset
    // the timer/result/Next UI. Same prompt, fresh attempt.
    const restartRound = (): void => {
      phase = "ready";
      startMs = 0;
      kbTimer.textContent = "0.0s";
      result.textContent = "";
      kbNext.hidden = true;
      kbHint.textContent = "raise your hand to start";
      display.textContent = " ";
      renderPrompt();
    };

    const finishRound = (now: number): void => {
      phase = "done";
      const ms = now - startMs;
      const secs = ms / 1000;
      kbTimer.textContent = `${secs.toFixed(1)}s`;
      const wpm = secs > 0 ? Math.round((prompt.length / 5) / (secs / 60)) : 0;
      const isBest = bestMs === 0 || ms < bestMs;
      if (isBest) { bestMs = ms; localStorage.setItem(LS_BEST, String(Math.round(ms))); }
      result.innerHTML = `${wpm} WPM &middot; ${secs.toFixed(1)}S`
        + (bestMs ? ` &middot; BEST ${(bestMs / 1000).toFixed(1)}S` : "")
        + (isBest ? ` &middot; <span class="best">NEW BEST</span>` : "");
      kbHint.textContent = "next phrase / OK / enter to go again";
      kbNext.hidden = false;
      sfx.win(); // fanfare (shared bus — silent if muted/locked)
    };

    // Per-frame: start the clock on first hand sighting, tick it while running, finish on exact match.
    const gameUpdate = (hand: WorkerHand | null, now: number): void => {
      if (phase === "ready" && hand) { phase = "running"; startMs = now; kbHint.textContent = "type the phrase"; }
      if (phase === "running") {
        kbTimer.textContent = `${((now - startMs) / 1000).toFixed(1)}s`;
        if (prompt.length > 0 && kb.buf.toUpperCase() === prompt) finishRound(now);
      }
      if (phase !== "done") renderPrompt();
    };

    kbNext.addEventListener("click", newRound);
    newRound();

    // WebAudio autoplay policy: a webcam-driven pinch is NOT a gesture, so the key click can't play
    // until a real user gesture unlocks the shared context. Honor the saved global mute (no mute button
    // here), then unlock on the first pointer or key — after that, hand-press clicks sound too.
    setMuted(localStorage.getItem(LS_MUTED) === "1");
    const doUnlock = (): void => { unlock(); removeEventListener("pointerdown", doUnlock); };
    addEventListener("pointerdown", doUnlock);

    addEventListener("keydown", (e) => {
      unlock(); // a physical key IS a gesture — unlock so this and later hand presses can click
      if (e.key === "Backspace") { kb.pushChar("DEL"); e.preventDefault(); return; }
      if (e.key === "Escape") { kb.pushChar("CLEAR"); return; } // Esc = CLEAR: wipe + restart the current phrase
      if (e.key === "Enter") { if (phase === "done") newRound(); return; } // Enter = next phrase when a round's done
      if (e.key === " ") { kb.pushChar(" "); e.preventDefault(); return; } // spacebar → space (don't scroll)
      if (/^[a-z]$/i.test(e.key)) { kb.pushChar(e.key.toUpperCase()); return; }
      // digits + the curated symbols type on any layer (physical input bypasses the on-screen layer)
      if (e.key.length === 1 && (/[0-9]/.test(e.key) || SYMBOL_CHARS.includes(e.key))) kb.pushChar(e.key);
    });

    sizeOverlay();
    addEventListener("resize", sizeOverlay);
    new ResizeObserver(sizeOverlay).observe(camOverlay); // fit on mount without a manual resize
    makeCamDraggable($("camBox"), $("kbstage")); // drag the self-view anywhere; clamped + persisted

    // Fullscreen toggle (Fullscreen API) — same as /game; icon reflects state, stays synced on Esc-out.
    const fsBtn = document.getElementById("fsBtn") as HTMLButtonElement | null;
    if (fsBtn) {
      const reflectFs = (): void => { fsBtn.innerHTML = document.fullscreenElement ? ICON_FS_MIN : ICON_FS_MAX; };
      reflectFs();
      document.addEventListener("fullscreenchange", reflectFs);
      fsBtn.addEventListener("click", () => {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen().catch(() => {});
      });
    }

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
    const sgn = (n: number): string => (n >= 0 ? "+" : "") + n.toFixed(3); // signed, so +/- depth reads at a glance
    const hyp2 = (a: Landmark, b: Landmark): number => Math.hypot(a.x - b.x, a.y - b.y); // in-plane — matches the x/y-only pinch detector
    const updateDebug = (d: WorkerHand | null): void => {
      if (!dbgToggle.checked) return; // hidden — skip the DOM work
      if (!d) { dbgBody.innerHTML = `<span class="bad">no hand</span>`; return; }
      // WorkerHand always carries world, but stay defensive: fall back to image landmarks + flag it.
      const usingWorld = Array.isArray(d.world) && d.world.length >= 21;
      const w = usingWorld ? d.world : d.landmarks;
      const lines: string[] = [];
      lines.push(`hand   <span class="ok">yes</span>  ${d.handedness}`);
      // Audio gates for the key click: LOCKED = no user gesture yet this page load (a hand pinch is NOT
      // a gesture — click/tap/type once to unlock); MUTED = global mute (set on /game, no unmute UI here).
      const aud = audioReady();
      lines.push(`audio  <span class="${aud ? "ok" : "bad"}">${aud ? "ready" : "LOCKED"}</span>  ${getMuted() ? `<span class="bad">MUTED</span>` : `<span class="ok">on</span>`}`);
      // Confidence vs the click gate (CLICK_MIN_CONFIDENCE) — the prime edge-dropoff suspect.
      const passC = d.score >= CLICK_MIN_CONFIDENCE;
      lines.push(`score  ${f3(d.score)}  <span class="${passC ? "ok" : "bad"}">${passC ? "PASS" : "FAIL"}</span>  gate ${f3(CLICK_MIN_CONFIDENCE)}`);
      // Per-finger thumb ratios — the EXACT values the pinch detector thresholds (now x/y ONLY) — with
      // the gap decomposed per axis: Δx/s, Δy/s normalized by IN-PLANE hand scale. `[√Σ]` = √(Δx/s²+
      // Δy/s²) and must equal `ratio` (drift = a math bug). Δz/s is still shown but is IGNORED by
      // detection (it's the unreliable inferred-depth axis we dropped) — watch it wander while x/y hold.
      const thumb = w[4];
      const scale = hyp2(w[9], w[0]) || 1e-3;
      const ratios = fingerThumbRatios(w);
      // SMOKING-GUN check: true MediaPipe worldLandmarks are centred on the hand origin, so points sit
      // on BOTH sides of 0 (some x/y are negative). Image landmarks are all in [0,1] (never negative).
      // If this says IMAGE the worker's `worldLandmarks ?? landmarks` fallback is firing and the pinch
      // detector is silently running on 2D image coords — THE bug to chase.
      const metric = w.some((p) => p.x < -0.01 || p.y < -0.01);
      lines.push(`world  <span class="${metric ? "ok" : "bad"}">${metric ? "metric" : "IMAGE?!"}</span>  wrist x${sgn(w[0].x)} y${sgn(w[0].y)}`);
      lines.push(`ratios (thr ${PINCH_THRESHOLD} · scale ${f3(scale)}) <span class="mut">x/y only</span>${usingWorld ? "" : ` <span class="bad">[image fallback]</span>`}`);
      lines.push(`  <span class="mut">cols: ratio [√Σxy]  Δx/s Δy/s · Δz/s ignored</span>`);
      for (const { tip, ratio } of ratios) {
        const meta = FINGERS[tip];
        const hit = ratio < PINCH_THRESHOLD;
        const dx = (w[tip].x - thumb.x) / scale;
        const dy = (w[tip].y - thumb.y) / scale;
        const dz = (w[tip].z - thumb.z) / scale;
        const chk = Math.hypot(dx, dy); // must equal `ratio` (x/y only); drift = a math bug
        lines.push(` ${meta.name} <span class="${hit ? "hot" : "mut"}">${f3(ratio)}</span>${hit ? " *" : "  "} <span class="mut">[${f3(chk)}] Δx${sgn(dx)} Δy${sgn(dy)} <span class="bad">Δz${sgn(dz)}</span></span> <span class="mut">${meta.role}</span>`);
      }
      // RAW landmark coords for the index tip (8) + thumb (4) — the actual numbers behind the Δs.
      // `w` = MediaPipe's predicted METRIC world coords (meters, origin ≈ hand centre; x/y/z all
      // inferred, z is a guess). `i` = the IMAGE landmark (x,y in [0,1] projection + its own predicted
      // relative z). Watch how w-z on the index jumps around as you move the hand while x/y stay stable.
      const im = d.landmarks;
      lines.push(`<span class="mut">index8 w</span> x${sgn(w[8].x)} y${sgn(w[8].y)} <span class="hot">z${sgn(w[8].z)}</span>`);
      lines.push(`<span class="mut">       i</span> x${f3(im[8].x)} y${f3(im[8].y)} <span class="hot">z${sgn(im[8].z)}</span>`);
      lines.push(`<span class="mut">thumb4 w</span> x${sgn(w[4].x)} y${sgn(w[4].y)} <span class="hot">z${sgn(w[4].z)}</span>`);
      lines.push(`<span class="mut">       i</span> x${f3(im[4].x)} y${f3(im[4].y)} <span class="hot">z${sgn(im[4].z)}</span>`);
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
      gameUpdate(d, now); // start/stop the timer, check for an exact match, repaint the prompt
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
